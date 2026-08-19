import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { isSiteForgeRuntimeExtensionsEnabled } from '@/utils/siteforge/editor/feature'
import {
  assertPassingOverlayRenderedEffectEvidence,
  inspectStoredOverlayPackage,
  overlayManifestSchema,
  overlayRuntimeCompatibilitySchema,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'
import { replaceWordPressThemeArtifactOverlay } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  registerAuroraOwnedResource,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import {
  queueCanonicalPreviewAfterPublication,
  type CanonicalPreviewQueueResult,
} from '@/utils/siteforge/workflows/canonical-preview-queue'

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(2_000),
})

type ServiceClient = ReturnType<typeof createServiceClient>
type ExtensionRequest = {
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

type PublishedArtifact = {
  id: string
  version: number
  content_hash: string
  parent_version_id: string | null
  theme_overlay_id: string | null
  overlay_package_sha256: string | null
  blueprint: Json
}

function publishedIdentity(
  artifact: PublishedArtifact,
  sourceArtifactId: string
) {
  return {
    id: artifact.id,
    version: artifact.version,
    contentHash: artifact.content_hash,
    parentArtifactId: sourceArtifactId,
    themeOverlayId: artifact.theme_overlay_id,
    packageSha256: artifact.overlay_package_sha256,
  }
}

function overlayThemeSlug(contentHash: string): string {
  return `oneclick-siteforge-overlay-${contentHash.slice(0, 12)}`
}

function artifactHasExactOverlay(
  artifact: PublishedArtifact,
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
  extension: ExtensionRequest
  overlayId: string
  packageSha256: string
  contentHash: string
  signature: string
  userId: string
  decisionReason: string
  service: ServiceClient
}): Promise<PublishedArtifact | null> {
  const { data: website } = await input.service
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
  const { data: current } = await input.service
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
  const { data: approved, error: approvalError } = await input.service
    .from('siteforge_runtime_extension_requests')
    .update({
      status: 'approved',
      decision_by: input.userId,
      decision_reason: input.decisionReason,
      decided_at: decidedAt,
      updated_at: decidedAt,
    })
    .eq('id', input.extension.id)
    .eq('status', 'building')
    .select('id')
    .maybeSingle()
  if (approvalError) {
    throw new Error(
      `Published extension could not be reconciled: ${approvalError.message}`
    )
  }
  if (!approved) {
    const { data: alreadyApproved } = await input.service
      .from('siteforge_runtime_extension_requests')
      .select('id')
      .eq('id', input.extension.id)
      .eq('status', 'approved')
      .maybeSingle()
    if (!alreadyApproved) {
      throw new Error('Published extension approval state changed')
    }
  }
  await input.service
    .from('siteforge_edit_sessions')
    .update({
      active_artifact_id: current.id,
      last_activity_at: decidedAt,
    })
    .eq('website_id', input.extension.website_id)
    .eq('active_artifact_id', input.extension.artifact_id)
  return current
}

