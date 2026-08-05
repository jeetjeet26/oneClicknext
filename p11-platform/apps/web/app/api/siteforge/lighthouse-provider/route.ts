import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRequestContext } from "@/utils/services/request-context";
import { canonicalizeSiteForgeContent } from "@/utils/siteforge/content-hash";
import { SITEFORGE_CERTIFICATION_POLICY_VERSION } from "@/utils/siteforge/verification/browser-evidence";
import { certificationArtifactBindingSchema } from "@/utils/siteforge/verification/certification-binding";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE = "/api/siteforge/lighthouse-provider";
const PAGESPEED_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PAGESPEED_CATEGORIES = [
  "accessibility",
  "best-practices",
  "performance",
  "seo",
] as const;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BODY_BYTES = 8 * 1024 * 1024;
const MAX_EXPECTED_URLS = 20;
const PAGESPEED_TIMEOUT_MS = 60_000;
const PAGESPEED_CONCURRENCY = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_URLS_PER_WINDOW = 40;

const requestSchema = z
  .object({
    policyVersion: z.literal(SITEFORGE_CERTIFICATION_POLICY_VERSION),
    targetUrl: z.string().url().max(2_048),
    expectedUrls: z
      .array(z.string().url().max(2_048))
      .min(1)
      .max(MAX_EXPECTED_URLS),
    credentials: z
      .object({
        username: z.string().min(1).max(500),
        password: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    environment: z.enum(["staging", "production"]),
    access: z.enum(["protected", "public"]),
    requireIndexable: z.boolean(),
    artifact: certificationArtifactBindingSchema,
    bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    formFactors: z.tuple([z.literal("mobile")]),
  })
  .strict();

const scoredCategorySchema = z
  .object({ score: z.number().min(0).max(1) })
  .passthrough();
const numericAuditSchema = z
  .object({ numericValue: z.number().finite().min(0) })
  .passthrough();
const lighthouseConfigSchema = z
  .object({
    formFactor: z.literal("mobile").optional(),
    emulatedFormFactor: z.literal("mobile").optional(),
  })
  .passthrough()
  .refine(
    (config) =>
      config.formFactor === "mobile" ||
      config.emulatedFormFactor === "mobile",
    "Mobile Lighthouse config metadata is required",
  );
const lighthouseReportSchema = z
  .object({
    lighthouseVersion: z.string().min(1).max(100),
    fetchTime: z.string().datetime({ offset: true }),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url().optional(),
    finalDisplayedUrl: z.string().url().optional(),
    userAgent: z.string().min(1).max(2_000),
    environment: z
      .object({
        networkUserAgent: z.string().min(1).max(2_000),
        hostUserAgent: z.string().min(1).max(2_000),
        benchmarkIndex: z.number().finite().min(0),
      })
      .passthrough(),
    configSettings: lighthouseConfigSchema,
    categories: z
      .object({
        accessibility: scoredCategorySchema,
        "best-practices": scoredCategorySchema,
        performance: scoredCategorySchema,
        seo: scoredCategorySchema,
      })
      .passthrough(),
    audits: z
      .object({
        "largest-contentful-paint": numericAuditSchema,
        "cumulative-layout-shift": numericAuditSchema,
        "total-blocking-time": numericAuditSchema,
      })
      .passthrough(),
  })
  .passthrough()
  .refine(
    (report) => Boolean(report.finalDisplayedUrl || report.finalUrl),
    "Lighthouse final URL metadata is required",
  );
const pageSpeedResponseSchema = z
  .object({ lighthouseResult: lighthouseReportSchema })
  .passthrough();

type LighthouseReport = z.infer<typeof lighthouseReportSchema>;
type Resolver = typeof lookup;

class RequestBodyTooLargeError extends Error {}
class UnsafeTargetError extends Error {}
class UpstreamProviderError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503 | 504 = 502,
    readonly code = "SITEFORGE_LIGHTHOUSE_UPSTREAM_FAILED",
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "UpstreamProviderError";
  }
}

let rateWindowStartedAt = 0;
let rateWindowUrlCount = 0;

