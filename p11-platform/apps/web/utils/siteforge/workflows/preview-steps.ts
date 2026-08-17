import { FatalError } from "workflow";
import { createServiceClient } from "@/utils/supabase/admin";
import { ACF_BLOCK_TYPES, type GeneratedPage } from "@/types/siteforge";
import type { Json } from "@/types/supabase";
import { normalizeLegacyPages } from "@/utils/siteforge/blueprint";
import { getPropertyContext } from "@/utils/siteforge/brand-intelligence";
import { loadVerifiedSiteForgeRelease } from "@/utils/siteforge/artifacts/release";
import { loadApprovedFloorPlanSnapshot } from "@/utils/siteforge/providers/floor-plan-repository";
import {
  CloudwaysProviderClient,
  getCloudwaysProviderCredentials,
  parseCloudwaysApplicationHostname,
} from "@/utils/siteforge/providers/cloudways-provider";
import { captureOverlayRenderCertification } from "@/utils/siteforge/editor/render-certification";
import {
  deployToExistingWordPress,
  WordPressAPIClient,
} from "@/utils/siteforge/wordpress-client";
import { validateWordPressThemeArtifact } from "@/utils/siteforge/wordpress/theme-artifact";
import {
  parseRenderableSiteForgeLegalConfig,
  siteForgeAnalyticsConfigSchema,
} from "@/utils/siteforge/quality/deterministic-gates";
import { loadSiteForgePublicRuntimeConfig } from "@/utils/siteforge/public-runtime";
import { brandForgeContractV1Schema } from "@/utils/brandforge/contracts";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";
import {
  buildRenderedCertificationTruth,
  certifyRenderedWordPressArtifact,
} from "@/utils/siteforge/verification/rendered-certification";
import { buildReleaseCertificationBinding } from "@/utils/siteforge/verification/certification-binding";
import { deployVerifiedReleaseThroughRuntime } from "@/utils/siteforge/workflows/runtime-preview";
import { SiteForgeRuntimeClient } from "@/utils/siteforge/wordpress/runtime-client";
import {
  SshWordPressInstaller,
  type WordPressSshCredentials,
} from "@/utils/siteforge/wordpress/wordpress-installer";
import { deployArtifactBoundRuntimeV3 } from "@/utils/siteforge/workflows/runtime-deployment-v3";
import {
  propertyContextFromOnboardingSnapshot,
  runtimePropertyProfile,
} from "@/utils/siteforge/property-context";

export interface SiteForgePreviewWorkflowInput {
  sharedJobId: string;
  websiteId: string;
  propertyId: string;
  orgId: string;
  artifactId: string;
  contentHash: string;
  targetId: string;
  runBrowserQa?: boolean;
}

export function normalizeSiteForgePreviewCredential(
  value: string | undefined,
): string | undefined {
  const normalized = value?.replace(/\\n/g, "").trim();
  return normalized || undefined;
}

export function buildRenderedPreviewCheckpoint(input: {
  artifactId: string;
  contentHash: string;
  previewUrl: string;
  renderedAt: string;
}) {
  return {
    canonical_preview_url: input.previewUrl,
    canonical_preview_artifact_id: input.artifactId,
    canonical_preview_content_hash: input.contentHash,
    canonical_previewed_at: input.renderedAt,
    editor_lifecycle_status: "preview_rendered",
    updated_at: input.renderedAt,
  };
}

export function isCanonicalPreviewInstallationCurrent(
  value: unknown,
  expectedThemeVersion: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const abilities = value as Record<string, unknown>;
  const theme =
    abilities.theme &&
    typeof abilities.theme === "object" &&
    !Array.isArray(abilities.theme)
      ? (abilities.theme as Record<string, unknown>)
      : {};
  const plugins = Array.isArray(abilities.plugins)
    ? abilities.plugins.filter((plugin): plugin is string => typeof plugin === "string")
    : [];
  const blocks = Array.isArray(abilities.available_blocks)
    ? abilities.available_blocks.filter(
        (block): block is string => typeof block === "string",
      )
    : [];
  return (
    theme.name === "oneclick-siteforge" &&
    theme.version === expectedThemeVersion &&
    plugins.includes("advanced-custom-fields-pro") &&
    plugins.includes("oneclick-siteforge-runtime") &&
    ACF_BLOCK_TYPES.every(block => blocks.includes(block))
  );
}

