import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  isSiteForgeRuntimeExtensionsEnabled,
  isSiteForgeSemanticEditorEnabled,
} from '@/utils/siteforge/editor/feature'
import {
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
      .select('id, version, content_hash, created_at')
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
          .select('dashboard_url')
          .eq('id', website.staging_target_id)
          .maybeSingle()
      : { data: null }
    const runtimeExtensionsEnabled = isSiteForgeRuntimeExtensionsEnabled()
    const [
      { data: certification },
      { data: extensionRequests },
      { data: previewJob },
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
          'id, lifecycle_status, stage, progress, current_step, status_reason, error_message'
        )
        .eq('domain', 'siteforge.preview')
        .eq('subject_id', artifact.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
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

    return NextResponse.json(
      {
        session,
        messages,
        currentArtifact: artifact,
        previews: {
          lifecycleStatus: website.editor_lifecycle_status,
          p11: `/api/siteforge/preview/${website.id}`,
          wordpress: website.canonical_preview_url,
          wordpressArtifactId: website.canonical_preview_artifact_id,
          wordpressContentHash: website.canonical_preview_content_hash,
          certificationStatus: certification?.status || null,
          renderJob: previewJob || null,
          staging: website.staging_url,
          stagingArtifactId: website.staging_artifact_id,
          stagingCertifiedAt: website.staging_certified_at,
          cloudwaysDashboard: stagingTarget?.dashboard_url || null,
        },
        runtimeExtensionsEnabled,
        extensionRequests: reviewedExtensionRequests,
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
