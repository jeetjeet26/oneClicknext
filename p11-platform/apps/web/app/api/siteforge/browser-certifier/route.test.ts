import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { buildCertificationBindingHash } from "@/utils/siteforge/verification/certification-binding";

const {
  collectEvidenceMock,
  uploadMock,
  downloadMock,
  fromMock,
  loadBaselinesMock,
  persistCandidatesMock,
  persistLighthouseMock,
  provisionLighthouseMock,
} = vi.hoisted(() => ({
  collectEvidenceMock: vi.fn(),
  uploadMock: vi.fn().mockResolvedValue({ error: null }),
  downloadMock: vi.fn(),
  fromMock: vi.fn(),
  loadBaselinesMock: vi.fn().mockResolvedValue([]),
  persistCandidatesMock: vi.fn().mockResolvedValue([]),
  persistLighthouseMock: vi.fn().mockResolvedValue(undefined),
  provisionLighthouseMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/utils/siteforge/verification/browserbase-certifier", () => ({
  collectBrowserbaseCertificationEvidence: collectEvidenceMock,
}));

vi.mock("@/utils/supabase/admin", () => ({
  createServiceClient: vi.fn(() => ({
    from: fromMock,
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        download: downloadMock,
      })),
    },
  })),
}));

vi.mock("@/utils/siteforge/verification/visual-baselines", () => ({
  loadExactApprovedVisualBaselines: loadBaselinesMock,
  persistVisualBaselineCandidates: persistCandidatesMock,
  persistLighthouseEvidence: persistLighthouseMock,
}));

vi.mock("@/utils/siteforge/verification/lighthouse-provider", () => ({
  provisionLighthouseReportArtifacts: provisionLighthouseMock,
}));

const artifactBinding = {
  artifactId: "11111111-1111-4111-8111-111111111111",
  contentHash: "a".repeat(64),
  runtimePackageSha256: "b".repeat(64),
  runtimeManifestSha256: "c".repeat(64),
  overlayPackageSha256: null,
  assetManifestHash: "d".repeat(64),
  operationSetHash: "e".repeat(64),
};

const bindingHash = buildCertificationBindingHash({
  artifact: artifactBinding,
  targetUrl: "https://wordpress.example.com/",
  environment: "production",
  access: "public",
  requireIndexable: true,
});

function request(
  secret = "certifier-secret",
  expectedUrls = ["https://wordpress.example.com/"],
): NextRequest {
  return new Request("http://localhost/api/siteforge/browser-certifier", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      policyVersion: "siteforge-browser-certification-v13",
      targetUrl: "https://wordpress.example.com/",
      expectedUrls,
      environment: "production",
      access: "public",
      requireIndexable: true,
      artifact: artifactBinding,
      bindingHash,
    }),
  }) as NextRequest;
}

