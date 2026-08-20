import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  inspectStoredOverlayPackage,
  overlayManifestSchema,
  overlayRuntimeCompatibilitySchema,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'
import { replaceWordPressThemeArtifactOverlay } from '@/utils/siteforge/wordpress/theme-artifact'

type ServiceClient = SupabaseClient<Database>

export type ExtensionRequestRow = {
  id: string
  org_id: string
  property_id: string
  website_id: string
  artifact_id: string
  capability: string
  reason: string
  requested_behavior: string
  status: string
  immutable_package_sha256: string | null
  runtime_compatibility: string | null
  decision_by: string | null
  created_at: string
}

export type PublishedExtensionArtifact = {
  id: string
  version: number
  content_hash: string
  parent_version_id: string | null
  theme_overlay_id: string | null
  overlay_package_sha256: string | null
  blueprint: Json
}

/**
 * Machine-policy failure while applying a validated runtime extension. The
 * bracketed code prefix in `message` is stable and user-diagnosable.
 */
export class ExtensionApprovalError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message)
    this.name = 'ExtensionApprovalError'
  }
}

export function overlayThemeSlug(contentHash: string): string {
  return `oneclick-siteforge-overlay-${contentHash.slice(0, 12)}`
}

function artifactHasExactOverlay(
  artifact: PublishedExtensionArtifact,
  sourceArtifactId: string,
  overlayId: string,
  packageSha256: string,
  contentHash: string,
  signature: string
): boolean {
  const blueprint =
    artifact.blueprint &&
    typeof artifact.blueprint === 'object' &&
    !Array.isArray(artifact.blueprint)
      ? (artifact.blueprint as Record<string, unknown>)
      : {}
  const overlayIdentity =
    blueprint.themeOverlayIdentity &&
    typeof blueprint.themeOverlayIdentity === 'object' &&
    !Array.isArray(blueprint.themeOverlayIdentity)
      ? (blueprint.themeOverlayIdentity as Record<string, unknown>)
      : {}
  return (
    artifact.parent_version_id === sourceArtifactId &&
    artifact.theme_overlay_id === overlayId &&
    artifact.overlay_package_sha256 === packageSha256 &&
    overlayIdentity.overlayId === overlayId &&
    overlayIdentity.packageSha256 === packageSha256 &&
    overlayIdentity.contentHash === contentHash &&
    overlayIdentity.themeSlug === overlayThemeSlug(contentHash) &&
    overlayIdentity.signature === signature
  )
}

async function reconcilePublishedExtension(input: {
  extension: ExtensionRequestRow
  overlayId: string
  packageSha256: string
  contentHash: string
  signature: string
  decisionBy: string
  decisionReason: string
  client: ServiceClient
}): Promise<PublishedExtensionArtifact | null> {
  const { data: website } = await input.client
    .from('property_websites')
    .select('current_artifact_version_id')
    .eq('id', input.extension.website_id)
    .eq('property_id', input.extension.property_id)
    .eq('org_id', input.extension.org_id)
    .single()
  if (
    !website?.current_artifact_version_id ||
    website.current_artifact_version_id === input.extension.artifact_id
  ) {
    return null
  }
  const { data: current } = await input.client
    .from('siteforge_blueprint_versions')
    .select(
      'id, version, content_hash, parent_version_id, theme_overlay_id, overlay_package_sha256, blueprint'
    )
    .eq('id', website.current_artifact_version_id)
    .eq('website_id', input.extension.website_id)
    .single()
  if (
    !current ||
    !artifactHasExactOverlay(
      current,
      input.extension.artifact_id,
      input.overlayId,
      input.packageSha256,
      input.contentHash,
      input.signature
    )
  ) {
    return null
  }
  const decidedAt = new Date().toISOString()
  const { data: approved, error: approvalError } = await input.client
    .from('siteforge_runtime_extension_requests')
    .update({
      status: 'approved',
      decision_by: input.decisionBy,
      decision_reason: input.decisionReason,
      decided_at: decidedAt,
      updated_at: decidedAt,
    })
    .eq('id', input.extension.id)
    .eq('status', 'building')
    .select('id')
    .maybeSingle()
  if (approvalError) {
    throw new ExtensionApprovalError(
      `Published extension could not be reconciled: ${approvalError.message}`,
      500
    )
  }
  if (!approved) {
    const { data: alreadyApproved } = await input.client
      .from('siteforge_runtime_extension_requests')
      .select('id')
      .eq('id', input.extension.id)
      .eq('status', 'approved')
      .maybeSingle()
    if (!alreadyApproved) {
      throw new ExtensionApprovalError(
        'Published extension approval state changed',
        500
      )
    }
  }
  await input.client
    .from('siteforge_edit_sessions')
    .update({
      active_artifact_id: current.id,
      last_activity_at: decidedAt,
    })
    .eq('website_id', input.extension.website_id)
    .eq('active_artifact_id', input.extension.artifact_id)
  return current
}

