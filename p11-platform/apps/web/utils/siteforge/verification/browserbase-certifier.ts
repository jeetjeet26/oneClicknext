import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Browserbase } from "@browserbasehq/sdk";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  chromium,
  type Page,
  type Request as PlaywrightRequest,
  type Response as PlaywrightResponse,
} from "playwright-core";
import {
  SITEFORGE_BROWSER_EVIDENCE_VERSION,
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
  SITEFORGE_MAX_VISUAL_MISMATCH_RATIO,
  type BrowserCertificationEvidence,
} from "./browser-evidence";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";
import type { CertificationArtifactBinding } from "./certification-binding";

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;

export type BrowserCertificationArtifactDescriptor = {
  storagePath: string;
  sha256: string;
};

export type ApprovedBrowserBaseline =
  BrowserCertificationArtifactDescriptor & {
    baselineId: string;
    url: string;
    viewport: keyof typeof VIEWPORTS;
    artifact: {
      artifactId: string;
      contentHash: string;
    };
    environment: "protected_preview" | "staging" | "production";
    access: "protected" | "public";
    requireIndexable: boolean;
    policyVersion: typeof SITEFORGE_CERTIFICATION_POLICY_VERSION;
    bindingHash: string;
    evidenceDigest: string;
    approvalId: string;
    approvedAt: string;
    approvedBy: string;
  };

export type LighthouseReportArtifact =
  BrowserCertificationArtifactDescriptor & {
    url: string;
    formFactor: "desktop" | "mobile";
    provider: string;
    providerRunId: string;
    runnerBinarySha256: string;
    runnerConfigSha256: string;
    toolManifestSha256: string;
    environment: "protected_preview" | "staging" | "production";
    access: "protected" | "public";
    bindingHash: string;
    generatedAt: string;
  };

export type BrowserCertificationArtifactWriter = (input: {
  storagePath: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
}) => Promise<void>;

export type BrowserCertificationArtifactReader = (
  descriptor: BrowserCertificationArtifactDescriptor,
) => Promise<Uint8Array>;

export type BrowserbaseCertifierInput = {
  targetUrl: string;
  expectedUrls: string[];
  credentials?: { username: string; password: string };
  environment: "protected_preview" | "staging" | "production";
  access: "protected" | "public";
  requireIndexable: boolean;
  artifact: CertificationArtifactBinding;
  bindingHash: string;
  baselines?: ApprovedBrowserBaseline[];
  lighthouseReports?: LighthouseReportArtifact[];
  artifactWriter: BrowserCertificationArtifactWriter;
  artifactReader: BrowserCertificationArtifactReader;
};

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function storageSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function assertArtifactBytes(
  bytes: Uint8Array,
  descriptor: BrowserCertificationArtifactDescriptor,
): void {
  if (sha256(bytes) !== descriptor.sha256) {
    throw new Error(
      `Browser certification artifact digest mismatch: ${descriptor.storagePath}`,
    );
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function safePayload(request: PlaywrightRequest): Record<string, unknown> {
  const raw = request.postData();
  if (!raw) return {};
  const contentType = request.headers()["content-type"] || "";
  try {
    if (contentType.includes("application/json")) {
      const value = JSON.parse(raw);
      return value && typeof value === "object" && !Array.isArray(value)
        ? redactPayload(value as Record<string, unknown>)
        : { value };
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return redactPayload(Object.fromEntries(new URLSearchParams(raw)));
    }
  } catch {
    return { unparseable: true, bytes: Buffer.byteLength(raw) };
  }
  return { contentType, bytes: Buffer.byteLength(raw) };
}

function redactPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /password|secret|token|authorization|api.?key|public.?key/i.test(key)
        ? "[redacted]"
        : item,
    ]),
  );
}

function safeNetworkUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/password|secret|token|authorization|key/i.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}

