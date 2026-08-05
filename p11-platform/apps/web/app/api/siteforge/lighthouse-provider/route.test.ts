import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  POST,
  resetLighthouseProviderRateLimitForTests,
} from "./route";

const SECRET = "lighthouse-provider-secret-that-is-long-enough";
const artifact = {
  artifactId: "11111111-1111-4111-8111-111111111111",
  contentHash: "a".repeat(64),
  runtimePackageSha256: "b".repeat(64),
  runtimeManifestSha256: "c".repeat(64),
  overlayPackageSha256: null,
  assetManifestHash: "d".repeat(64),
  operationSetHash: "e".repeat(64),
};

function providerRequest(
  expectedUrls = ["https://example.com/"],
  options: {
    secret?: string;
    targetUrl?: string;
    body?: Record<string, unknown>;
  } = {},
): NextRequest {
  const targetUrl = options.targetUrl || expectedUrls[0];
  return new Request("https://app.example.com/api/siteforge/lighthouse-provider", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.secret ?? SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      options.body || {
        policyVersion: "siteforge-browser-certification-v13",
        targetUrl,
        expectedUrls,
        environment: "production",
        access: "public",
        requireIndexable: true,
        artifact,
        bindingHash: "f".repeat(64),
        formFactors: ["mobile"],
      },
    ),
  }) as NextRequest;
}

function lighthouseResult(
  url: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    lighthouseVersion: "13.0.0",
    fetchTime: "2026-08-04T18:00:00.000Z",
    requestedUrl: url,
    finalDisplayedUrl: url,
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0",
    environment: {
      networkUserAgent: "Mozilla/5.0 Chrome/140.0.0.0 Mobile",
      hostUserAgent: "Mozilla/5.0 Chrome/140.0.0.0",
      benchmarkIndex: 1_250,
    },
    configSettings: {
      formFactor: "mobile",
      throttlingMethod: "simulate",
      screenEmulation: { mobile: true, width: 412 },
    },
    categories: {
      accessibility: { score: 1 },
      "best-practices": { score: 0.96 },
      performance: { score: 0.91 },
      seo: { score: 1 },
    },
    audits: {
      "largest-contentful-paint": { numericValue: 1_800 },
      "cumulative-layout-shift": { numericValue: 0.01 },
      "total-blocking-time": { numericValue: 75 },
    },
    runWarnings: [],
    ...overrides,
  };
}

