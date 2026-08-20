import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  SITEFORGE_OWNER_OPERATOR_CAPABILITY,
  validatePropertyAccess,
  validateSiteForgeOwnerOperatorAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  isSiteForgeRuntimeExtensionsEnabled,
  isSiteForgeSemanticEditorEnabled,
} from '@/utils/siteforge/editor/feature'
import {
  assertPassingOverlayRenderedEffectEvidence,
  inspectStoredOverlayPackage,
  overlayManifestSchema,
  overlayRuntimeCompatibilitySchema,
  sha256OverlayValue,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  getOrCreateEditorSession,
  listEditorMessages,
} from '@/utils/siteforge/editor/repository'
import { listEditorAttachmentPreviews } from '@/utils/siteforge/editor/attachments'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  registerAuroraOwnedResource,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const createSessionSchema = z.object({
  websiteId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
})

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

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/editor/sessions')
  ctx.logStart()

  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  try {
    const parsed = createSessionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid editor session request' },
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

    const serviceClient = createServiceClient()
    const { data: website, error: websiteError } = await serviceClient
      .from('property_websites')
      .select(
        'id, property_id, org_id, current_artifact_version_id, editor_lifecycle_status, canonical_preview_url, canonical_preview_artifact_id, canonical_preview_content_hash, staging_target_id, staging_url, staging_artifact_id, staging_certified_at'
      )
      .eq('id', parsed.data.websiteId)
      .single()

    if (websiteError || !website?.current_artifact_version_id) {
      return NextResponse.json(
        { error: 'Generated website artifact not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const ownerOperator = await validateSiteForgeOwnerOperatorAccess(
      user.id,
      website.property_id
    )
    const lifecycleIdentity = await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: website.property_id,
        websiteId: website.id,
      },
      serviceClient
    )

    const { data: artifact, error: artifactError } = await serviceClient
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, content_hash, created_at, blueprint, deployment_decision'
      )
      .eq('id', website.current_artifact_version_id)
      .eq('website_id', website.id)
      .single()
    if (artifactError || !artifact) {
      return NextResponse.json(
        { error: 'Current immutable artifact is unavailable' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const session = await getOrCreateEditorSession(
      {
        websiteId: website.id,
        propertyId: website.property_id,
        orgId: website.org_id,
        artifactId: artifact.id,
        userId: user.id,
        title: parsed.data.title,
      },
      serviceClient
    )
    await registerAuroraOwnedResource(
      lifecycleIdentity,
      { kind: 'editor_session', id: session.id },
      serviceClient
    )
    const messages = await listEditorMessages(session.id, serviceClient)
    const { data: stagingTarget } = website.staging_target_id
      ? await serviceClient
          .from('siteforge_wordpress_targets')
          .select('dashboard_url, admin_url')
          .eq('id', website.staging_target_id)
          .maybeSingle()
      : { data: null }
    const runtimeExtensionsEnabled = isSiteForgeRuntimeExtensionsEnabled()
    const [
      certificationResult,
      extensionRequestsResult,
      previewJobResult,
      activeSemanticEditJobResult,
      activePreviewJobResult,
      revisionsResult,
      attachments,
      liveBrandResult,
    ] = await Promise.all([
      serviceClient
        .from('siteforge_certification_evidence')
        .select('status, created_at')
        .eq('website_id', website.id)
        .eq('artifact_id', artifact.id)
        .eq('environment', 'preview')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      runtimeExtensionsEnabled
        ? serviceClient
            .from('siteforge_runtime_extension_requests')
            .select(
              'id, artifact_id, capability, reason, requested_behavior, status, immutable_package_sha256, runtime_compatibility, created_at'
            )
            .eq('website_id', website.id)
            .in('status', ['proposed', 'approved', 'building'])
            .order('created_at', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
      serviceClient
        .from('shared_jobs')
        .select(
          'id, lifecycle_status, stage, progress, current_step, status_reason, error_message, heartbeat_at, attempt_count, max_attempts, queued_at, started_at, finished_at, updated_at'
        )
        .eq('domain', 'siteforge.preview')
        .eq('subject_id', artifact.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      serviceClient
        .from('shared_jobs')
        .select(
          'id, lifecycle_status, stage, progress, current_step, status_reason, error_message, heartbeat_at, attempt_count, max_attempts, queued_at, started_at, finished_at, updated_at'
        )
        .eq('domain', 'siteforge.semantic_edit')
        .eq('subject_id', website.id)
        .in('lifecycle_status', ['queued', 'running', 'retrying'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      serviceClient
        .from('shared_jobs')
        .select(
          'id, lifecycle_status, stage, progress, current_step, status_reason, error_message, heartbeat_at, attempt_count, max_attempts, queued_at, started_at, finished_at, updated_at'
        )
        .eq('domain', 'siteforge.preview')
        .contains('payload', { websiteId: website.id })
        .in('lifecycle_status', ['queued', 'running', 'retrying'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      serviceClient
        .from('siteforge_blueprint_versions')
        .select(
          'id, version, content_hash, parent_version_id, change_type, changes_summary, edit_intent, created_at'
        )
        .eq('website_id', website.id)
        .eq('property_id', website.property_id)
        .eq('org_id', website.org_id)
        .order('version', { ascending: false })
        .limit(20),
      listEditorAttachmentPreviews(session.id, serviceClient),
      serviceClient
        .from('property_brand_assets')
        .select('id, contract_hash, contract_version')
        .eq('property_id', website.property_id)
        .maybeSingle(),
    ])
    if (
      activeSemanticEditJobResult.error ||
      activePreviewJobResult.error ||
      revisionsResult.error
    ) {
      throw new Error(
        `Failed to recover editor state: ${
          activeSemanticEditJobResult.error?.message ||
          activePreviewJobResult.error?.message ||
          revisionsResult.error?.message
        }`
      )
    }
    const certification = certificationResult.data
    const extensionRequests = extensionRequestsResult.data
    const previewJob = previewJobResult.data
    const activeSemanticEditJob = activeSemanticEditJobResult.data
    const activePreviewJob = activePreviewJobResult.data
    const revisions = revisionsResult.data
    const reviewedExtensionRequests = runtimeExtensionsEnabled
      ? await Promise.all(
          (extensionRequests || []).map(async extension => ({
            ...extension,
            review: await loadExtensionReview(
              extension,
              website,
              serviceClient
            ),
          }))
        )
      : []

    // Brand staleness signal: runs stay pinned to the brand contract they were
    // generated with (immutability), but the operator gets an explicit notice
    // when the live brand book has moved past the pinned contract instead of
    // silently seeing old colors.
    const blueprintRecord =
      artifact.blueprint &&
      typeof artifact.blueprint === 'object' &&
      !Array.isArray(artifact.blueprint)
        ? (artifact.blueprint as Record<string, unknown>)
        : {}
    const pinnedBrandSnapshot =
      blueprintRecord.brandSnapshot &&
      typeof blueprintRecord.brandSnapshot === 'object' &&
      !Array.isArray(blueprintRecord.brandSnapshot)
        ? (blueprintRecord.brandSnapshot as Record<string, unknown>)
        : null
    const pinnedBrandContractHash =
      typeof pinnedBrandSnapshot?.contractHash === 'string'
        ? pinnedBrandSnapshot.contractHash
        : null
    const liveBrand = liveBrandResult.data
    const brand = {
      pinnedContractHash: pinnedBrandContractHash,
      pinnedContractVersion:
        typeof pinnedBrandSnapshot?.contractVersion === 'string' ||
        typeof pinnedBrandSnapshot?.contractVersion === 'number'
          ? String(pinnedBrandSnapshot.contractVersion)
          : null,
      liveContractHash: liveBrand?.contract_hash || null,
      liveContractVersion: liveBrand?.contract_version ?? null,
      staleSincePinned: Boolean(
        pinnedBrandContractHash &&
          liveBrand?.contract_hash &&
          liveBrand.contract_hash !== pinnedBrandContractHash
      ),
    }

    return NextResponse.json(
      {
        session,
        messages,
        currentArtifact: {
          id: artifact.id,
          version: artifact.version,
          content_hash: artifact.content_hash,
          created_at: artifact.created_at,
          deployment_decision: artifact.deployment_decision,
        },
        previewBlueprint: artifact.blueprint,
        revisions: revisions || [],
        attachments,
        editorModel: 'adaptive model routing',
        activeJobs: {
          semanticEdit: activeSemanticEditJob || null,
          preview: activePreviewJob || null,
        },
        previews: {
          lifecycleStatus: website.editor_lifecycle_status,
          p11: `/api/siteforge/preview/${website.id}`,
          wordpress: website.canonical_preview_url,
          wordpressArtifactId: website.canonical_preview_artifact_id,
          wordpressContentHash: website.canonical_preview_content_hash,
          certificationStatus: certification?.status || null,
          renderJob: previewJob || null,
          staging: website.staging_url,
          stagingAdmin: stagingTarget?.admin_url || null,
          stagingArtifactId: website.staging_artifact_id,
          stagingCertifiedAt: website.staging_certified_at,
          cloudwaysDashboard: stagingTarget?.dashboard_url || null,
        },
        runtimeExtensionsEnabled,
        extensionRequests: reviewedExtensionRequests,
        brand,
        capabilities: {
          [SITEFORGE_OWNER_OPERATOR_CAPABILITY]: ownerOperator.authorized,
        },
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
            ? 'Failed to open editor'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