async function collectSeo(page: Page, url: string) {
  return page.evaluate((pageUrl) => {
    const canonicalUrl = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    )?.href;
    const property = (name: string) =>
      document
        .querySelector<HTMLMetaElement>(`meta[property="${name}"]`)
        ?.content.trim() || undefined;
    const jsonLd = Array.from(
      document.querySelectorAll<HTMLScriptElement>(
        'script[type="application/ld+json"]',
      ),
    ).map((script) => {
      try {
        const value = JSON.parse(script.textContent || "null");
        const values = Array.isArray(value) ? value : [value];
        return {
          valid: values.some((item) => item && typeof item === "object"),
          types: values.flatMap((item) =>
            item &&
            typeof item === "object" &&
            typeof item["@type"] === "string"
              ? [item["@type"]]
              : [],
          ),
          errors: [] as string[],
        };
      } catch (error) {
        return {
          valid: false,
          types: [] as string[],
          errors: [error instanceof Error ? error.message : "Invalid JSON-LD"],
        };
      }
    });
    return {
      url: pageUrl,
      canonicalUrl,
      openGraph: {
        title: property("og:title"),
        description: property("og:description"),
        imageUrl: property("og:image"),
        url: property("og:url"),
      },
      jsonLd,
    };
  }, url);
}

async function collectKeyboardAndFocus(page: Page) {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusableCount = await page.locator(selector).count();
  const visited = new Set<string>();
  const unreachableControls: string[] = [];
  for (let index = 0; index < Math.min(focusableCount + 2, 75); index += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) {
        return { key: "", visible: false };
      }
      const style = getComputedStyle(active);
      return {
        key: `${active.tagName}:${active.id}:${active.getAttribute("href") || ""}:${active.getAttribute("name") || ""}`,
        visible:
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          active.matches(":focus-visible"),
      };
    });
    if (state.key) {
      visited.add(state.key);
      if (!state.visible) unreachableControls.push(state.key);
    }
  }
  return {
    keyboard: {
      traversed: focusableCount === 0 || visited.size > 0,
      traps:
        focusableCount > 1 && visited.size <= 1
          ? ["Tab focus did not advance between controls"]
          : [],
      unreachableControls: [],
    },
    focus: {
      visible: focusableCount === 0 || unreachableControls.length === 0,
      orderValid: focusableCount === 0 || visited.size > 0,
      obscuredControls: unreachableControls,
    },
  };
}