export function resetLighthouseProviderRateLimitForTests(): void {
  rateWindowStartedAt = 0;
  rateWindowUrlCount = 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hasValidLighthouseProviderAuthorization(
  authorization: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (
    !authorization?.startsWith("Bearer ") ||
    !expectedSecret ||
    expectedSecret.length < 32
  ) {
    return false;
  }
  return timingSafeEqual(
    secretDigest(authorization.slice("Bearer ".length)),
    secretDigest(expectedSecret),
  );
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const candidate = mapped || normalized;
  if (isIP(candidate) === 4) {
    const [a, b, c] = candidate.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function assertStrictHttpsUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    url.protocol !== "https:" ||
    Boolean(url.username || url.password || url.hash) ||
    (url.port !== "" && url.port !== "443") ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    (!hostname.includes(".") && isIP(hostname) === 0) ||
    (isIP(hostname) !== 0 && isPrivateOrReservedAddress(hostname))
  ) {
    throw new UnsafeTargetError(
      "Lighthouse targets must be public HTTPS URLs",
    );
  }
  return url;
}

export async function validateLighthouseTargetUrls(
  targetUrl: string,
  expectedUrls: string[],
  resolver: Resolver = lookup,
): Promise<URL[]> {
  const target = assertStrictHttpsUrl(targetUrl);
  const expected = expectedUrls.map(assertStrictHttpsUrl);
  const normalizedExpected = new Set(expected.map((url) => normalizedUrl(url.toString())));
  if (
    normalizedExpected.size !== expected.length ||
    !normalizedExpected.has(normalizedUrl(target.toString())) ||
    expected.some((url) => url.origin !== target.origin)
  ) {
    throw new UnsafeTargetError(
      "Expected URLs must be unique, exact members of the target HTTPS origin",
    );
  }

  const hosts = [...new Set(expected.map((url) => url.hostname))];
  await Promise.all(
    hosts.map(async (hostname) => {
      const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
      if (isIP(unwrappedHostname) !== 0) return;
      let addresses: Array<{ address: string }>;
      try {
        addresses = await resolver(unwrappedHostname, { all: true });
      } catch {
        throw new UnsafeTargetError("Lighthouse target DNS resolution failed");
      }
      if (
        !Array.isArray(addresses) ||
        addresses.length === 0 ||
        addresses.some(({ address }) => isPrivateOrReservedAddress(address))
      ) {
        throw new UnsafeTargetError(
          "Lighthouse targets must not resolve to private or reserved addresses",
        );
      }
    }),
  );
  return expected;
}

function consumeRateLimit(urlCount: number, now = Date.now()): number | null {
  if (
    rateWindowStartedAt === 0 ||
    now - rateWindowStartedAt >= RATE_LIMIT_WINDOW_MS
  ) {
    rateWindowStartedAt = now;
    rateWindowUrlCount = 0;
  }
  if (rateWindowUrlCount + urlCount > RATE_LIMIT_URLS_PER_WINDOW) {
    return Math.max(
      1,
      Math.ceil(
        (RATE_LIMIT_WINDOW_MS - (now - rateWindowStartedAt)) / 1_000,
      ),
    );
  }
  rateWindowUrlCount += urlCount;
  return null;
}

async function readLimitedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pageSpeedRequestUrl(targetUrl: string): URL {
  const url = new URL(PAGESPEED_ENDPOINT);
  url.searchParams.set("url", targetUrl);
  url.searchParams.set("strategy", "mobile");
  for (const category of PAGESPEED_CATEGORIES) {
    url.searchParams.append("category", category);
  }
  const apiKey = process.env.PAGESPEED_INSIGHTS_API_KEY;
  if (apiKey) url.searchParams.set("key", apiKey);
  return url;
}

async function parseUpstreamJson(response: Response): Promise<unknown> {
  const declaredBytes = Number(response.headers.get("content-length") || "0");
  if (
    !Number.isFinite(declaredBytes) ||
    declaredBytes > MAX_UPSTREAM_BODY_BYTES
  ) {
    throw new UpstreamProviderError("PageSpeed response exceeded size limit");
  }
  let text: string;
  try {
    text = await readLimitedStream(response.body, MAX_UPSTREAM_BODY_BYTES);
  } catch (cause) {
    if (cause instanceof RequestBodyTooLargeError) {
      throw new UpstreamProviderError(
        "PageSpeed response exceeded size limit",
      );
    }
    throw cause;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamProviderError("PageSpeed returned invalid JSON");
  }
}

function assertExactReportIdentity(
  report: LighthouseReport,
  expectedUrl: string,
): void {
  const finalUrl = report.finalDisplayedUrl || report.finalUrl;
  if (
    normalizedUrl(report.requestedUrl) !== normalizedUrl(expectedUrl) ||
    !finalUrl ||
    normalizedUrl(finalUrl) !== normalizedUrl(expectedUrl)
  ) {
    throw new UpstreamProviderError(
      "PageSpeed returned mismatched Lighthouse URL metadata",
    );
  }
}

function buildProviderRun(report: LighthouseReport, expectedUrl: string) {
  assertExactReportIdentity(report, expectedUrl);
  const normalizedConfig = JSON.parse(
    canonicalizeSiteForgeContent({
      ...report.configSettings,
      formFactor: "mobile",
    }),
  ) as Record<string, unknown>;
  const normalizedReport = {
    ...report,
    configSettings: normalizedConfig,
  };
  const reportBytes = Buffer.from(
    canonicalizeSiteForgeContent(normalizedReport),
    "utf8",
  );
  const reportSha256 = sha256(reportBytes);
  const runnerIdentity = {
    engine: "lighthouse",
    executionProvider: "google-pagespeed-insights",
    benchmarkIndex: report.environment.benchmarkIndex,
    hostUserAgent: report.environment.hostUserAgent,
    lighthouseVersion: report.lighthouseVersion,
    networkUserAgent: report.environment.networkUserAgent,
    providerApi: "pagespeedonline-v5",
    userAgent: report.userAgent,
  };
  const runnerBinarySha256 = sha256(
    canonicalizeSiteForgeContent(runnerIdentity),
  );
  const runnerConfigSha256 = sha256(
    canonicalizeSiteForgeContent(normalizedConfig),
  );
  const toolManifest = {
    schemaVersion: "siteforge-lighthouse-tool-manifest-v1",
    provider: "google-pagespeed-insights",
    providerApi: "pagespeedonline-v5",
    strategy: "mobile",
    categories: [...PAGESPEED_CATEGORIES],
    runnerIdentity,
    runnerBinarySha256,
    runnerConfigSha256,
  };
  const toolManifestSha256 = sha256(
    canonicalizeSiteForgeContent(toolManifest),
  );
  const generatedAt = new Date(report.fetchTime).toISOString();
  const providerRunId = `psi-${sha256(
    canonicalizeSiteForgeContent({
      generatedAt,
      lighthouseVersion: report.lighthouseVersion,
      reportSha256,
      url: normalizedUrl(expectedUrl),
    }),
  ).slice(0, 48)}`;

  return {
    url: expectedUrl,
    formFactor: "mobile" as const,
    providerRunId,
    generatedAt,
    reportBase64: reportBytes.toString("base64"),
    reportSha256,
    runnerBinarySha256,
    runnerConfigSha256,
    toolManifestSha256,
  };
}

async function runPageSpeed(
  expectedUrl: string,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(pageSpeedRequestUrl(expectedUrl), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new UpstreamProviderError(
        "PageSpeed request timed out",
        504,
        "SITEFORGE_LIGHTHOUSE_UPSTREAM_TIMEOUT",
      );
    }
    throw new UpstreamProviderError("PageSpeed request failed");
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamProviderError(
        "PageSpeed rate limit exceeded",
        503,
        "SITEFORGE_LIGHTHOUSE_UPSTREAM_RATE_LIMITED",
        response.headers.get("retry-after") || "60",
      );
    }
    throw new UpstreamProviderError(
      `PageSpeed failed with HTTP ${response.status}`,
    );
  }
  const parsed = pageSpeedResponseSchema.safeParse(
    await parseUpstreamJson(response),
  );
  if (!parsed.success) {
    throw new UpstreamProviderError(
      "PageSpeed omitted required Lighthouse metadata",
    );
  }
  return buildProviderRun(parsed.data.lighthouseResult, expectedUrl);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