describe("SiteForge browser certifier route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      const data =
        table === "siteforge_blueprint_versions"
          ? {
              id: artifactBinding.artifactId,
              website_id: "22222222-2222-4222-8222-222222222222",
              org_id: "33333333-3333-4333-8333-333333333333",
              property_id: "44444444-4444-4444-8444-444444444444",
              content_hash: artifactBinding.contentHash,
              asset_manifest_hash: artifactBinding.assetManifestHash,
              base_theme_package_sha256: "f".repeat(64),
              overlay_package_sha256: null,
              runtime_package_sha256: artifactBinding.runtimePackageSha256,
              operation_set_hash: artifactBinding.operationSetHash,
            }
          : table === "siteforge_runtime_packages"
            ? {
                package_sha256: artifactBinding.runtimePackageSha256,
                manifest_sha256: artifactBinding.runtimeManifestSha256,
                publication_status: "published",
                revoked_at: null,
              }
            : {
              id: "22222222-2222-4222-8222-222222222222",
              org_id: "33333333-3333-4333-8333-333333333333",
              property_id: "44444444-4444-4444-8444-444444444444",
            };
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.is.mockReturnValue(chain);
      return chain;
    });
    vi.stubEnv("SITEFORGE_BROWSER_CERTIFIER_SECRET", "certifier-secret");
    collectEvidenceMock.mockResolvedValue({
      evidenceVersion: "siteforge-browser-evidence-v2",
      capturedAt: new Date().toISOString(),
      identity: {
        sessionId: "session-1",
        targetUrl: "https://wordpress.example.com/",
        environment: "production",
        access: "public",
        requireIndexable: true,
        artifact: {
          artifactId: "11111111-1111-4111-8111-111111111111",
          contentHash: "a".repeat(64),
        },
        artifactBinding,
        bindingHash,
      },
      screenshots: [
        {
          url: "https://wordpress.example.com/",
          viewport: "mobile",
          width: 390,
          height: 844,
          storagePath:
            "browser-certification/11111111-1111-4111-8111-111111111111/production/session/mobile.png",
          sha256: "f".repeat(64),
          bytes: 1024,
          contentType: "image/png",
          identityDigest: "1".repeat(64),
        },
      ],
      baselineDiffs: [
        {
          url: "https://wordpress.example.com/",
          viewport: "mobile",
          baselineId: "55555555-5555-4555-8555-555555555555",
          baselineStoragePath:
            "browser-certification/11111111-1111-4111-8111-111111111111/baselines/mobile.png",
          baselineSha256: "f".repeat(64),
          baselineBindingHash: bindingHash,
          baselineEvidenceDigest: "1".repeat(64),
          baselineApprovalId: "66666666-6666-4666-8666-666666666666",
          baselineApprovedAt: "2026-08-03T18:00:00.000Z",
          baselineApprovedBy: "77777777-7777-4777-8777-777777777777",
          actualStoragePath:
            "browser-certification/11111111-1111-4111-8111-111111111111/production/session/mobile.png",
          actualSha256: "f".repeat(64),
          comparisonMethod: "pixelmatch-v2",
          mismatchRatio: 0,
          mismatchThreshold: 0.0002,
          mismatchedPixels: 0,
          totalPixels: 329160,
          dimensionsMatch: true,
        },
      ],
      layout: [
        {
          url: "https://wordpress.example.com/",
          viewport: "mobile",
          horizontalOverflowPixels: 0,
          cumulativeLayoutShift: 0.01,
        },
      ],
      interactions: {
        pages: [
          {
            url: "https://wordpress.example.com/",
            linksTested: 1,
            buttonsTested: 2,
            navigation: [
              {
                requestedUrl: "https://wordpress.example.com/floor-plans/",
                finalUrl: "https://wordpress.example.com/floor-plans/",
                status: 200,
                passed: true,
              },
            ],
            network: [
              {
                url: "https://wordpress.example.com/api/leads",
                method: "POST",
                resourceType: "fetch",
                aborted: true,
              },
            ],
            forms: [
              {
                id: "lead-form",
                attempted: true,
                validationObserved: true,
                destinationVerified: true,
                payloadVerified: true,
                sideEffectPrevented: true,
                request: {
                  url: "https://wordpress.example.com/api/leads",
                  method: "POST",
                  payload: { email: "browser-certification@example.invalid" },
                  aborted: true,
                },
                resultingState: "error",
              },
            ],
            widgets: [{ id: "lumaleasing", opened: true, usable: true }],
            keyboard: { traversed: true, traps: [], unreachableControls: [] },
            focus: { visible: true, orderValid: true, obscuredControls: [] },
          },
        ],
      },
      accessibility: {
        scans: [
          {
            url: "https://wordpress.example.com/",
            engine: "axe-core",
            engineVersion: "4.12.1",
            findings: [],
          },
        ],
      },
      lighthouse: {
        runs: [
          {
            url: "https://wordpress.example.com/",
            finalUrl: "https://wordpress.example.com/",
            formFactor: "mobile",
            source: "lighthouse",
            lighthouseVersion: "13.0.0",
            generatedAt: "2026-08-04T18:00:00.000Z",
            reportStoragePath:
              "browser-certification/11111111-1111-4111-8111-111111111111/production/lighthouse/run.json",
            reportSha256: "2".repeat(64),
            provider: "http-lighthouse",
            providerRunId: "run-1",
            runnerBinarySha256: "3".repeat(64),
            runnerConfigSha256: "4".repeat(64),
            toolManifestSha256: "5".repeat(64),
            bindingHash,
            performance: 0.9,
            accessibility: 1,
            bestPractices: 0.95,
            seo: 1,
            largestContentfulPaintMs: 2000,
            cumulativeLayoutShift: 0.01,
            totalBlockingTimeMs: 100,
          },
        ],
      },
      seo: {
        pages: [
          {
            url: "https://wordpress.example.com/",
            canonicalUrl: "https://wordpress.example.com/",
            openGraph: {
              title: "Example",
              description: "Example property",
              imageUrl: "https://wordpress.example.com/og.png",
              url: "https://wordpress.example.com/",
            },
            jsonLd: [
              { valid: true, types: ["ApartmentComplex"], errors: [] },
            ],
          },
        ],
        sitemap: {
          url: "https://wordpress.example.com/wp-sitemap.xml",
          status: 200,
          listedUrls: ["https://wordpress.example.com/"],
        },
        robots: {
          url: "https://wordpress.example.com/robots.txt",
          status: 200,
          sitemapUrls: ["https://wordpress.example.com/wp-sitemap.xml"],
          blockedCriticalUrls: [],
        },
      },
      redirects: {
        entries: [],
        criticalRoutes: [
          {
            requestedUrl: "https://wordpress.example.com/",
            finalUrl: "https://wordpress.example.com/",
            status: 200,
            hops: 0,
          },
        ],
      },
      consent: {
        defaultState: "denied",
        bannerVisible: true,
        preferenceControlsUsable: true,
        declineTested: true,
        grantTested: true,
        scripts: [],
      },
    });
  });

  it("rejects unauthorized callers", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(collectEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects expected pages outside the target origin", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request("certifier-secret", ["https://attacker.example.com/"]),
    );

    expect(response.status).toBe(400);
    expect(collectEvidenceMock).not.toHaveBeenCalled();
  });

  it("integrates approved baselines, external Lighthouse, and screenshot persistence", async () => {
    loadBaselinesMock.mockResolvedValueOnce([
      {
        baselineId: "55555555-5555-4555-8555-555555555555",
        url: "https://wordpress.example.com/",
        viewport: "mobile",
        storagePath:
          "browser-certification/11111111-1111-4111-8111-111111111111/baselines/mobile.png",
        sha256: "f".repeat(64),
        artifact: {
          artifactId: artifactBinding.artifactId,
          contentHash: artifactBinding.contentHash,
        },
        environment: "production",
        access: "public",
        requireIndexable: true,
        policyVersion: "siteforge-browser-certification-v13",
        bindingHash,
        evidenceDigest: "1".repeat(64),
        approvalId: "66666666-6666-4666-8666-666666666666",
        approvedAt: "2026-08-04T18:00:00.000Z",
        approvedBy: "77777777-7777-4777-8777-777777777777",
      },
    ]);
    provisionLighthouseMock.mockResolvedValueOnce([
      {
        url: "https://wordpress.example.com/",
        formFactor: "mobile",
        storagePath:
          "browser-certification/11111111-1111-4111-8111-111111111111/production/lighthouse/run.json",
        sha256: "2".repeat(64),
        provider: "http-lighthouse",
        providerRunId: "run-1",
        runnerBinarySha256: "3".repeat(64),
        runnerConfigSha256: "4".repeat(64),
        toolManifestSha256: "5".repeat(64),
        environment: "production",
        access: "public",
        bindingHash,
        generatedAt: "2026-08-04T18:00:00.000Z",
      },
    ]);
    const { POST } = await import("./route");
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.evidence).toEqual(
      expect.objectContaining({
        evidenceVersion: "siteforge-browser-evidence-v2",
      }),
    );
    expect(collectEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUrl: "https://wordpress.example.com/",
        environment: "production",
        access: "public",
        requireIndexable: true,
        artifact: expect.objectContaining({
          artifactId: "11111111-1111-4111-8111-111111111111",
        }),
        bindingHash,
        baselines: expect.arrayContaining([
          expect.objectContaining({
            baselineId: "55555555-5555-4555-8555-555555555555",
          }),
        ]),
        lighthouseReports: expect.arrayContaining([
          expect.objectContaining({ providerRunId: "run-1" }),
        ]),
      }),
    );
    const collectorInput = collectEvidenceMock.mock.calls[0][0];
    const screenshot = new Uint8Array([137, 80, 78, 71]);
    await collectorInput.artifactWriter({
      storagePath:
        "browser-certification/11111111-1111-4111-8111-111111111111/production/session/mobile.png",
      bytes: screenshot,
      contentType: "image/png",
      sha256: createHash("sha256").update(screenshot).digest("hex"),
    });
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringContaining("browser-certification/"),
      screenshot,
      { contentType: "image/png", upsert: false },
    );
    expect(persistCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingHash,
        evidence: expect.objectContaining({
          accessibility: {
            scans: [
              expect.objectContaining({
                engine: "axe-core",
                findings: [],
              }),
            ],
          },
          interactions: {
            pages: [
              expect.objectContaining({
                navigation: [expect.objectContaining({ passed: true })],
                forms: [
                  expect.objectContaining({ sideEffectPrevented: true }),
                ],
                widgets: [
                  expect.objectContaining({ opened: true, usable: true }),
                ],
                keyboard: expect.objectContaining({ traversed: true }),
                network: [
                  expect.objectContaining({
                    url: "https://wordpress.example.com/api/leads",
                    aborted: true,
                  }),
                ],
              }),
            ],
          },
          consent: expect.objectContaining({ grantTested: true }),
          baselineDiffs: [
            expect.objectContaining({
              baselineId: "55555555-5555-4555-8555-555555555555",
              mismatchRatio: 0,
            }),
          ],
          lighthouse: {
            runs: [
              expect.objectContaining({
                providerRunId: "run-1",
                bindingHash,
              }),
            ],
          },
        }),
      }),
      expect.anything(),
    );
    expect(persistLighthouseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reports: expect.arrayContaining([
          expect.objectContaining({ providerRunId: "run-1" }),
        ]),
      }),
      expect.anything(),
    );
  });
});