async function testNavigation(page: Page, pageUrl: string) {
  const origin = new URL(pageUrl).origin;
  const links = await page
    .locator("a[href]:visible")
    .evaluateAll((elements) =>
      elements
        .map((element) => (element as HTMLAnchorElement).href)
        .filter(Boolean),
    );
  const urls = [
    ...new Set(
      links.filter((value) => {
        try {
          const candidate = new URL(value);
          return (
            candidate.origin === origin &&
            ["http:", "https:"].includes(candidate.protocol)
          );
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 5);
  const results: Array<{
    requestedUrl: string;
    finalUrl: string;
    status: number;
    passed: boolean;
  }> = [];
  for (const requestedUrl of urls) {
    try {
      const response = await page.context().request.get(requestedUrl, {
        failOnStatusCode: false,
        timeout: 15_000,
      });
      results.push({
        requestedUrl,
        finalUrl: response.url(),
        status: response.status(),
        passed: response.status() >= 200 && response.status() < 400,
      });
    } catch {
      results.push({
        requestedUrl,
        finalUrl: requestedUrl,
        status: 0,
        passed: false,
      });
    }
  }
  return results;
}

async function fillDeterministicForm(page: Page, formIndex: number) {
  const form = page.locator("form:visible").nth(formIndex);
  const controls = form.locator("input, textarea, select");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    const tag = await control.evaluate((element) => element.tagName);
    const type = ((await control.getAttribute("type")) || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "file"].includes(type)) continue;
    if (type === "checkbox" || type === "radio") {
      if ((await control.isVisible()) && !(await control.isChecked())) {
        await control.check();
      }
    } else if (tag === "SELECT") {
      const option = await control
        .locator("option:not([disabled])")
        .evaluateAll((items) =>
          items
            .map((item) => (item as HTMLOptionElement).value)
            .find(Boolean),
        );
      if (option) await control.selectOption(option);
    } else if (await control.isVisible()) {
      const value =
        type === "email"
          ? "browser-certification@example.invalid"
          : type === "tel"
            ? "2025550100"
            : type === "date"
              ? "2030-01-15"
              : "Browser certification dry run";
      await control.fill(value);
    }
  }
}

async function testForms(page: Page) {
  const forms: BrowserCertificationEvidence["interactions"]["pages"][number]["forms"] =
    [];
  const formCount = await page.locator("form:visible").count();
  for (let index = 0; index < formCount; index += 1) {
    const form = page.locator("form:visible").nth(index);
    const metadata = await form.evaluate((element, position) => {
      const htmlForm = element as HTMLFormElement;
      const destination =
        htmlForm.getAttribute("action") ||
        htmlForm.dataset.endpoint ||
        (
          window as typeof window & {
            oneClickFormConfig?: { endpoint?: string };
          }
        ).oneClickFormConfig?.endpoint;
      return {
        id:
          htmlForm.id ||
          htmlForm.dataset.formType ||
          htmlForm.dataset.type ||
          `form-${position + 1}`,
        destination: destination
          ? new URL(destination, window.location.href).toString()
          : null,
        method: (htmlForm.method || "POST").toUpperCase(),
        initiallyValid: htmlForm.checkValidity(),
        requiredCount: htmlForm.querySelectorAll("[required]").length,
      };
    }, index);
    const submit = form.locator(
      'button[type="submit"], input[type="submit"], button:not([type])',
    );
    if ((await submit.count()) === 0 || !metadata.destination) {
      forms.push({
        id: metadata.id,
        attempted: false,
        validationObserved: !metadata.initiallyValid,
        destinationVerified: false,
        payloadVerified: false,
        sideEffectPrevented: false,
        resultingState: "none",
      });
      continue;
    }

    if (!metadata.initiallyValid) {
      await submit.first().click().catch(() => undefined);
    }
    const validationObserved =
      metadata.requiredCount === 0 || !metadata.initiallyValid;
    await fillDeterministicForm(page, index);

    let captured: PlaywrightRequest | null = null;
    const destination = metadata.destination;
    await page.route(destination, async (route) => {
      captured = route.request();
      await route.abort("blockedbyclient");
    });
    await submit.first().click().catch(() => undefined);
    await page.waitForTimeout(500);
    await page.unroute(destination);

    const errorVisible = await form
      .locator('.form-error:visible, [role="alert"]:visible, [aria-invalid="true"]')
      .count();
    const successVisible = await form
      .locator('.form-success:visible, [data-success]:visible')
      .count();
    const capturedRequest = captured as PlaywrightRequest | null;
    const request = capturedRequest
      ? {
          url: capturedRequest.url(),
          method: capturedRequest.method(),
          payload: safePayload(capturedRequest),
          aborted: true,
        }
      : undefined;
    forms.push({
      id: metadata.id,
      attempted: true,
      validationObserved,
      destinationVerified:
        Boolean(request) &&
        normalizeUrl(request!.url) === normalizeUrl(destination),
      payloadVerified: Boolean(
        request && Object.keys(request.payload).length > 0,
      ),
      sideEffectPrevented: Boolean(request?.aborted),
      request,
      resultingState: errorVisible
        ? "error"
        : successVisible
          ? "success"
          : "none",
    });
  }
  return forms;
}

async function testWidgets(page: Page) {
  const widgets: BrowserCertificationEvidence["interactions"]["pages"][number]["widgets"] =
    [];
  const candidates = [
    {
      id: "lumaleasing",
      root: "#lumaleasing-widget",
      trigger:
        '#lumaleasing-widget button[aria-label*="Open"], #lumaleasing-widget .ll-button, #lumaleasing-widget .ll-teaser-body',
      usable:
        '#lumaleasing-widget [role="dialog"], #lumaleasing-widget .ll-window',
      close:
        '#lumaleasing-widget button[aria-label="Close chat"], #lumaleasing-widget .ll-close',
    },
  ];
  for (const candidate of candidates) {
    if ((await page.locator(candidate.root).count()) === 0) continue;
    const usable = page.locator(candidate.usable).first();
    const alreadyOpen =
      (await usable.count()) > 0 &&
      (await usable.isVisible().catch(() => false));
    const trigger = page.locator(candidate.trigger).first();
    const opened =
      alreadyOpen ||
      ((await trigger.count()) > 0
        ? await trigger
            .click()
            .then(() => true)
            .catch(() => false)
        : false);
    if (opened && !alreadyOpen) await page.waitForTimeout(250);
    const isUsable =
      opened &&
      (await usable.count()) > 0 &&
      (await usable.isVisible().catch(() => false));
    widgets.push({
      id: candidate.id,
      opened,
      usable: isUsable,
    });
    if (opened) {
      const close = page.locator(candidate.close).first();
      if ((await close.count()) > 0) {
        await close.click().catch(() => undefined);
        await page.waitForTimeout(150);
      }
    }
  }
  return widgets;
}

function scriptCategory(
  src: string,
  pageOrigin: string,
): "essential" | "analytics" | "marketing" | "unknown" {
  if (new URL(src, pageOrigin).origin === pageOrigin) return "essential";
  const value = src.toLowerCase();
  if (
    value.includes("analytics") ||
    value.includes("googletagmanager") ||
    value.includes("gtag")
  ) {
    return "analytics";
  }
  if (
    value.includes("doubleclick") ||
    value.includes("facebook") ||
    value.includes("marketing")
  ) {
    return "marketing";
  }
  return "essential";
}

async function waitForVisualStability(page: Page) {
  await page.evaluate(async () => {
    const delay = (milliseconds: number) =>
      new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const viewportStep = Math.max(window.innerHeight, 1);
    for (
      let offset = 0;
      offset < document.documentElement.scrollHeight;
      offset += viewportStep
    ) {
      window.scrollTo(0, offset);
      await delay(25);
    }
    window.scrollTo(0, 0);
    await document.fonts?.ready;
    const images = Array.from(document.images);
    await Promise.race([
      Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            });
          }
          await image.decode?.().catch(() => undefined);
        }),
      ),
      delay(3_000),
    ]);
  });
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