function errorResponse(
  ctx: ReturnType<typeof createRequestContext>,
  status: number,
  error: string,
  code?: string,
  retryAfter?: string,
) {
  return NextResponse.json(
    code ? { error, code } : { error },
    {
      status,
      headers: {
        ...ctx.responseHeaders,
        ...(retryAfter ? { "retry-after": retryAfter } : {}),
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, ROUTE);
  ctx.logStart();

  if (
    !hasValidLighthouseProviderAuthorization(
      request.headers.get("authorization"),
      process.env.SITEFORGE_LIGHTHOUSE_PROVIDER_SECRET,
    )
  ) {
    ctx.logSuccess(401, { reason: "unauthorized" });
    return errorResponse(ctx, 401, "Unauthorized");
  }

  const declaredBytes = Number(request.headers.get("content-length") || "0");
  if (
    !Number.isFinite(declaredBytes) ||
    declaredBytes > MAX_REQUEST_BODY_BYTES
  ) {
    ctx.logSuccess(413, { reason: "request_too_large" });
    return errorResponse(ctx, 413, "Request body is too large");
  }

  let rawBody: string;
  try {
    rawBody = await readLimitedStream(request.body, MAX_REQUEST_BODY_BYTES);
  } catch (cause) {
    if (cause instanceof RequestBodyTooLargeError) {
      ctx.logSuccess(413, { reason: "request_too_large" });
      return errorResponse(ctx, 413, "Request body is too large");
    }
    ctx.logError(400, cause);
    return errorResponse(ctx, 400, "Invalid Lighthouse provider request");
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    ctx.logSuccess(400, { reason: "invalid_json" });
    return errorResponse(ctx, 400, "Invalid Lighthouse provider request");
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    ctx.logSuccess(400, { reason: "invalid_request" });
    return errorResponse(ctx, 400, "Invalid Lighthouse provider request");
  }
  if (parsed.data.access !== "public" || parsed.data.credentials) {
    ctx.logSuccess(400, { reason: "unsupported_protected_target" });
    return errorResponse(
      ctx,
      400,
      "PageSpeed Lighthouse supports public targets only",
    );
  }

  const retryAfterSeconds = consumeRateLimit(parsed.data.expectedUrls.length);
  if (retryAfterSeconds !== null) {
    ctx.logSuccess(429, { reason: "rate_limited" });
    return errorResponse(
      ctx,
      429,
      "Lighthouse provider rate limit exceeded",
      "SITEFORGE_LIGHTHOUSE_RATE_LIMITED",
      String(retryAfterSeconds),
    );
  }

  try {
    const expectedUrls = await validateLighthouseTargetUrls(
      parsed.data.targetUrl,
      parsed.data.expectedUrls,
    );
    const runs = await mapWithConcurrency(
      expectedUrls.map((url) => url.toString()),
      PAGESPEED_CONCURRENCY,
      (url) => runPageSpeed(url),
    );
    ctx.logSuccess(200, {
      environment: parsed.data.environment,
      pages: runs.length,
      provider: "google-pagespeed-insights",
    });
    return NextResponse.json(
      { runs },
      { headers: ctx.responseHeaders },
    );
  } catch (cause) {
    if (cause instanceof UnsafeTargetError) {
      ctx.logSuccess(400, { reason: "unsafe_target" });
      return errorResponse(ctx, 400, cause.message);
    }
    const error =
      cause instanceof UpstreamProviderError
        ? cause
        : new UpstreamProviderError("PageSpeed request failed");
    ctx.logError(error.status, error, {
      provider: "google-pagespeed-insights",
    });
    return errorResponse(
      ctx,
      error.status,
      "Lighthouse provider failed",
      error.code,
      error.retryAfter,
    );
  }
}