async function hasCurrentCanonicalPreviewInstallation(input: {
  previewUrl: string;
  username: string;
  password: string;
  expectedThemeVersion: string;
}): Promise<boolean> {
  try {
    const response = await fetch(
      `${input.previewUrl.replace(/\/$/, "")}/wp-json/siteforge/v1/abilities`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${input.username}:${input.password}`,
          ).toString("base64")}`,
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return false;
    return isCanonicalPreviewInstallationCurrent(
      await response.json(),
      input.expectedThemeVersion,
    );
  } catch {
    return false;
  }
}

async function assertPreviewNotCancelled(
  input: SiteForgePreviewWorkflowInput,
  client: ReturnType<typeof createServiceClient>,
) {
  const { data: job, error } = await client
    .from("shared_jobs")
    .select("cancel_requested, lifecycle_status")
    .eq("id", input.sharedJobId)
    .single();
  if (
    error ||
    !job ||
    job.cancel_requested ||
    job.lifecycle_status === "cancelled"
  ) {
    throw new FatalError("Canonical preview job was cancelled");
  }
}

export async function renderCanonicalWordPressPreview(
  input: SiteForgePreviewWorkflowInput,
) {
  "use step";

  const previewUrl = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_URL,
  );
  const username = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_USERNAME,
  );
  const password = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD,
  );
  if (!previewUrl || !username || !password) {
    throw new FatalError(
      "Canonical WordPress preview credentials are not configured",
    );
  }

  const supabase = createServiceClient();
  await assertPreviewNotCancelled(input, supabase);
  const { data: job, error: jobError } = await supabase
    .from("shared_jobs")
    .select("cancel_requested, lifecycle_status")
    .eq("id", input.sharedJobId)
    .single();
  if (
    jobError ||
    !job ||
    job.cancel_requested ||
    job.lifecycle_status === "cancelled"
  ) {
    throw new FatalError("Canonical preview job is unavailable or cancelled");
  }

  const now = new Date().toISOString();
  const { data: target, error: targetError } = await supabase
    .from("siteforge_wordpress_targets")
    .select(
      "id, target_type, website_id, property_id, org_id, protection_mode, site_url, admin_url, credential_ref, runtime_contract_version, runtime_version, runtime_package_sha256, runtime_manifest_sha256, last_verified_content_hash, metadata",
    )
    .eq("id", input.targetId)
    .eq("website_id", input.websiteId)
    .eq("target_type", "canonical_preview")
    .eq("is_active", true)
    .single();
  if (
    targetError ||
    !target ||
    !["noindex", "password_noindex"].includes(target.protection_mode)
  ) {
    throw new FatalError(
      "Canonical preview target is invalid or not protected",
    );
  }
  let runtimeV2 =
    target.runtime_contract_version === 2 && Boolean(target.runtime_version);
  await supabase
    .from("shared_jobs")
    .update({
      lifecycle_status: "running",
      stage: "rendering_wordpress_preview",
      progress: 20,
      current_step: "Rendering exact artifact in WordPress staging",
      started_at: now,
      heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", input.sharedJobId);
  const { data: updatedTarget, error: targetCompleteError } = await supabase
    .from("siteforge_wordpress_targets")
    .update({
      status: "provisioning",
      updated_at: now,
    })
    .eq("id", target.id)
    .select("id")
    .maybeSingle();
  if (targetCompleteError || !updatedTarget) {
    throw new Error(
      `Failed to complete canonical preview target: ${
        targetCompleteError?.message || "target row was not updated"
      }`,
    );
  }

  const release = await loadVerifiedSiteForgeRelease(input, supabase);
  const runtimeV3 = release.artifact.runtimeContractVersion === 3;
  const artifact = {
    id: release.artifact.id,
    blueprint: release.artifact.blueprint,
    content_hash: release.artifact.contentHash,
  };
  if (
    !artifact.blueprint ||
    typeof artifact.blueprint !== "object" ||
    Array.isArray(artifact.blueprint)
  ) {
    throw new FatalError("Canonical preview artifact is invalid");
  }
  const blueprint = artifact.blueprint;
  const blueprintThemeArtifact =
    blueprint.wordpressThemeArtifact &&
    typeof blueprint.wordpressThemeArtifact === "object" &&
    !Array.isArray(blueprint.wordpressThemeArtifact)
      ? (blueprint.wordpressThemeArtifact as Record<string, unknown>)
      : {};
  const blueprintTheme =
    blueprintThemeArtifact.theme &&
    typeof blueprintThemeArtifact.theme === "object" &&
    !Array.isArray(blueprintThemeArtifact.theme)
      ? (blueprintThemeArtifact.theme as Record<string, unknown>)
      : {};
  const expectedThemeVersion =
    typeof blueprintTheme.version === "string" ? blueprintTheme.version : "";
  if (!expectedThemeVersion) {
    throw new FatalError(
      "Canonical preview artifact is missing its base theme version",
    );
  }
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : [],
  );
  if (!pages.length) {
    throw new FatalError("Canonical preview artifact contains no pages");
  }
  const themeArtifact =
    runtimeV2 || runtimeV3
      ? null
      : validateWordPressThemeArtifact(blueprint.wordpressThemeArtifact);
  const legal =
    runtimeV2 || runtimeV3
      ? null
      : parseRenderableSiteForgeLegalConfig(blueprint.legal);
  const analytics =
    runtimeV2 || runtimeV3
      ? null
      : siteForgeAnalyticsConfigSchema.parse(blueprint.analytics);

  const fallbackPropertyContext = await getPropertyContext(input.propertyId);
  const propertySnapshot =
    blueprint.propertySnapshot &&
    typeof blueprint.propertySnapshot === "object" &&
    !Array.isArray(blueprint.propertySnapshot)
      ? blueprint.propertySnapshot
      : null;
  const fullPropertyContext = propertySnapshot
    ? propertyContextFromOnboardingSnapshot(propertySnapshot)
    : fallbackPropertyContext;
  const propertySnapshotRecord = propertySnapshot
    ? (propertySnapshot as Record<string, unknown>)
    : {};
  const snapshotProperty =
    propertySnapshotRecord.property &&
    typeof propertySnapshotRecord.property === "object" &&
    !Array.isArray(propertySnapshotRecord.property)
      ? (propertySnapshotRecord.property as Record<string, unknown>)
      : propertySnapshotRecord;
  const propertyContext = {
    ...fullPropertyContext,
    tagline:
      typeof snapshotProperty.tagline === "string"
        ? snapshotProperty.tagline
        : "",
  };

  await assertPreviewNotCancelled(input, supabase);

  let operationHash: string | null = null;
  let remoteTransactionId: string | null = null;
  let runtimeVersion: string | null = target.runtime_version;
  let assetBindingHash = release.artifact.assetManifestHash;
  let instance = {
    url: previewUrl,
    adminUrl: target.admin_url || `${previewUrl.replace(/\/$/, "")}/wp-admin`,
    credentials: { username, password },
  };
  let runtimeSsh: WordPressSshCredentials | null = null;
  const cloudwaysIdentity = parseCloudwaysApplicationHostname(previewUrl);
  if (cloudwaysIdentity) {
    const cloudwaysCredentials = getCloudwaysProviderCredentials();
    const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY?.trim();
    if (!cloudwaysCredentials || !acfProLicenseKey) {
      throw new FatalError(
        "Cloudways and ACF credentials are required to refresh the canonical preview runtime",
      );
    }
    await supabase
      .from("shared_jobs")
      .update({
        stage: "provisioning_runtime",
        progress: 35,
        current_step:
          "Refreshing the canonical preview theme and transactional runtime",
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.sharedJobId);
    const cloudways = new CloudwaysProviderClient(cloudwaysCredentials);
    let application = null;
    try {
      application = await cloudways.getApplication(cloudwaysIdentity);
    } catch {
      try {
        application = await cloudways.getApplication({
          applicationId: cloudwaysIdentity.serverId,
          serverId: cloudwaysIdentity.applicationId,
        });
      } catch (cause) {
        console.warn(
          "Canonical preview is outside the configured Cloudways account; validating its existing runtime",
          cause,
        );
      }
    }
    if (application?.public_ip) {
      // Cloudways app users routinely have SSH password auth disabled, so
      // prefer the same master-user/private-key identity the staging and
      // production deploy paths use. Built from the application lookup we
      // already made; no extra Cloudways API calls (their rate limit is easy
      // to trip during renders).
      const sshPrivateKey =
        process.env.SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY?.replace(/\\n/g, "\n");
      runtimeSsh =
        sshPrivateKey && application.master_user && application.sys_user
          ? {
              host: application.public_ip,
              username: application.master_user,
              privateKey: sshPrivateKey,
              applicationRoot: `/home/master/applications/${application.sys_user}/public_html`,
              sftpApplicationRoot: `/applications/${application.sys_user}/public_html`,
            }
          : application.master_user &&
              application.master_password &&
              application.sys_user
            ? {
                host: application.public_ip,
                username: application.master_user,
                password: application.master_password,
                applicationRoot: `/home/master/applications/${application.sys_user}/public_html`,
                sftpApplicationRoot: `/applications/${application.sys_user}/public_html`,
              }
          : {
              host: application.public_ip,
              username: application.app_user,
              password: application.app_password,
              applicationRoot: "public_html",
            };
      const installationCurrent = await hasCurrentCanonicalPreviewInstallation({
        previewUrl,
        username,
        password,
        expectedThemeVersion,
      });
      if (!runtimeV3 && !installationCurrent) {
        await new SshWordPressInstaller().ensureInstalled({
          ssh: runtimeSsh,
          acfProLicenseKey,
        });
      }
    }
    let health = null;
    if (application?.public_ip && !runtimeV3) {
      try {
        health = await new SiteForgeRuntimeClient({
          baseUrl: previewUrl,
          username,
          applicationPassword: password,
        }).getHealth();
      } catch {
        console.info(
          "Canonical preview is using the installed legacy runtime contract",
        );
      }
    }
    if (health && health.status !== "ok") {
      throw new FatalError(
        `Canonical preview runtime reported ${health.status} after installation`,
      );
    }
    if (
      health &&
      release.artifact.runtimeContractVersion === 2 &&
      release.artifact.runtimePackageSha256
    ) {
      runtimeV2 = true;
      target.runtime_contract_version = 2;
      target.runtime_version = health.runtimeVersion;
      target.runtime_package_sha256 = release.artifact.runtimePackageSha256;
      const runtimeRefreshedAt = new Date().toISOString();
      const { error: runtimeTargetError } = await supabase
        .from("siteforge_wordpress_targets")
        .update({
          runtime_contract_version: 2,
          runtime_version: health.runtimeVersion,
          runtime_package_sha256: release.artifact.runtimePackageSha256,
          last_runtime_health_at: runtimeRefreshedAt,
          updated_at: runtimeRefreshedAt,
        })
        .eq("id", target.id);
      if (runtimeTargetError) {
        throw new Error(
          `Failed to persist canonical preview runtime identity: ${runtimeTargetError.message}`,
        );
      }
    }
  }
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    supabase,
  );
  if (runtimeV3) {
    const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY?.trim();
    if (!runtimeSsh || !acfProLicenseKey) {
      throw new FatalError(
        "Runtime v3 canonical preview requires exact Cloudways SSH and ACF package installation",
      );
    }
    const runtimeResult = await deployArtifactBoundRuntimeV3({
      release,
      target,
      sharedJobId: input.sharedJobId,
      environment: "canonical_preview",
      siteUrl: previewUrl,
      adminUrl: instance.adminUrl,
      username,
      applicationPassword: password,
      ssh: runtimeSsh,
      acfProLicenseKey,
      publicRuntime,
      expectedRemoteContentHash:
        target.runtime_contract_version === 3
          ? target.last_verified_content_hash
          : null,
      protection: {
        mode: target.protection_mode as "noindex" | "password_noindex",
        passwordReference:
          target.protection_mode === "password_noindex"
            ? target.credential_ref || "env:SITEFORGE_PREVIEW_WP_APP_PASSWORD"
            : null,
      },
      client: supabase,
      assertActive: () => assertPreviewNotCancelled(input, supabase),
      onProgress: async (stage, detail) => {
        await supabase
          .from("shared_jobs")
          .update({
            stage,
            progress: stage.includes("assets") ? 45 : 65,
            current_step: detail,
            heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.sharedJobId);
      },
    });
    operationHash = runtimeResult.operationSetHash;
    remoteTransactionId = runtimeResult.deployment.transactionId;
    runtimeVersion = runtimeResult.runtimeVersion;
    assetBindingHash = runtimeResult.assetManifestHash;
  } else if (runtimeV2) {
    if (
      release.artifact.runtimeContractVersion !== 2 ||
      !release.artifact.runtimePackageSha256 ||
      release.artifact.runtimePackageSha256 !== target.runtime_package_sha256
    ) {
      throw new FatalError(
        "Canonical preview artifact is not bound to the installed SiteForge runtime package",
      );
    }
    const deploymentSeed = {
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      artifact_id: artifact.id,
      target_id: target.id,
      shared_job_id: input.sharedJobId,
      artifact_content_hash: artifact.content_hash,
      asset_manifest_hash: release.artifact.assetManifestHash,
      base_theme_package_sha256: release.artifact.baseThemePackageSha256,
      overlay_package_sha256: release.artifact.overlayPackageSha256,
      expected_remote_content_hash: target.last_verified_content_hash,
      runtime_contract_version: 2,
      runtime_version: target.runtime_version,
      runtime_package_sha256: release.artifact.runtimePackageSha256,
      status: "deploying",
    };
    const { error: deploymentSeedError } = await supabase
      .from("siteforge_artifact_deployments")
      .upsert(deploymentSeed, { onConflict: "target_id,artifact_id" });
    if (deploymentSeedError) {
      throw new Error(
        `Failed to persist runtime deployment preflight: ${deploymentSeedError.message}`,
      );
    }
    try {
      const runtimeResult = await deployVerifiedReleaseThroughRuntime({
        release,
        siteUrl: previewUrl,
        username,
        applicationPassword: password,
        lastVerifiedContentHash: target.last_verified_content_hash,
        target: {
          mode: "canonical_preview",
          siteUrl: previewUrl,
        },
        publicRuntime,
        protection: {
          mode: target.protection_mode as "noindex" | "password_noindex",
        },
        onProgress: async (stage, detail) => {
          await supabase
            .from("shared_jobs")
            .update({
              stage,
              progress: stage === "preparing_assets" ? 45 : 65,
              current_step: detail,
              heartbeat_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", input.sharedJobId);
        },
      });
      operationHash = runtimeResult.operationHash;
      remoteTransactionId = runtimeResult.deployment.transactionId;
      runtimeVersion = runtimeResult.runtimeVersion;
      assetBindingHash = runtimeResult.assetBindingHash;
      const runtimeCompletedAt = new Date().toISOString();
      const { error: deploymentCompleteError } = await supabase
        .from("siteforge_artifact_deployments")
        .update({
          status: "ready",
          operation_set_hash: operationHash,
          remote_transaction_id: remoteTransactionId,
          runtime_version: runtimeVersion,
          remote_manifest_hash: artifact.content_hash,
          deployment_idempotency_key: runtimeResult.deploymentIdempotencyKey,
          final_verified_content_hash: artifact.content_hash,
          final_verified_asset_manifest_hash: assetBindingHash,
          deployed_url: previewUrl,
          admin_url: instance.adminUrl,
          deployed_at: runtimeCompletedAt,
          failure_phase: null,
          failure_code: null,
        })
        .eq("target_id", target.id)
        .eq("artifact_id", artifact.id);
      if (deploymentCompleteError) {
        throw new Error(
          `Failed to persist runtime deployment result: ${deploymentCompleteError.message}`,
        );
      }
      const { error: targetRuntimeError } = await supabase
        .from("siteforge_wordpress_targets")
        .update({
          status: "ready",
          runtime_version: runtimeVersion,
          last_verified_artifact_id: artifact.id,
          last_verified_asset_manifest_hash: assetBindingHash,
          last_verified_content_hash: artifact.content_hash,
          last_verified_operation_hash: operationHash,
          last_runtime_health_at: runtimeCompletedAt,
          updated_at: runtimeCompletedAt,
        })
        .eq("id", target.id);
      if (targetRuntimeError) {
        throw new Error(
          `Failed to persist runtime target readback: ${targetRuntimeError.message}`,
        );
      }
    } catch (error) {
      const failure =
        error && typeof error === "object" && "failure" in error
          ? (error.failure as {
              code?: string;
              stage?: string;
            })
          : null;
      await supabase
        .from("siteforge_artifact_deployments")
        .update({
          status: "failed",
          failure_phase: failure?.stage || "runtime",
          failure_code: failure?.code || "runtime_deployment_failed",
        })
        .eq("target_id", target.id)
        .eq("artifact_id", artifact.id);
      throw error;
    }
  } else {
    if (!themeArtifact || !legal || !analytics) {
      throw new FatalError(
        "Legacy WordPress preview configuration is incomplete",
      );
    }
    instance = await deployToExistingWordPress({
      wpUrl: previewUrl,
      credentials: { username, password },
      pages,
      propertyContext,
      assets: release.assets,
      contentHash: input.contentHash,
      siteConfiguration: themeArtifact.siteConfiguration,
      requireContentManifest: true,
      onProgress: async (currentStep) => {
        await supabase
          .from("shared_jobs")
          .update({
            stage: "rendering_wordpress_preview",
            progress: 60,
            current_step: currentStep,
            heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.sharedJobId);
      },
    });
  }
  await assertPreviewNotCancelled(input, supabase);
  if (!runtimeV2 && !runtimeV3) {
    if (!themeArtifact || !legal || !analytics) {
      throw new FatalError("Legacy WordPress preview settings are incomplete");
    }
    await new WordPressAPIClient(
      instance.url,
      instance.credentials,
    ).applySiteForgeSettings({
      themeArtifact,
      legal,
      analytics,
      propertyProfile: runtimePropertyProfile(propertyContext),
      publicRuntime,
      targetMode: "canonical_preview",
    });
  }
  if (!runtimeV2 && !runtimeV3 && release.artifact.themeOverlayId) {
    await captureOverlayRenderCertification(
      {
        overlayId: release.artifact.themeOverlayId,
        websiteId: input.websiteId,
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        artifactBinding: buildReleaseCertificationBinding(release),
        url: instance.url,
        correctionAttempt: 0,
      },
      supabase,
    );
  }
  const renderedAt = new Date().toISOString();
  const { data: renderedWebsite, error: renderedWebsiteError } = await supabase
    .from("property_websites")
    .update(
      buildRenderedPreviewCheckpoint({
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
        previewUrl: instance.url,
        renderedAt,
      }),
    )
    .eq("id", input.websiteId)
    .eq("current_artifact_version_id", artifact.id)
    .select("id")
    .maybeSingle();
  if (renderedWebsiteError || !renderedWebsite) {
    throw new Error(
      "Artifact changed while WordPress was rendering; rendered preview was not linked",
    );
  }
  const brandSnapshot =
    blueprint.brandSnapshot &&
    typeof blueprint.brandSnapshot === "object" &&
    !Array.isArray(blueprint.brandSnapshot)
      ? (blueprint.brandSnapshot as Record<string, unknown>)
      : {};
  const brandContract = brandForgeContractV1Schema.safeParse(
    brandSnapshot.contract,
  );
  await assertPreviewNotCancelled(input, supabase);
  const runCertification = input.runBrowserQa === true;
  let certificationReportHash: string | null = null;
  let certificationStatus: "passed" | "failed" | "not_run" = "not_run";
  if (runCertification) {
    const floorPlanSnapshot = await loadApprovedFloorPlanSnapshot(
      input.propertyId,
      supabase,
    );
    await supabase
      .from("shared_jobs")
      .update({
        stage: "certifying",
        progress: 85,
        current_step: "Certifying the rendered WordPress revision",
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.sharedJobId);
    const certification = await certifyRenderedWordPressArtifact({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      artifactBinding: buildReleaseCertificationBinding(release),
      targetUrl: instance.url,
      credentials: instance.credentials,
      pages,
      environment: "protected_preview",
      access: "protected",
      requireIndexable: false,
      brandContract: brandContract.success ? brandContract.data : undefined,
      ...buildRenderedCertificationTruth(
        propertySnapshot,
        [
          ...release.provenanceUrls,
          ...floorPlanSnapshot.rows.flatMap((row) =>
            row.imageUrl ? [row.imageUrl] : [],
          ),
        ],
        publicRuntime.conversionEndpoint,
        release.runtimeAssets.map((asset) => asset.byteHash),
      ),
    });
    certificationReportHash = hashSiteForgeContent(certification);
    certificationStatus = certification.passed ? "passed" : "failed";
    const certificationReport = certification as unknown as Json;
    const { error: evidenceError } = await supabase
      .from("siteforge_certification_evidence")
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: input.artifactId,
        policy_version: certification.policyVersion,
        environment: "preview",
        status: certificationStatus,
        report: certificationReport,
        evidence_manifest: {
          targetUrl: instance.url,
          bindingHash: certification.bindingHash,
          evidenceHash: certification.evidenceHash,
          browserPolicyVersion: certification.browser.policyVersion,
          browserEvidenceHash: hashSiteForgeContent(certification.browser),
        },
        binding_hash: certification.bindingHash,
        evidence_hash: certification.evidenceHash,
        report_hash: certificationReportHash,
      });
    if (evidenceError) {
      throw new Error(
        `Failed to persist canonical preview certification: ${evidenceError.message}`,
      );
    }
  }
  await supabase
    .from("siteforge_wordpress_targets")
    .update({
      status: "ready",
      site_url: instance.url,
      admin_url: instance.adminUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  const completedAt = new Date().toISOString();
  const output = {
    artifactId: artifact.id,
    contentHash: artifact.content_hash,
    previewUrl: instance.url,
    pages: pages.length,
    runtimeVersion,
    remoteTransactionId,
    operationHash,
    assetBindingHash,
    certificationStatus,
    certificationReportHash,
  };
  const { data: updatedWebsite, error: websiteError } = await supabase
    .from("property_websites")
    .update({
      canonical_preview_url: instance.url,
      canonical_preview_artifact_id: artifact.id,
      canonical_preview_content_hash: artifact.content_hash,
      canonical_previewed_at: completedAt,
      editor_lifecycle_status: "preview_ready",
      updated_at: completedAt,
    })
    .eq("id", input.websiteId)
    .eq("current_artifact_version_id", artifact.id)
    .select("id")
    .maybeSingle();
  if (websiteError || !updatedWebsite) {
    throw new Error(
      "Artifact changed while canonical preview was rendering; approval was not published",
    );
  }
  const { data: completedJob, error: completeError } = await supabase
    .from("shared_jobs")
    .update({
      lifecycle_status: "succeeded",
      status_reason: "canonical_preview_ready",
      stage: "canonical_preview_ready",
      progress: 100,
      current_step: "Canonical WordPress preview ready",
      output: output as unknown as Json,
      error_message: null,
      error_details: null,
      heartbeat_at: completedAt,
      finished_at: completedAt,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: completedAt,
    })
    .eq("id", input.sharedJobId)
    .eq("lease_owner", "siteforge-canonical-preview")
    .select("id")
    .maybeSingle();
  if (completeError || !completedJob) {
    throw new Error(
      `Failed to complete canonical preview job: ${
        completeError?.message || "leased job row was not updated"
      }`,
    );
  }
  return output;
}

renderCanonicalWordPressPreview.maxRetries = 1;

export async function failCanonicalWordPressPreview(
  input: SiteForgePreviewWorkflowInput,
  message: string,
) {
  "use step";
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const certificationFailed = message.startsWith(
    "Canonical preview certification failed:",
  );
  const { data: failedJob, error: failJobError } = await supabase
    .from("shared_jobs")
    .update({
      lifecycle_status: "failed",
      status_reason: certificationFailed
        ? "canonical_preview_certification_failed"
        : "canonical_preview_failed",
      stage: "failed",
      current_step: certificationFailed
        ? "WordPress rendered; certification failed"
        : "Canonical WordPress preview failed",
      error_message: message,
      error_details: { message } as Json,
      heartbeat_at: now,
      finished_at: now,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: now,
    })
    .eq("id", input.sharedJobId)
    .neq("lifecycle_status", "cancelled")
    .select("id")
    .maybeSingle();
  if (failJobError || !failedJob) {
    throw new Error(
      `Failed to terminalize canonical preview job: ${
        failJobError?.message || "job row was not updated"
      }`,
    );
  }
  const { data: failedTarget, error: failTargetError } = await supabase
    .from("siteforge_wordpress_targets")
    .update({
      status: certificationFailed ? "ready" : "failed",
      updated_at: now,
    })
    .eq("id", input.targetId)
    .select("id")
    .maybeSingle();
  if (failTargetError || !failedTarget) {
    throw new Error(
      `Failed to terminalize canonical preview target: ${
        failTargetError?.message || "target row was not updated"
      }`,
    );
  }
}