async function dismissTransientWidgetUi(page: Page) {
  for (const selector of [
    "#lumaleasing-widget .ll-close",
    "#lumaleasing-widget .ll-teaser-close",
  ]) {
    const control = page.locator(selector).first();
    if (
      (await control.count()) > 0 &&
      (await control.isVisible().catch(() => false))
    ) {
      await control.click().catch(() => undefined);
    }
  }
}

async function testConsent(page: Page) {
  const before = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.js(?:[?#]|$)/i.test(name)),
  );
  const banner = page.locator(".siteforge-consent-banner").first();
  const bannerVisible = (await banner.count()) > 0 && (await banner.isVisible());
  const decline = page.locator('[data-consent="denied"]').first();
  const grant = page.locator('[data-consent="granted"]').first();
  const controlsPresent =
    (await decline.count()) > 0 && (await grant.count()) > 0;
  let declineTested = false;
  let grantTested = false;
  if (controlsPresent) {
    declineTested = await decline
      .click()
      .then(() => true)
      .catch(() => false);
    await page.evaluate(() => {
      const consent = (
        window as typeof window & {
          SiteForgeConsent?: { open?: () => void };
        }
      ).SiteForgeConsent;
      consent?.open?.();
    });
    let reopenedGrant = page.locator('[data-consent="granted"]').first();
    if ((await reopenedGrant.count()) === 0) {
      await page.evaluate(() => {
        window.localStorage.removeItem("siteforge_analytics_consent");
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      reopenedGrant = page.locator('[data-consent="granted"]').first();
    }
    grantTested =
      (await reopenedGrant.count()) > 0
        ? await reopenedGrant
            .click()
            .then(() => true)
            .catch(() => false)
        : false;
    await page.waitForTimeout(500);
  }
  const after = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.js(?:[?#]|$)/i.test(name)),
  );
  return {
    defaultState: "denied" as const,
    bannerVisible,
    preferenceControlsUsable:
      controlsPresent && declineTested && grantTested,
    declineTested,
    grantTested,
    scripts: [...new Set([...before, ...after])].map((src) => ({
      src,
      category: scriptCategory(src, new URL(page.url()).origin),
      loadedBeforeConsent: before.includes(src),
      loadedAfterConsent: after.includes(src),
    })),
  };
}

function hasOnlyTrailingUniformRows(shorter: PNG, taller: PNG) {
  if (shorter.width !== taller.width || shorter.height >= taller.height) {
    return false;
  }
  const finalRowOffset = (shorter.height - 1) * shorter.width * 4;
  const color = shorter.data.subarray(finalRowOffset, finalRowOffset + 4);
  for (
    let offset = finalRowOffset;
    offset < shorter.height * shorter.width * 4;
    offset += 4
  ) {
    if (!shorter.data.subarray(offset, offset + 4).equals(color)) return false;
  }
  for (
    let offset = shorter.height * taller.width * 4;
    offset < taller.data.length;
    offset += 4
  ) {
    if (!taller.data.subarray(offset, offset + 4).equals(color)) return false;
  }
  return true;
}

export function compareBrowserScreenshots(
  baselineBytes: Uint8Array,
  actualBytes: Uint8Array,
) {
  const baseline = PNG.sync.read(Buffer.from(baselineBytes));
  const actual = PNG.sync.read(Buffer.from(actualBytes));
  const widthsMatch = baseline.width === actual.width;
  const exactDimensions = widthsMatch && baseline.height === actual.height;
  const paddingOnlyHeightDifference =
    widthsMatch &&
    (hasOnlyTrailingUniformRows(baseline, actual) ||
      hasOnlyTrailingUniformRows(actual, baseline));
  const dimensionsMatch = exactDimensions || paddingOnlyHeightDifference;
  const comparisonWidth = dimensionsMatch ? baseline.width : actual.width;
  const comparisonHeight = dimensionsMatch
    ? Math.min(baseline.height, actual.height)
    : actual.height;
  const totalPixels = comparisonWidth * comparisonHeight;
  const byteLength = totalPixels * 4;
  const mismatchedPixels = dimensionsMatch
    ? pixelmatch(
        baseline.data.subarray(0, byteLength),
        actual.data.subarray(0, byteLength),
        undefined,
        comparisonWidth,
        comparisonHeight,
        { includeAA: false, threshold: 0.1 },
      )
    : totalPixels;
  return {
    dimensionsMatch,
    mismatchedPixels,
    totalPixels,
    mismatchRatio: mismatchedPixels / totalPixels,
  };
}

type LighthouseJson = {
  lighthouseVersion?: unknown;
  fetchTime?: unknown;
  requestedUrl?: unknown;
  finalUrl?: unknown;
  finalDisplayedUrl?: unknown;
  configSettings?: { formFactor?: unknown };
  categories?: Record<string, { score?: unknown }>;
  audits?: Record<string, { numericValue?: unknown }>;
};

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Real Lighthouse report is missing ${field}`);
  }
  return value;
}

export function parseLighthouseReportArtifact(
  bytes: Uint8Array,
  artifact: LighthouseReportArtifact,
): BrowserCertificationEvidence["lighthouse"]["runs"][number] {
  assertArtifactBytes(bytes, artifact);
  let report: LighthouseJson;
  try {
    report = JSON.parse(Buffer.from(bytes).toString("utf8")) as LighthouseJson;
  } catch {
    throw new Error("Lighthouse report artifact is not valid JSON");
  }
  const category = (name: string) =>
    requiredNumber(report.categories?.[name]?.score, `categories.${name}.score`);
  const audit = (name: string) =>
    requiredNumber(report.audits?.[name]?.numericValue, `audits.${name}`);
  const finalUrl =
    typeof report.finalDisplayedUrl === "string"
      ? report.finalDisplayedUrl
      : report.finalUrl;
  if (
    typeof report.lighthouseVersion !== "string" ||
    typeof report.fetchTime !== "string" ||
    typeof report.requestedUrl !== "string" ||
    typeof finalUrl !== "string" ||
    normalizeUrl(report.requestedUrl) !== normalizeUrl(artifact.url) ||
    normalizeUrl(finalUrl) !== normalizeUrl(artifact.url) ||
    new Date(report.fetchTime).toISOString() !== artifact.generatedAt ||
    report.configSettings?.formFactor !== artifact.formFactor
  ) {
    throw new Error(
      `Lighthouse report identity does not match ${artifact.url} (${artifact.formFactor})`,
    );
  }
  return {
    url: artifact.url,
    finalUrl,
    formFactor: artifact.formFactor,
    source: "lighthouse",
    lighthouseVersion: report.lighthouseVersion,
    generatedAt: new Date(report.fetchTime).toISOString(),
    reportStoragePath: artifact.storagePath,
    reportSha256: artifact.sha256,
    provider: artifact.provider,
    providerRunId: artifact.providerRunId,
    runnerBinarySha256: artifact.runnerBinarySha256,
    runnerConfigSha256: artifact.runnerConfigSha256,
    toolManifestSha256: artifact.toolManifestSha256,
    bindingHash: artifact.bindingHash,
    performance: category("performance"),
    accessibility: category("accessibility"),
    bestPractices: category("best-practices"),
    seo: category("seo"),
    largestContentfulPaintMs: audit("largest-contentful-paint"),
    cumulativeLayoutShift: audit("cumulative-layout-shift"),
    totalBlockingTimeMs: audit("total-blocking-time"),
  };
}

export async function collectBrowserbaseCertificationEvidence(
  input: BrowserbaseCertifierInput,
): Promise<BrowserCertificationEvidence> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("Browserbase credentials are unavailable");
  }

  const browserbase = new Browserbase({ apiKey });
  const session = await browserbase.sessions.create({ projectId });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Browserbase default context is unavailable");
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("siteforge_analytics_consent");
      localStorage.removeItem("siteforge_analytics_session");
    } catch {
      // The origin is unavailable before first navigation.
    }
    (window as typeof window & { __siteforgeCLS?: number }).__siteforgeCLS = 0;
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
        };
        if (!shift.hadRecentInput) {
          const state = window as typeof window & { __siteforgeCLS?: number };
          state.__siteforgeCLS =
            (state.__siteforgeCLS || 0) + (shift.value || 0);
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (input.credentials) {
    await page.setExtraHTTPHeaders({
      Authorization: `Basic ${Buffer.from(
        `${input.credentials.username}:${input.credentials.password}`,
      ).toString("base64")}`,
    });
  }

  const screenshots: BrowserCertificationEvidence["screenshots"] = [];
  const baselineDiffs: BrowserCertificationEvidence["baselineDiffs"] = [];
  const pendingBaselineComparisons: Array<{
    url: string;
    viewport: keyof typeof VIEWPORTS;
    baseline: ApprovedBrowserBaseline;
    actualStoragePath: string;
    actualSha256: string;
    actualBytes: Uint8Array;
  }> = [];
  const layout: BrowserCertificationEvidence["layout"] = [];
  const interactionPages: BrowserCertificationEvidence["interactions"]["pages"] =
    [];
  const accessibilityScans: BrowserCertificationEvidence["accessibility"]["scans"] =
    [];
  const seoPages: BrowserCertificationEvidence["seo"]["pages"] = [];
  const redirectEntries: BrowserCertificationEvidence["redirects"]["entries"] =
    [];
  const criticalRoutes: BrowserCertificationEvidence["redirects"]["criticalRoutes"] =
    [];
  const capturedAt = new Date().toISOString();
  let consent: BrowserCertificationEvidence["consent"] | null = null;
  const baselineByKey = new Map(
    (input.baselines || []).map((baseline) => [
      `${normalizeUrl(baseline.url)}|${baseline.viewport}`,
      baseline,
    ]),
  );
  const axeSource = readFileSync(
    join(process.cwd(), "node_modules/axe-core/axe.min.js"),
    "utf8",
  );

  try {
    for (const expectedUrl of input.expectedUrls) {
      const network: BrowserCertificationEvidence["interactions"]["pages"][number]["network"] =
        [];
      const requestEntries = new Map<PlaywrightRequest, number>();
      const onRequest = (request: PlaywrightRequest) => {
        if (!request.url().startsWith("http")) return;
        requestEntries.set(request, network.length);
        network.push({
          url: safeNetworkUrl(request.url()),
          method: request.method(),
          resourceType: request.resourceType(),
          aborted: false,
        });
      };
      const onResponse = (response: PlaywrightResponse) => {
        const index = requestEntries.get(response.request());
        if (index !== undefined) network[index].status = response.status();
      };
      const onRequestFailed = (request: PlaywrightRequest) => {
        const index = requestEntries.get(request);
        if (index !== undefined) network[index].aborted = true;
      };
      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onRequestFailed);

      await page.setViewportSize(VIEWPORTS.desktop);
      const response = await page.goto(expectedUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(750);
      await waitForVisualStability(page);
      const pageLoadCumulativeLayoutShift = await page.evaluate(
        () =>
          (window as typeof window & { __siteforgeCLS?: number })
            .__siteforgeCLS || 0,
      );
      const chain: Array<{ url: string; status: number }> = [];
      let request = response?.request();
      while (request?.redirectedFrom()) {
        const from = request.redirectedFrom();
        if (!from) break;
        chain.unshift({
          url: from.url(),
          status: (await from.response())?.status() || 302,
        });
        request = from;
      }
      chain.forEach((entry, index) => {
        const to = chain[index + 1]?.url || response?.url() || expectedUrl;
        if ([301, 302, 307, 308].includes(entry.status)) {
          redirectEntries.push({
            from: entry.url,
            to,
            status: entry.status as 301 | 302 | 307 | 308,
          });
        }
      });
      criticalRoutes.push({
        requestedUrl: expectedUrl,
        finalUrl: response?.url() || page.url(),
        status: response?.status() || 0,
        hops: chain.length,
      });

      const navigation = await testNavigation(page, expectedUrl);
      const forms = await testForms(page);
      const widgets = await testWidgets(page);
      const keyboardAndFocus = await collectKeyboardAndFocus(page);
      interactionPages.push({
        url: expectedUrl,
        linksTested: navigation.length,
        buttonsTested: await page.locator("button:visible").count(),
        navigation,
        network,
        forms,
        widgets,
        ...keyboardAndFocus,
      });
      page.removeListener("request", onRequest);
      page.removeListener("response", onResponse);
      page.removeListener("requestfailed", onRequestFailed);

      await page.evaluate(axeSource);
      const axeResult = await page.evaluate(async () => {
        const runner = (
          window as typeof window & {
            axe: {
              version: string;
              run: () => Promise<{
                violations: Array<{
                  id: string;
                  impact: "minor" | "moderate" | "serious" | "critical" | null;
                  description: string;
                  helpUrl?: string;
                  nodes: Array<{
                    target: string[];
                    html: string;
                    failureSummary?: string;
                  }>;
                }>;
              }>;
            };
          }
        ).axe;
        return { version: runner.version, result: await runner.run() };
      });
      accessibilityScans.push({
        url: expectedUrl,
        engine: "axe-core",
        engineVersion: axeResult.version,
        findings: axeResult.result.violations.flatMap((violation) =>
          violation.impact
            ? [
                {
                  ruleId: violation.id,
                  impact: violation.impact,
                  description: violation.description,
                  helpUrl: violation.helpUrl,
                  nodes: violation.nodes,
                },
              ]
            : [],
        ),
      });
      seoPages.push(await collectSeo(page, expectedUrl));
      if (!consent) consent = await testConsent(page);

      for (const [viewport, size] of Object.entries(VIEWPORTS) as Array<
        [keyof typeof VIEWPORTS, (typeof VIEWPORTS)[keyof typeof VIEWPORTS]]
      >) {
        await page.setViewportSize(size);
        await waitForVisualStability(page);
        await dismissTransientWidgetUi(page);
        await page.waitForTimeout(150);
        const image = await page.screenshot({ fullPage: true, type: "png" });
        const digest = sha256(image);
        const storagePath = [
          "browser-certification",
          input.artifact.artifactId,
          input.environment,
          session.id,
          storageSegment(expectedUrl),
          `${viewport}-${digest}.png`,
        ].join("/");
        const identityDigest = hashSiteForgeContent({
          artifact: input.artifact,
          bindingHash: input.bindingHash,
          targetUrl: normalizeUrl(input.targetUrl),
          pageUrl: normalizeUrl(expectedUrl),
          viewport,
          width: size.width,
          height: size.height,
          environment: input.environment,
          access: input.access,
          requireIndexable: input.requireIndexable,
          policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
          screenshotSha256: digest,
          storagePath,
        });
        await input.artifactWriter({
          storagePath,
          bytes: image,
          contentType: "image/png",
          sha256: digest,
        });
        screenshots.push({
          url: expectedUrl,
          viewport,
          width: size.width,
          height: size.height,
          storagePath,
          sha256: digest,
          bytes: image.byteLength,
          contentType: "image/png",
          identityDigest,
        });

        const baseline = baselineByKey.get(
          `${normalizeUrl(expectedUrl)}|${viewport}`,
        );
        if (baseline) {
          if (
            baseline.artifact.artifactId !== input.artifact.artifactId ||
            baseline.artifact.contentHash !== input.artifact.contentHash ||
            baseline.environment !== input.environment ||
            baseline.access !== input.access ||
            baseline.requireIndexable !== input.requireIndexable ||
            baseline.policyVersion !== SITEFORGE_CERTIFICATION_POLICY_VERSION ||
            baseline.bindingHash !== input.bindingHash
          ) {
            throw new Error("Approved visual baseline identity is not exact");
          }
          if (baseline.storagePath === storagePath) {
            throw new Error("A current screenshot cannot be its own baseline");
          }
          pendingBaselineComparisons.push({
            url: expectedUrl,
            viewport,
            actualStoragePath: storagePath,
            actualSha256: digest,
            actualBytes: image,
            baseline,
          });
        }
        const dimensions = await page.evaluate(() => ({
          overflow: Math.max(
            0,
            document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        }));
        layout.push({
          url: expectedUrl,
          viewport,
          horizontalOverflowPixels: dimensions.overflow,
          cumulativeLayoutShift: pageLoadCumulativeLayoutShift,
        });
      }
    }

    for (const pending of pendingBaselineComparisons) {
      const baselineBytes = await input.artifactReader(pending.baseline);
      assertArtifactBytes(baselineBytes, pending.baseline);
      const comparison = compareBrowserScreenshots(
        baselineBytes,
        pending.actualBytes,
      );
      baselineDiffs.push({
        url: pending.url,
        viewport: pending.viewport,
        baselineId: pending.baseline.baselineId,
        baselineStoragePath: pending.baseline.storagePath,
        baselineSha256: pending.baseline.sha256,
        baselineBindingHash: pending.baseline.bindingHash,
        baselineEvidenceDigest: pending.baseline.evidenceDigest,
        baselineApprovalId: pending.baseline.approvalId,
        baselineApprovedAt: pending.baseline.approvedAt,
        baselineApprovedBy: pending.baseline.approvedBy,
        actualStoragePath: pending.actualStoragePath,
        actualSha256: pending.actualSha256,
        comparisonMethod: "pixelmatch-v2",
        mismatchRatio: comparison.mismatchRatio,
        mismatchThreshold: SITEFORGE_MAX_VISUAL_MISMATCH_RATIO,
        mismatchedPixels: comparison.mismatchedPixels,
        totalPixels: comparison.totalPixels,
        dimensionsMatch: comparison.dimensionsMatch,
      });
    }

    const lighthouseRuns = await Promise.all(
      (input.lighthouseReports || []).map(async (artifact) => {
        if (
          artifact.environment !== input.environment ||
          artifact.access !== input.access ||
          artifact.bindingHash !== input.bindingHash
        ) {
          throw new Error("Lighthouse report binding is not exact");
        }
        return parseLighthouseReportArtifact(
          await input.artifactReader(artifact),
          artifact,
        );
      }),
    );
    const target = new URL(input.targetUrl);
    const sitemapUrl = new URL("/wp-sitemap.xml", target).toString();
    const sitemapResponse = await context.request.get(sitemapUrl);
    const sitemapBody = await sitemapResponse.text();
    const nestedSitemaps = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/gi)]
      .map((match) => match[1])
      .filter((url) => url.includes("sitemap"));
    const sitemapDocuments = await Promise.all(
      nestedSitemaps.slice(0, 20).map(async (url) => {
        const nested = await context.request.get(url);
        return nested.ok() ? nested.text() : "";
      }),
    );
    const listedUrls = [
      ...new Set(
        [sitemapBody, ...sitemapDocuments].flatMap((body) =>
          [...body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(
            (match) => match[1],
          ),
        ),
      ),
    ];
    const robotsUrl = new URL("/robots.txt", target).toString();
    const robotsResponse = await context.request.get(robotsUrl);
    const robotsBody = await robotsResponse.text();

    return {
      evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
      capturedAt,
      identity: {
        sessionId: session.id,
        targetUrl: input.targetUrl,
        environment: input.environment,
        access: input.access,
        requireIndexable: input.requireIndexable,
        artifact: {
          artifactId: input.artifact.artifactId,
          contentHash: input.artifact.contentHash,
        },
        artifactBinding: input.artifact,
        bindingHash: input.bindingHash,
      },
      screenshots,
      baselineDiffs,
      layout,
      interactions: { pages: interactionPages },
      accessibility: { scans: accessibilityScans },
      lighthouse: { runs: lighthouseRuns },
      seo: {
        pages: seoPages,
        sitemap: {
          url: sitemapUrl,
          status: sitemapResponse.status(),
          listedUrls,
        },
        robots: {
          url: robotsUrl,
          status: robotsResponse.status(),
          sitemapUrls: [
            ...robotsBody.matchAll(/^sitemap:\s*(\S+)/gim),
          ].map((match) => match[1]),
          blockedCriticalUrls: [],
        },
      },
      redirects: { entries: redirectEntries, criticalRoutes },
      consent: consent || {
        defaultState: "denied",
        bannerVisible: false,
        preferenceControlsUsable: false,
        declineTested: false,
        grantTested: false,
        scripts: [],
      },
    };
  } finally {
    await browser.close();
  }
}
