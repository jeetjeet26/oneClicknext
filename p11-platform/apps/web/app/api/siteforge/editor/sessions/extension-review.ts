import type { createServiceClient } from '@/utils/supabase/admin'
import {
  assertPassingOverlayRenderedEffectEvidence,
  inspectStoredOverlayPackage,
  overlayManifestSchema,
  overlayRuntimeCompatibilitySchema,
  sha256OverlayValue,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function loadExtensionReview(
  extension: {
    id: string
    artifact_id: string
    immutable_package_sha256: string | null
    runtime_compatibility: string | null
  },
  website: {
    id: string
    property_id: string
    org_id: string
    current_artifact_version_id: string | null
  },
  serviceClient: ServiceClient
) {
  const unavailable = (error: string) => ({
    sourceArtifact: null,
    packageSha256: extension.immutable_package_sha256,
    manifest: null,
    validationReport: null,
    screenshotReport: null,
    files: [],
    sourceIsCurrent: false,
    renderedEffectComplete: false,
    reviewComplete: false,
    reviewError: error,
  })
  try {
    if (
      !extension.immutable_package_sha256 ||
      !extension.runtime_compatibility
    ) {
      return unavailable('Immutable extension package identity is incomplete')
    }
    const compatibility = overlayRuntimeCompatibilitySchema.parse(
      JSON.parse(extension.runtime_compatibility)
    )
    if (
      compatibility.sourceArtifactId !== extension.artifact_id ||
      compatibility.packageSha256 !== extension.immutable_package_sha256
    ) {
      return unavailable('Extension request package identity does not match')
    }
    const [{ data: sourceArtifact }, { data: overlay }] = await Promise.all([
      serviceClient
        .from('siteforge_blueprint_versions')
        .select('id, version, content_hash, created_at')
        .eq('id', extension.artifact_id)
        .eq('website_id', website.id)
        .eq('property_id', website.property_id)
        .eq('org_id', website.org_id)
        .single(),
      serviceClient
        .from('siteforge_theme_overlays')
        .select(
          'id, content_hash, manifest, storage_path, package_sha256, signature, validation_report, screenshot_manifest'
        )
        .eq('id', compatibility.overlayId)
        .eq('website_id', website.id)
        .eq('property_id', website.property_id)
        .eq('org_id', website.org_id)
        .single(),
    ])
    if (
      !sourceArtifact ||
      !overlay ||
      sourceArtifact.content_hash !== compatibility.sourceContentHash ||
      overlay.content_hash !== compatibility.contentHash ||
      overlay.storage_path !== compatibility.storage.path ||
      overlay.package_sha256 !== compatibility.packageSha256 ||
      overlay.signature !== compatibility.signature ||
      hashSiteForgeContent(overlay.validation_report) !==
        compatibility.validation.reportSha256
    ) {
      return unavailable('Stored extension review identity does not match')
    }
    const signingSecret = process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
    if (
      !signingSecret ||
      !verifyOverlaySignature({
        websiteId: website.id,
        contentHash: overlay.content_hash,
        packageSha256: overlay.package_sha256,
        signature: overlay.signature,
        signingSecret,
      })
    ) {
      return unavailable('Stored extension package signature is invalid')
    }
    const manifest = overlayManifestSchema.parse(overlay.manifest)
    const { data: packageBlob, error: packageError } =
      await serviceClient.storage
        .from(compatibility.storage.bucket)
        .download(overlay.storage_path)
    if (packageError || !packageBlob) {
      return unavailable('Private extension package is unavailable')
    }
    const reviewedPackage = inspectStoredOverlayPackage(
      new Uint8Array(await packageBlob.arrayBuffer()),
      {
        contentHash: overlay.content_hash,
        manifest,
        packageSha256: overlay.package_sha256,
      }
    )
    const validation =
      overlay.validation_report &&
      typeof overlay.validation_report === 'object' &&
      !Array.isArray(overlay.validation_report)
        ? (overlay.validation_report as Record<string, unknown>)
        : null
    const sourceIsCurrent =
      website.current_artifact_version_id === sourceArtifact.id
    let renderedEffectComplete = false
    if (compatibility.renderedEffectContract) {
      try {
        assertPassingOverlayRenderedEffectEvidence({
          contract: compatibility.renderedEffectContract,
          evidence: overlay.screenshot_manifest,
          parentArtifactId: extension.artifact_id,
          parentContentHash: compatibility.sourceContentHash,
        })
        renderedEffectComplete = true
      } catch {
        renderedEffectComplete = false
      }
    }
    // Rendered-effect evidence is only captured after the overlay is
    // installed by the canonical render, so it cannot gate machine approval
    // (that would deadlock every extension in `proposed`). It is reported
    // here informationally; the rendered outcome is proven post-publication
    // by overlay render certification with undo available.
    const reviewComplete =
      sourceIsCurrent &&
      validation?.passed === true &&
      validation.validator === compatibility.validation.validator
    return {
      sourceArtifact,
      packageSha256: reviewedPackage.packageSha256,
      manifest,
      validationReport: overlay.validation_report,
      screenshotReport: overlay.screenshot_manifest,
      files: reviewedPackage.files.map(file => ({
        path: file.path,
        content: file.content,
        contentHash: file.contentHash,
        bytes: file.bytes,
        mediaType: file.mediaType,
        contentDigestVerified:
          sha256OverlayValue(file.content) === file.contentHash,
      })),
      sourceIsCurrent,
      renderedEffectComplete,
      reviewComplete,
      reviewError: reviewComplete
        ? null
        : 'Source revision or sandbox validation is incomplete',
    }
  } catch (error) {
    return unavailable(
      error instanceof Error
        ? error.message
        : 'Extension review package could not be verified'
    )
  }
}