/**
 * Apply the deterministic machine policy for a validated runtime extension:
 * verify every immutable identity (source currency, overlay signature,
 * sandbox validation, package digest), publish exactly one new artifact
 * revision carrying the overlay, and mark the request approved — proven by
 * immutable readback. Solo-operator doctrine: this runs automatically; there
 * is no human approval ceremony. Rendered-effect proof happens
 * post-publication via overlay render certification with undo available.
 */
export async function approveAndPublishRuntimeExtension(input: {
  extension: ExtensionRequestRow
  decisionBy: string
  decisionReason: string
  client: ServiceClient
}): Promise<{ artifact: PublishedExtensionArtifact; reconciled: boolean }> {
  const { extension, decisionBy, decisionReason, client } = input
  if (!['proposed', 'building'].includes(extension.status)) {
    throw new ExtensionApprovalError(
      'Runtime extension request has already been decided'
    )
  }
  if (!extension.immutable_package_sha256 || !extension.runtime_compatibility) {
    throw new ExtensionApprovalError(
      '[extension_identity_incomplete] Runtime extension package identity is incomplete'
    )
  }
  let rawCompatibility: unknown
  try {
    rawCompatibility = JSON.parse(extension.runtime_compatibility)
  } catch {
    rawCompatibility = null
  }
  const compatibility =
    overlayRuntimeCompatibilitySchema.safeParse(rawCompatibility)
  if (
    !compatibility.success ||
    compatibility.data.sourceArtifactId !== extension.artifact_id ||
    compatibility.data.packageSha256 !== extension.immutable_package_sha256
  ) {
    throw new ExtensionApprovalError(
      '[extension_identity_invalid] Runtime extension identity does not match its source request'
    )
  }
  const identity = compatibility.data
  // The rendered-effect contract must exist at approval time, but its
  // evidence can only be captured after the overlay is installed by the
  // canonical render, so it is never a pre-approval gate.
  if (!identity.renderedEffectContract) {
    throw new ExtensionApprovalError(
      '[extension_rendered_effect_contract_missing] Runtime extension has no immutable rendered-effect contract'
    )
  }
  if (extension.status === 'building') {
    const reconciled = await reconcilePublishedExtension({
      extension,
      overlayId: identity.overlayId,
      packageSha256: identity.packageSha256,
      contentHash: identity.contentHash,
      signature: identity.signature,
      decisionBy,
      decisionReason,
      client,
    })
    if (reconciled) return { artifact: reconciled, reconciled: true }
  }

  const [{ data: website }, { data: source }, { data: overlay }] =
    await Promise.all([
      client
        .from('property_websites')
        .select('current_artifact_version_id')
        .eq('id', extension.website_id)
        .eq('property_id', extension.property_id)
        .eq('org_id', extension.org_id)
        .single(),
      client
        .from('siteforge_blueprint_versions')
        .select(
          'id, website_id, property_id, org_id, blueprint, content_hash, quality_report, quality_score, asset_manifest, asset_manifest_hash, base_theme_package_id, base_theme_package_sha256, runtime_contract_version, runtime_package_sha256'
        )
        .eq('id', extension.artifact_id)
        .eq('website_id', extension.website_id)
        .eq('property_id', extension.property_id)
        .eq('org_id', extension.org_id)
        .single(),
      client
        .from('siteforge_theme_overlays')
        .select(
          'id, content_hash, manifest, storage_path, package_sha256, signature, validation_report'
        )
        .eq('id', identity.overlayId)
        .eq('website_id', extension.website_id)
        .eq('property_id', extension.property_id)
        .eq('org_id', extension.org_id)
        .single(),
    ])
  if (
    !website ||
    !source ||
    website.current_artifact_version_id !== source.id ||
    source.content_hash !== identity.sourceContentHash
  ) {
    throw new ExtensionApprovalError(
      '[extension_source_stale] The exact source artifact is no longer current'
    )
  }
  if (
    !source.asset_manifest_hash ||
    !source.base_theme_package_id ||
    !source.base_theme_package_sha256 ||
    (source.runtime_contract_version >= 2 && !source.runtime_package_sha256)
  ) {
    throw new ExtensionApprovalError(
      '[extension_source_identity_incomplete] Source release package identities are incomplete'
    )
  }
  if (
    !overlay ||
    overlay.id !== identity.overlayId ||
    overlay.content_hash !== identity.contentHash ||
    overlay.storage_path !== identity.storage.path ||
    overlay.package_sha256 !== identity.packageSha256 ||
    overlay.signature !== identity.signature ||
    hashSiteForgeContent(overlay.validation_report) !==
      identity.validation.reportSha256
  ) {
    throw new ExtensionApprovalError(
      '[extension_overlay_mismatch] Stored overlay identity does not match the request'
    )
  }
  const validation =
    overlay.validation_report &&
    typeof overlay.validation_report === 'object' &&
    !Array.isArray(overlay.validation_report)
      ? (overlay.validation_report as Record<string, unknown>)
      : null
  const signingSecret = process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
  if (
    validation?.passed !== true ||
    validation.validator !== identity.validation.validator ||
    !signingSecret ||
    !verifyOverlaySignature({
      websiteId: extension.website_id,
      contentHash: overlay.content_hash,
      packageSha256: overlay.package_sha256,
      signature: overlay.signature,
      signingSecret,
    })
  ) {
    throw new ExtensionApprovalError(
      '[extension_validation_incomplete] Overlay signature or sandbox validation is incomplete'
    )
  }
  const parsedManifest = overlayManifestSchema.safeParse(overlay.manifest)
  if (!parsedManifest.success) {
    throw new ExtensionApprovalError(
      '[extension_manifest_invalid] Overlay manifest is incomplete or unsafe'
    )
  }
  const manifest = parsedManifest.data
  const { data: packageBlob, error: packageError } = await client.storage
    .from(identity.storage.bucket)
    .download(overlay.storage_path)
  if (packageError || !packageBlob) {
    throw new ExtensionApprovalError(
      '[extension_package_unavailable] Overlay package is unavailable'
    )
  }
  try {
    inspectStoredOverlayPackage(
      new Uint8Array(await packageBlob.arrayBuffer()),
      {
        contentHash: overlay.content_hash,
        manifest,
        packageSha256: overlay.package_sha256,
      }
    )
  } catch {
    throw new ExtensionApprovalError(
      '[extension_package_invalid] Overlay package contents do not match the immutable review identity'
    )
  }

  const blueprint = structuredClone(source.blueprint) as Record<string, unknown>
  blueprint.themeOverlayIdentity = {
    contractVersion: 1,
    overlayId: overlay.id,
    contentHash: overlay.content_hash,
    themeSlug: overlayThemeSlug(overlay.content_hash),
    packageSha256: overlay.package_sha256,
    signature: overlay.signature,
    storagePath: overlay.storage_path,
  }
  try {
    blueprint.wordpressThemeArtifact = replaceWordPressThemeArtifactOverlay(
      blueprint.wordpressThemeArtifact,
      manifest
    )
  } catch {
    throw new ExtensionApprovalError(
      '[extension_source_theme_invalid] Source artifact cannot accept an immutable theme overlay'
    )
  }
  blueprint.updatedAt = extension.created_at
  const contentHash = hashSiteForgeContent(blueprint)
  // The source's quality report may carry a semantic-edit acceptance
  // contract naming the source's own parent/content hash. Copying it onto
  // the extension revision breaks the release lineage check, so strip it.
  const qualityReport =
    source.quality_report &&
    typeof source.quality_report === 'object' &&
    !Array.isArray(source.quality_report)
      ? (structuredClone(source.quality_report) as Record<string, unknown>)
      : {}
  const semanticEditor = qualityReport.semanticEditor
  if (
    semanticEditor &&
    typeof semanticEditor === 'object' &&
    !Array.isArray(semanticEditor)
  ) {
    delete (semanticEditor as Record<string, unknown>).acceptanceContract
  }
  const operation = {
    operation: 'runtime_extension_approval',
    requestId: extension.id,
    sourceArtifactId: source.id,
    overlayId: overlay.id,
    packageSha256: overlay.package_sha256,
    contentHash: overlay.content_hash,
    signature: overlay.signature,
  }
  if (extension.status === 'proposed') {
    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await client
      .from('siteforge_runtime_extension_requests')
      .update({
        status: 'building',
        decision_by: decisionBy,
        decision_reason: decisionReason,
        updated_at: claimedAt,
      })
      .eq('id', extension.id)
      .eq('status', 'proposed')
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      throw new ExtensionApprovalError(
        'Runtime extension request changed concurrently'
      )
    }
  }
  const { error: publicationError } = await client.rpc(
    'publish_siteforge_artifact_revision',
    {
      p_website_id: extension.website_id,
      p_expected_artifact_id: source.id,
      p_blueprint: blueprint as Json,
      p_content_hash: contentHash,
      p_change_type: 'edit',
      p_changes_summary:
        `Approved runtime extension: ${extension.capability}`.slice(0, 2_000),
      p_edit_intent: extension.requested_behavior,
      p_patches_applied: operation as unknown as Json,
      p_quality_report: qualityReport as Json,
      p_quality_score: source.quality_score ?? 0,
      p_created_by: decisionBy,
      ...(source.base_theme_package_id
        ? { p_base_theme_package_id: source.base_theme_package_id }
        : {}),
      ...(source.base_theme_package_sha256
        ? { p_base_theme_package_sha256: source.base_theme_package_sha256 }
        : {}),
      p_asset_manifest: source.asset_manifest,
      ...(source.asset_manifest_hash
        ? { p_asset_manifest_hash: source.asset_manifest_hash }
        : {}),
      p_runtime_contract_version: source.runtime_contract_version,
      ...(source.runtime_package_sha256
        ? { p_runtime_package_sha256: source.runtime_package_sha256 }
        : {}),
      p_operation_set: [operation] as unknown as Json,
      p_operation_set_hash: hashSiteForgeContent([operation]),
    }
  )
  const published = await reconcilePublishedExtension({
    extension: { ...extension, status: 'building' },
    overlayId: overlay.id,
    packageSha256: overlay.package_sha256,
    contentHash: overlay.content_hash,
    signature: overlay.signature,
    decisionBy,
    decisionReason,
    client,
  })
  if (!published) {
    const message = publicationError
      ? ` Publication response: ${publicationError.message}`
      : ''
    throw new ExtensionApprovalError(
      `[extension_publication_unconfirmed] Publication could not be proven by immutable readback.${message}`
    )
  }
  return { artifact: published, reconciled: false }
}
