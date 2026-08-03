import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const undoSchema = z.object({
  expectedArtifactId: z.string().uuid(),
  targetArtifactId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/editor/sessions/[sessionId]/undo'
  )
  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  try {
    const { sessionId } = await params
    const parsed = undoSchema.safeParse(await request.json())
    if (!z.string().uuid().safeParse(sessionId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid undo request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }

    const client = createServiceClient()
    const { data: session, error: sessionError } = await client
      .from('siteforge_edit_sessions')
      .select('id, org_id, property_id, website_id, active_artifact_id, status')
      .eq('id', sessionId)
      .single()
    if (sessionError || !session || session.status !== 'active') {
      return NextResponse.json(
        { error: 'Active editor session not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, session.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    if (
      session.active_artifact_id !== parsed.data.expectedArtifactId
    ) {
      return NextResponse.json(
        { error: 'Artifact changed; reload before undoing' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: current, error: currentError } = await client
      .from('siteforge_blueprint_versions')
      .select('id, parent_version_id')
      .eq('id', parsed.data.expectedArtifactId)
      .eq('website_id', session.website_id)
      .single()
    const targetId = parsed.data.targetArtifactId || current?.parent_version_id
    if (currentError || !current || !targetId || targetId === current.id) {
      return NextResponse.json(
        { error: 'No prior artifact is available to restore' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: target, error: targetError } = await client
      .from('siteforge_blueprint_versions')
      .select('id, version, blueprint, content_hash, quality_report, quality_score')
      .eq('id', targetId)
      .eq('website_id', session.website_id)
      .single()
    if (targetError || !target) {
      return NextResponse.json(
        { error: 'Rollback artifact not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const now = new Date().toISOString()
    const { data: job, error: jobError } = await client
      .from('shared_jobs')
      .insert({
        org_id: session.org_id,
        property_id: session.property_id,
        domain: 'siteforge.semantic_edit',
        subject_type: 'property_website',
        subject_id: session.website_id,
        lifecycle_status: 'running',
        status_reason: 'publishing_rollback',
        dedupe_key: `${session.id}:undo:${parsed.data.idempotencyKey}`,
        payload: {
          expectedArtifactId: current.id,
          targetArtifactId: target.id,
        } as Json,
        stage: 'publishing',
        progress: 75,
        current_step: 'Publishing immutable rollback revision',
        attempt_count: 1,
        started_at: now,
        updated_at: now,
      })
      .select('id')
      .single()
    if (jobError || !job) {
      if (jobError?.code === '23505') {
        return NextResponse.json(
          { error: 'This undo request was already processed' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      throw new Error('Failed to create rollback job')
    }

    const rollbackOperation = {
      operation: 'rollback',
      targetArtifactId: target.id,
      targetVersion: target.version,
    }
    const { data: revision, error: revisionError } = await client.rpc(
      'publish_siteforge_artifact_revision',
      {
        p_website_id: session.website_id,
        p_expected_artifact_id: current.id,
        p_blueprint: target.blueprint,
        p_content_hash: target.content_hash,
        p_change_type: 'rollback',
        p_changes_summary: `Restored artifact version ${target.version}`,
        p_edit_intent: `Undo to artifact ${target.id}`,
        p_patches_applied: rollbackOperation as Json,
        p_quality_report: target.quality_report || {},
        p_quality_score: target.quality_score ?? 0,
        p_created_by: user.id,
        p_operation_set: [rollbackOperation] as unknown as Json,
        p_operation_set_hash: hashSiteForgeContent([rollbackOperation]),
      }
    )
    if (revisionError || !revision) {
      await client
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'rollback_failed',
          stage: 'failed',
          error_message: revisionError?.message || 'Rollback publication failed',
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return NextResponse.json(
        {
          error: revisionError?.message.includes('version conflict')
            ? 'Artifact changed; reload before undoing'
            : 'Failed to publish rollback revision',
        },
        { status: revisionError?.message.includes('version conflict') ? 409 : 500 }
      )
    }

    await Promise.all([
      client
        .from('siteforge_edit_sessions')
        .update({
          active_artifact_id: revision.id,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', session.id),
      client
        .from('shared_jobs')
        .update({
          lifecycle_status: 'succeeded',
          status_reason: 'rollback_published',
          stage: 'published',
          progress: 100,
          current_step: 'Rollback revision published',
          output: {
            artifactId: revision.id,
            contentHash: revision.content_hash,
            version: revision.version,
          } as Json,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id),
    ])

    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        artifactId: revision.id,
        contentHash: revision.content_hash,
        version: revision.version,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to undo edit' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