function pageSpeedResponse(
  url: string,
  overrides: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      id: url,
      lighthouseResult: lighthouseResult(url, overrides),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("SiteForge Lighthouse provider route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("SITEFORGE_LIGHTHOUSE_PROVIDER_SECRET", SECRET);
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    resetLighthouseProviderRateLimitForTests();
  });

  it("rejects missing or incorrect bearer authorization", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const missing = providerRequest(["https://example.com/"]);
    missing.headers.delete("authorization");
    const missingResponse = await POST(missing);
    const incorrectResponse = await POST(
      providerRequest(["https://example.com/"], { secret: "wrong-secret" }),
    );

    expect(missingResponse.status).toBe(401);
    expect(incorrectResponse.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["private literal", "https://127.0.0.1/", null],
    ["localhost", "https://localhost/", null],
    ["private DNS answer", "https://private.example.com/", "10.0.0.8"],
  ])("rejects SSRF target: %s", async (_label, url, resolvedAddress) => {
    if (resolvedAddress) {
      lookupMock.mockResolvedValueOnce([
        { address: resolvedAddress, family: 4 },
      ]);
    }
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(providerRequest([url]));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for PageSpeed errors and omitted Lighthouse metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("quota", {
          status: 429,
          headers: { "retry-after": "17" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lighthouseResult: {} }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const limited = await POST(providerRequest());
    const malformed = await POST(providerRequest());

    expect(limited.status).toBe(503);
    expect(limited.headers.get("retry-after")).toBe("17");
    await expect(limited.json()).resolves.toEqual({
      error: "Lighthouse provider failed",
      code: "SITEFORGE_LIGHTHOUSE_UPSTREAM_RATE_LIMITED",
    });
    expect(malformed.status).toBe(502);
    await expect(malformed.json()).resolves.toEqual({
      error: "Lighthouse provider failed",
      code: "SITEFORGE_LIGHTHOUSE_UPSTREAM_FAILED",
    });
  });

  it("derives deterministic report and identity digests from PSI metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(pageSpeedResponse("https://example.com/")),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(providerRequest());
    const second = await POST(providerRequest());
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstPayload).toEqual(secondPayload);
    expect(firstPayload.runs).toHaveLength(1);
    const run = firstPayload.runs[0];
    expect(Object.keys(run).sort()).toEqual(
      [
        "formFactor",
        "generatedAt",
        "providerRunId",
        "reportBase64",
        "reportSha256",
        "runnerBinarySha256",
        "runnerConfigSha256",
        "toolManifestSha256",
        "url",
      ].sort(),
    );
    expect(run).toMatchObject({
      url: "https://example.com/",
      formFactor: "mobile",
      generatedAt: "2026-08-04T18:00:00.000Z",
      providerRunId: expect.stringMatching(/^psi-[a-f0-9]{48}$/),
      reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      runnerBinarySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      runnerConfigSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      toolManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const reportBytes = Buffer.from(run.reportBase64, "base64");
    expect(sha256(reportBytes)).toBe(run.reportSha256);
    expect(JSON.parse(reportBytes.toString("utf8"))).toEqual(
      lighthouseResult("https://example.com/"),
    );
  });

  it("normalizes PSI legacy mobile config without inventing audit evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      pageSpeedResponse("https://example.com/", {
        configSettings: {
          emulatedFormFactor: "mobile",
          throttlingMethod: "simulate",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(providerRequest());
    const payload = await response.json();
    const report = JSON.parse(
      Buffer.from(payload.runs[0].reportBase64, "base64").toString("utf8"),
    );

    expect(response.status).toBe(200);
    expect(report.configSettings).toEqual({
      emulatedFormFactor: "mobile",
      formFactor: "mobile",
      throttlingMethod: "simulate",
    });
    expect(report.categories.performance.score).toBe(0.91);
    expect(report.audits["largest-contentful-paint"].numericValue).toBe(1_800);
  });

  it("runs every and only expected URL with fixed mobile PSI categories", async () => {
    const expectedUrls = [
      "https://example.com/",
      "https://example.com/floor-plans?beds=2",
      "https://example.com/amenities",
    ];
    const fetchMock = vi.fn().mockImplementation((input: URL) => {
      const requestUrl = new URL(input);
      return Promise.resolve(
        pageSpeedResponse(requestUrl.searchParams.get("url") || ""),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PAGESPEED_INSIGHTS_API_KEY", "pagespeed-test-key");

    const response = await POST(providerRequest(expectedUrls));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.runs.map((run: { url: string }) => run.url)).toEqual(
      expectedUrls,
    );
    expect(fetchMock).toHaveBeenCalledTimes(expectedUrls.length);
    for (const [input, init] of fetchMock.mock.calls) {
      const requestUrl = new URL(input);
      expect(requestUrl.origin + requestUrl.pathname).toBe(
        "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
      );
      expect(requestUrl.searchParams.get("strategy")).toBe("mobile");
      expect(requestUrl.searchParams.getAll("category")).toEqual([
        "accessibility",
        "best-practices",
        "performance",
        "seo",
      ]);
      expect(requestUrl.searchParams.get("key")).toBe("pagespeed-test-key");
      expect(expectedUrls).toContain(requestUrl.searchParams.get("url"));
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
    }
  });

  it("rejects a PSI report whose requested or final URL is not exact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      pageSpeedResponse("https://example.com/", {
        finalDisplayedUrl: "https://example.com/unexpected",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(providerRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Lighthouse provider failed",
      code: "SITEFORGE_LIGHTHOUSE_UPSTREAM_FAILED",
    });
  });

  it("rate limits URL audit units before making more upstream calls", async () => {
    const expectedUrls = Array.from(
      { length: 20 },
      (_, index) => `https://example.com/page-${index}`,
    );
    const fetchMock = vi.fn().mockImplementation((input: URL) => {
      const requestUrl = new URL(input);
      return Promise.resolve(
        pageSpeedResponse(requestUrl.searchParams.get("url") || ""),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await POST(providerRequest(expectedUrls))).status).toBe(200);
    expect((await POST(providerRequest(expectedUrls))).status).toBe(200);
    const limited = await POST(providerRequest(expectedUrls));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(40);
  });
});