async function queuePublishedPreview(input: {
  extension: ExtensionRequest
  artifact: PublishedArtifact
  service: ServiceClient
}): Promise<CanonicalPreviewQueueResult> {
  try {
    return await queueCanonicalPreviewAfterPublication({
      service: input.service,
      orgId: input.extension.org_id,
      propertyId: input.extension.property_id,
      websiteId: input.extension.website_id,
      artifactId: input.artifact.id,
      contentHash: input.artifact.content_hash,
    })
  } catch (error) {
    return {
      status: 'pending',
      jobId: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/extensions/[requestId]/decision'
  )
  ctx.logStart()
  if (!isSiteForgeRuntimeExtensionsEnabled()) {
    return NextResponse.json(
      { error: 'Runtime extensions are not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  try {
    const { requestId } = await params
    const parsed = decisionSchema.safeParse(await request.json())
    if (!z.string().uuid().safeParse(requestId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid runtime extension decision' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: extension } = await service
      .from('siteforge_runtime_extension_requests')
      .select(
        'id, org_id, property_id, website_id, artifact_id, capability, reason, requested_behavior, status, immutable_package_sha256, runtime_compatibility, decision_by, created_at'
      )
      .eq('id', requestId)
      .single()
    if (!extension) {
      return NextResponse.json(
        { error: 'Runtime extension request not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const ownerOperator = await validateSiteForgeOwnerOperatorAccess(
      user.id,
      extension.property_id
    )
    if (
      !ownerOperator.authorized ||
      ownerOperator.orgId !== extension.org_id
    ) {
      return NextResponse.json(
        {
          error: 'SiteForge owner/operator capability required',
          capability: ownerOperator.capability,
        },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const lifecycleIdentity = await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: extension.property_id,
        websiteId: extension.website_id,
      },
      service
    )
    if (parsed.data.decision === 'rejected') {
      if (extension.status !== 'proposed') {
        return NextResponse.json(
          { error: 'Runtime extension request has already been decided' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      const decidedAt = new Date().toISOString()
      const { data: rejected, error: rejectionError } = await service
        .from('siteforge_runtime_extension_requests')
        .update({
          status: 'rejected',
          decision_by: user.id,
          decision_reason: parsed.data.reason,
          decided_at: decidedAt,
          updated_at: decidedAt,
        })
        .eq('id', extension.id)
        .eq('status', 'proposed')
        .select('id, status')
        .maybeSingle()
      if (rejectionError || !rejected) {
        return NextResponse.json(
          { error: 'Runtime extension request changed concurrently' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      ctx.logSuccess(200, { requestId, decision: rejected.status })
      return NextResponse.json(
        { requestId, status: rejected.status },
        { headers: ctx.responseHeaders }
      )
    }
    if (!['proposed', 'building'].includes(extension.status)) {
      return NextResponse.json(
        { error: 'Runtime extension request has already been decided' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (
      !extension.immutable_package_sha256 ||
      !extension.runtime_compatibility
    ) {
      return NextResponse.json(
        {
          error:
            '[extension_identity_incomplete] Runtime extension package identity is incomplete',
        },
        { status: 409, headers: ctx.responseHeaders }
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
      return NextResponse.json(
        {
          error:
            '[extension_identity_invalid] Runtime extension identity does not match its source request',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const identity = compatibility.data
    if (!identity.renderedEffectContract) {
      return NextResponse.json(
        {
          error:
            '[extension_rendered_effect_contract_missing] Runtime extension has no immutable rendered-effect contract',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: renderedEffectOverlay, error: renderedEffectError } =
      await service
        .from('siteforge_theme_overlays')
        .select('screenshot_manifest')
        .eq('id', identity.overlayId)
        .eq('website_id', extension.website_id)
        .eq('property_id', extension.property_id)
        .eq('org_id', extension.org_id)
        .single()
    if (renderedEffectError || !renderedEffectOverlay) {
      return NextResponse.json(
        {
          error:
            '[extension_rendered_effect_unavailable] Runtime extension rendered evidence is unavailable',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    try {
      assertPassingOverlayRenderedEffectEvidence({
        contract: identity.renderedEffectContract,
        evidence: renderedEffectOverlay.screenshot_manifest,
        parentArtifactId: extension.artifact_id,
        parentContentHash: identity.sourceContentHash,
      })
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : '[extension_rendered_effect_unproven] Runtime extension rendered evidence failed',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (extension.status === 'building') {
      const reconciled = await reconcilePublishedExtension({
        extension,
        overlayId: identity.overlayId,
        packageSha256: identity.packageSha256,
        contentHash: identity.contentHash,
        signature: identity.signature,
        userId: user.id,
        decisionReason: parsed.data.reason,
        service,
      })
      if (reconciled) {
        await registerAuroraOwnedResource(
          lifecycleIdentity,
          { kind: 'artifact', id: reconciled.id },
          service
        )
        const previewQueue = await queuePublishedPreview({
          extension,
          artifact: reconciled,
          service,
        })
        return NextResponse.json(
          {
            requestId,
            status: 'approved',
            artifact: publishedIdentity(reconciled, extension.artifact_id),
            reconciled: true,
            previewQueue,
          },
          { headers: ctx.responseHeaders }
        )
      }
    }

    const [{ data: website }, { data: source }, { data: overlay }] =
      await Promise.all([
        service
          .from('property_websites')
          .select('current_artifact_version_id')
          .eq('id', extension.website_id)
          .eq('property_id', extension.property_id)
          .eq('org_id', extension.org_id)
          .single(),
        service
          .from('siteforge_blueprint_versions')
          .select(
            'id, website_id, property_id, org_id, blueprint, content_hash, quality_report, quality_score, asset_manifest, asset_manifest_hash, base_theme_package_id, base_theme_package_sha256, runtime_contract_version, runtime_package_sha256'
          )
          .eq('id', extension.artifact_id)
          .eq('website_id', extension.website_id)
          .eq('property_id', extension.property_id)
          .eq('org_id', extension.org_id)
          .single(),
        service
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
      return NextResponse.json(
        {
          error:
            '[extension_source_stale] The exact source artifact is no longer current',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (
      !source.asset_manifest_hash ||
      !source.base_theme_package_id ||
      !source.base_theme_package_sha256 ||
      (source.runtime_contract_version >= 2 &&
        !source.runtime_package_sha256)
    ) {
      return NextResponse.json(
        {
          error:
            '[extension_source_identity_incomplete] Source release package identities are incomplete',
        },
        { status: 409, headers: ctx.responseHeaders }
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
      return NextResponse.json(
        {
          error:
            '[extension_overlay_mismatch] Stored overlay identity does not match the request',
        },
        { status: 409, headers: ctx.responseHeaders }
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
      return NextResponse.json(
        {
          error:
            '[extension_validation_incomplete] Overlay signature or sandbox validation is incomplete',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const parsedManifest = overlayManifestSchema.safeParse(overlay.manifest)
    if (!parsedManifest.success) {
      return NextResponse.json(
        {
          error:
            '[extension_manifest_invalid] Overlay manifest is incomplete or unsafe',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const manifest = parsedManifest.data
    const { data: packageBlob, error: packageError } = await service.storage
      .from(identity.storage.bucket)
      .download(overlay.storage_path)
    if (packageError || !packageBlob) {
      return NextResponse.json(
        { error: '[extension_package_unavailable] Overlay package is unavailable' },
        { status: 409, headers: ctx.responseHeaders }
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
      return NextResponse.json(
        {
          error:
            '[extension_package_invalid] Overlay package contents do not match the immutable review identity',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const blueprint = structuredClone(source.blueprint) as Record<
      string,
      unknown
    >
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
      return NextResponse.json(
        {
          error:
            '[extension_source_theme_invalid] Source artifact cannot accept an immutable theme overlay',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    blueprint.updatedAt = extension.created_at
    const contentHash = hashSiteForgeContent(blueprint)
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
      const { data: claimed, error: claimError } = await service
        .from('siteforge_runtime_extension_requests')
        .update({
          status: 'building',
          decision_by: user.id,
          decision_reason: parsed.data.reason,
          updated_at: claimedAt,
        })
        .eq('id', extension.id)
        .eq('status', 'proposed')
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) {
        return NextResponse.json(
          { error: 'Runtime extension request changed concurrently' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
    }
    const { error: publicationError } = await service.rpc(
      'publish_siteforge_artifact_revision',
      {
        p_website_id: extension.website_id,
        p_expected_artifact_id: source.id,
        p_blueprint: blueprint as Json,
        p_content_hash: contentHash,
        p_change_type: 'edit',
        p_changes_summary: `Approved runtime extension: ${extension.capability}`.slice(
          0,
          2_000
        ),
        p_edit_intent: extension.requested_behavior,
        p_patches_applied: operation as unknown as Json,
        p_quality_report: source.quality_report || {},
        p_quality_score: source.quality_score ?? 0,
        p_created_by: user.id,
        ...(source.base_theme_package_id
          ? { p_base_theme_package_id: source.base_theme_package_id }
          : {}),
        ...(source.base_theme_package_sha256
          ? {
              p_base_theme_package_sha256:
                source.base_theme_package_sha256,
            }
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
      userId: user.id,
      decisionReason: parsed.data.reason,
      service,
    })
    if (!published) {
      const message = publicationError
        ? ` Publication response: ${publicationError.message}`
        : ''
      return NextResponse.json(
        {
          error: `[extension_publication_unconfirmed] Publication could not be proven by immutable readback.${message}`,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    await registerAuroraOwnedResource(
      lifecycleIdentity,
      { kind: 'artifact', id: published.id },
      service
    )
    const previewQueue = await queuePublishedPreview({
      extension,
      artifact: published,
      service,
    })
    ctx.logSuccess(200, {
      requestId,
      decision: 'approved',
      artifactId: published.id,
    })
    return NextResponse.json(
      {
        requestId,
        status: 'approved',
        artifact: publishedIdentity(published, extension.artifact_id),
        previewQueue,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof AuroraLifecycleControlError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to decide runtime extension request'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
