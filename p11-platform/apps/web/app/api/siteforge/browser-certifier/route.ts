import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRequestContext } from "@/utils/services/request-context";
import { createServiceClient } from "@/utils/supabase/admin";
import {
  collectBrowserbaseCertificationEvidence,
  type LighthouseReportArtifact,
} from "@/utils/siteforge/verification/browserbase-certifier";
import {
  browserCertificationAccessSchema,
  browserCertificationEnvironmentSchema,
  browserCertificationEvidenceSchema,
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
} from "@/utils/siteforge/verification/browser-evidence";
import {
  buildCertificationBindingHash,
  certificationArtifactBindingSchema,
} from "@/utils/siteforge/verification/certification-binding";
import { provisionLighthouseReportArtifacts } from "@/utils/siteforge/verification/lighthouse-provider";
import {
  loadExactApprovedVisualBaselines,
  persistLighthouseEvidence,
  persistVisualBaselineCandidates,
} from "@/utils/siteforge/verification/visual-baselines";
import {
  siteForgeEditAcceptanceContractSchema,
} from "@/utils/siteforge/editor/edit-acceptance";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";

export const maxDuration = 600;

const requestSchema = z.object({
  policyVersion: z.literal(SITEFORGE_CERTIFICATION_POLICY_VERSION),
  targetUrl: z.string().url(),
  expectedUrls: z.array(z.string().url()).min(1).max(20),
  credentials: z
    .object({
      username: z.string().min(1).max(500),
      password: z.string().min(1).max(2_000),
    })
    .optional(),
  environment: browserCertificationEnvironmentSchema,
  access: browserCertificationAccessSchema,
  requireIndexable: z.boolean(),
  artifact: certificationArtifactBindingSchema,
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
  editAcceptanceContract: siteForgeEditAcceptanceContractSchema.optional(),
  parentTargetUrl: z.string().url().optional(),
}).strict();

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hasValidBrowserCertifierAuthorization(
  authorization: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!authorization?.startsWith("Bearer ") || !expectedSecret) return false;
  return timingSafeEqual(
    secretDigest(authorization.slice("Bearer ".length)),
    secretDigest(expectedSecret),
  );
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, "/api/siteforge/browser-certifier");
  ctx.logStart();

  if (
    !hasValidBrowserCertifierAuthorization(
      request.headers.get("authorization"),
      process.env.SITEFORGE_BROWSER_CERTIFIER_SECRET,
    )
  ) {
    ctx.logSuccess(401, { reason: "unauthorized" });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: ctx.responseHeaders },
    );
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    ctx.logSuccess(400, { reason: "invalid_request" });
    return NextResponse.json(
      { error: "Invalid browser certification request" },
      { status: 400, headers: ctx.responseHeaders },
    );
  }

  const targetOrigin = new URL(parsed.data.targetUrl).origin;
  if (
    parsed.data.expectedUrls.some((url) => new URL(url).origin !== targetOrigin)
  ) {
    ctx.logSuccess(400, { reason: "cross_origin_expected_url" });
    return NextResponse.json(
      { error: "Every expected URL must share the target origin" },
      { status: 400, headers: ctx.responseHeaders },
    );
  }

  try {
    const serviceClient = createServiceClient();
    const [{ data: artifact, error: artifactError }] = await Promise.all([
      serviceClient
        .from("siteforge_blueprint_versions")
        .select(
          "id, website_id, org_id, property_id, content_hash, parent_version_id, quality_report, asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, runtime_package_sha256, operation_set_hash",
        )
        .eq("id", parsed.data.artifact.artifactId)
        .eq("content_hash", parsed.data.artifact.contentHash)
        .single(),
    ]);
    if (artifactError || !artifact) {
      throw new Error("Exact certification artifact is unavailable");
    }
    const { data: website, error: websiteError } = await serviceClient
      .from("property_websites")
      .select("id, org_id, property_id")
      .eq("id", artifact.website_id)
      .eq("org_id", artifact.org_id)
      .eq("property_id", artifact.property_id)
      .single();
    if (websiteError || !website) {
      throw new Error("Certification tenant identity is unavailable");
    }
    const expectedRuntimePackage =
      artifact.runtime_package_sha256 || artifact.base_theme_package_sha256;
    if (
      expectedRuntimePackage !== parsed.data.artifact.runtimePackageSha256 ||
      artifact.overlay_package_sha256 !==
        parsed.data.artifact.overlayPackageSha256 ||
      artifact.asset_manifest_hash !== parsed.data.artifact.assetManifestHash ||
      artifact.operation_set_hash !== parsed.data.artifact.operationSetHash
    ) {
      throw new Error("Certification release binding does not match the artifact");
    }
    const storedQuality =
      artifact.quality_report &&
      typeof artifact.quality_report === "object" &&
      !Array.isArray(artifact.quality_report)
        ? (artifact.quality_report as Record<string, unknown>)
        : {};
    const semanticEditor =
      storedQuality.semanticEditor &&
      typeof storedQuality.semanticEditor === "object" &&
      !Array.isArray(storedQuality.semanticEditor)
        ? (storedQuality.semanticEditor as Record<string, unknown>)
        : {};
    const storedAcceptance =
      siteForgeEditAcceptanceContractSchema.safeParse(
        semanticEditor.acceptanceContract,
      );
    if (storedAcceptance.success) {
      if (
        !parsed.data.editAcceptanceContract ||
        hashSiteForgeContent(parsed.data.editAcceptanceContract) !==
          hashSiteForgeContent(storedAcceptance.data) ||
        storedAcceptance.data.parentArtifact.artifactId !==
          artifact.parent_version_id ||
        storedAcceptance.data.editedArtifact.contentHash !==
          artifact.content_hash
      ) {
        throw new Error(
          "Edit acceptance contract does not match the immutable artifact lineage",
        );
      }
    } else if (parsed.data.editAcceptanceContract) {
      throw new Error(
        "Certification request supplied an edit contract absent from the artifact",
      );
    }
    if (parsed.data.environment !== "protected_preview") {
      const { data: runtimePackage, error: runtimePackageError } =
        await serviceClient
          .from("siteforge_runtime_packages")
          .select(
            "package_sha256, manifest_sha256, publication_status, revoked_at",
          )
          .eq("package_sha256", parsed.data.artifact.runtimePackageSha256)
          .eq("publication_status", "published")
          .is("revoked_at", null)
          .maybeSingle();
      if (
        runtimePackageError ||
        !runtimePackage ||
        runtimePackage.manifest_sha256 !==
          parsed.data.artifact.runtimeManifestSha256
      ) {
        throw new Error(
          "Published runtime package and manifest binding is unavailable",
        );
      }
    }
    const expectedBindingHash = buildCertificationBindingHash({
      artifact: parsed.data.artifact,
      targetUrl: parsed.data.targetUrl,
      environment: parsed.data.environment,
      access: parsed.data.access,
      requireIndexable: parsed.data.requireIndexable,
    });
    if (expectedBindingHash !== parsed.data.bindingHash) {
      throw new Error("Certification binding digest is invalid");
    }
    const artifactWriter = async ({
      storagePath,
      bytes,
      contentType,
      sha256,
    }: {
      storagePath: string;
      bytes: Uint8Array;
      contentType: string;
      sha256: string;
    }) => {
      const byteDigest = createHash("sha256").update(bytes).digest("hex");
      if (byteDigest !== sha256) {
        throw new Error(
          `Browser evidence digest does not match bytes: ${storagePath}`,
        );
      }
      const bucket = serviceClient.storage.from("siteforge-artifacts");
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });
      if (error && !error.message.toLowerCase().includes("already exists")) {
        throw new Error(
          `Failed to persist browser evidence ${storagePath}: ${error.message}`,
        );
      }
      if (error) {
        const { data, error: downloadError } =
          await bucket.download(storagePath);
        if (downloadError || !data) {
          throw new Error(
            `Failed to verify existing browser evidence ${storagePath}`,
          );
        }
        const digest = createHash("sha256")
          .update(new Uint8Array(await data.arrayBuffer()))
          .digest("hex");
        if (digest !== sha256) {
          throw new Error(
            `Existing browser evidence digest mismatch: ${storagePath}`,
          );
        }
      }
    };
    const tenant = {
      orgId: artifact.org_id,
      propertyId: artifact.property_id,
      websiteId: artifact.website_id,
    };
    const baselines = await loadExactApprovedVisualBaselines(
      {
        ...tenant,
        artifact: parsed.data.artifact,
        expectedUrls: parsed.data.expectedUrls,
        environment: parsed.data.environment,
        access: parsed.data.access,
        requireIndexable: parsed.data.requireIndexable,
        bindingHash: parsed.data.bindingHash,
      },
      serviceClient,
    );
    let lighthouseReports: LighthouseReportArtifact[] = [];
    if (parsed.data.environment !== "protected_preview") {
      try {
        lighthouseReports = await provisionLighthouseReportArtifacts({
          provisioning: {
            targetUrl: parsed.data.targetUrl,
            expectedUrls: parsed.data.expectedUrls,
            credentials:
              parsed.data.access === "protected"
                ? parsed.data.credentials
                : undefined,
            environment: parsed.data.environment,
            access: parsed.data.access,
            requireIndexable: parsed.data.requireIndexable,
            artifact: parsed.data.artifact,
            bindingHash: parsed.data.bindingHash,
          },
          artifactWriter,
        });
      } catch (error) {
        if (
          parsed.data.environment !== "staging" ||
          !(error instanceof Error) ||
          !/HTTP (?:429|503)|rate limit/i.test(error.message)
        ) {
          throw error;
        }
        ctx.logSuccess(200, {
          reason: "staging_lighthouse_quota_deferred_to_production",
        });
      }
    }
    const evidence = browserCertificationEvidenceSchema.parse(
      await collectBrowserbaseCertificationEvidence({
        ...parsed.data,
        editAcceptanceContract: storedAcceptance.success
          ? storedAcceptance.data
          : undefined,
        baselines,
        lighthouseReports,
        artifactWriter,
        artifactReader: async (descriptor) => {
          const { data, error } = await serviceClient.storage
            .from("siteforge-artifacts")
            .download(descriptor.storagePath);
          if (error || !data) {
            throw new Error(
              `Failed to read browser evidence ${descriptor.storagePath}: ${
                error?.message || "missing blob"
              }`,
            );
          }
          const bytes = new Uint8Array(await data.arrayBuffer());
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (digest !== descriptor.sha256) {
            throw new Error(
              `Browser evidence digest mismatch: ${descriptor.storagePath}`,
            );
          }
          return bytes;
        },
      }),
    );
    const [candidateBaselineIds] = await Promise.all([
      persistVisualBaselineCandidates(
        {
          ...tenant,
          artifact: parsed.data.artifact,
          environment: parsed.data.environment,
          access: parsed.data.access,
          requireIndexable: parsed.data.requireIndexable,
          bindingHash: parsed.data.bindingHash,
          evidence,
        },
        serviceClient,
      ),
      parsed.data.environment === "protected_preview" ||
      lighthouseReports.length === 0
        ? Promise.resolve()
        : persistLighthouseEvidence(
            {
              ...tenant,
              artifact: parsed.data.artifact,
              environment: parsed.data.environment,
              access: parsed.data.access,
              bindingHash: parsed.data.bindingHash,
              reports: lighthouseReports,
            },
            serviceClient,
          ),
    ]);
    ctx.logSuccess(200, {
      environment: parsed.data.environment,
      access: parsed.data.access,
      pages: parsed.data.expectedUrls.length,
      candidateBaselines: candidateBaselineIds.length,
    });
    return NextResponse.json(
      { evidence, candidateBaselineIds },
      { headers: ctx.responseHeaders },
    );
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error("Browser certification failed");
    ctx.logError(502, error);
    return NextResponse.json(
      {
        error: "Browser certification provider failed",
        code: "SITEFORGE_BROWSER_CERTIFICATION_FAILED",
      },
      { status: 502, headers: ctx.responseHeaders },
    );
  }
}
