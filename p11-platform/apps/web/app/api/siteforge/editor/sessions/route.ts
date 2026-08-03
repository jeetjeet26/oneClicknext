import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'
import {
  getOrCreateEditorSession,
  listEditorMessages,
} from '@/utils/siteforge/editor/repository'

const createSessionSchema = z.object({
  websiteId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
})

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
    const messages = await listEditorMessages(session.id, serviceClient)
    const { data: stagingTarget } = website.staging_target_id
      ? await serviceClient
          .from('siteforge_wordpress_targets')
          .select('dashboard_url')
          .eq('id', website.staging_target_id)
          .maybeSingle()
      : { data: null }
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
      serviceClient
        .from('siteforge_runtime_extension_requests')
        .select(
          'id, capability, reason, requested_behavior, status, created_at'
        )
        .eq('website_id', website.id)
        .in('status', ['proposed', 'approved', 'building'])
        .order('created_at', { ascending: false })
        .limit(5),
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
        extensionRequests: extensionRequests || [],
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to open editor',
      },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
