import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { siteForgeCanonicalPreviewWorkflow } from '@/workflows/siteforge-canonical-preview'
import type { Json } from '@/types/supabase'
import {
  assertActiveAuroraLifecycleLease,
  auroraOwnedMetadata,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import { canonicalPreviewDedupeKey } from '@/utils/siteforge/workflows/canonical-preview-queue'

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  retry: z.boolean().optional().default(false),
  runBrowserQa: z.boolean().optional().default(false),
})

const statusQuerySchema = z.object({
  jobId: z.string().uuid(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/canonical-preview/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    const parsed = statusQuerySchema.safeParse({
      jobId: request.nextUrl.searchParams.get('jobId'),
    })
    if (!z.string().uuid().safeParse(websiteId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid canonical preview status request' },
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
    const { data: website, error: websiteError } = await service
      .from('property_websites')
      .select('id, property_id')
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
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
    const { data: job, error: jobError } = await service
      .from('shared_jobs')
      .select(
        'id, lifecycle_status, status_reason, stage, progress, current_step, output, error_message, error_details, attempt_count, max_attempts, queued_at, started_at, heartbeat_at, created_at, updated_at, finished_at'
      )
      .eq('id', parsed.data.jobId)
      .eq('domain', 'siteforge.preview')
      .contains('payload', { websiteId })
      .single()
    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Canonical preview job not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    ctx.logSuccess(200, { jobId: job.id, status: job.lifecycle_status })
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.lifecycle_status,
        statusReason: job.status_reason,
        stage: job.stage,
        progress: job.progress,
        currentStep: job.current_step,
        output: job.output,
        error: job.error_message,
        errorDetails: job.error_details,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        queuedAt: job.queued_at,
        startedAt: job.started_at,
        heartbeatAt: job.heartbeat_at,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        finishedAt: job.finished_at,
        elapsedMs: Math.max(
          0,
          Date.parse(job.finished_at || new Date().toISOString()) -
            Date.parse(job.started_at || job.queued_at)
        ),
      },
      {
        headers: {
          ...ctx.responseHeaders,
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load canonical preview status' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/canonical-preview/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
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
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid canonical preview request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: website, error: websiteError } = await service
      .from('property_websites')
      .select(
        'id, org_id, property_id, current_artifact_version_id, canonical_preview_artifact_id, canonical_preview_content_hash, canonical_preview_url, editor_lifecycle_status'
      )
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
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
      service
    )
    if (website.current_artifact_version_id !== parsed.data.artifactId) {
      return NextResponse.json(
        { error: 'Only the current immutable artifact can be previewed' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: artifact, error: artifactError } = await service
      .from('siteforge_blueprint_versions')
      .select('id, content_hash, quality_report')
      .eq('id', parsed.data.artifactId)
      .eq('website_id', websiteId)
      .eq('property_id', website.property_id)
      .single()
    if (
      artifactError ||
      !artifact ||
      artifact.content_hash !== parsed.data.contentHash
    ) {
      return NextResponse.json(
        { error: 'Artifact content hash no longer matches' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (
      website.canonical_preview_artifact_id === artifact.id &&
      website.canonical_preview_content_hash === artifact.content_hash &&
      website.canonical_preview_url &&
      website.editor_lifecycle_status === 'preview_ready' &&
      !parsed.data.retry &&
      !parsed.data.runBrowserQa
    ) {
      return NextResponse.json(
        {
          status: 'ready',
          artifactId: artifact.id,
          contentHash: artifact.content_hash,
          previewUrl: website.canonical_preview_url,
        },
        { headers: ctx.responseHeaders }
      )
    }
    if (
      !process.env.SITEFORGE_PREVIEW_WP_URL?.trim() ||
      !process.env.SITEFORGE_PREVIEW_WP_USERNAME ||
      !process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD
    ) {
      return NextResponse.json(
        { error: 'Canonical WordPress preview is not configured' },
        { status: 503, headers: ctx.responseHeaders }
      )
    }
    const previewWordPressUrl = process.env.SITEFORGE_PREVIEW_WP_URL.replace(
      /\\n/g,
      ''
    )
      .trim()
      .replace(/\/+$/, '')
    const { data: existingTarget, error: targetLookupError } = await service
      .from('siteforge_wordpress_targets')
      .select('id, metadata')
      .eq('website_id', website.id)
      .eq('target_type', 'canonical_preview')
      .eq('is_active', true)
      .maybeSingle()
    if (targetLookupError) {
      throw new Error(
        `Failed to load canonical preview target: ${targetLookupError.message}`
      )
    }
    let targetId = existingTarget?.id
    const existingMetadata =
      existingTarget?.metadata &&
      typeof existingTarget.metadata === 'object' &&
      !Array.isArray(existingTarget.metadata)
        ? existingTarget.metadata
        : {}
    if (
      lifecycleIdentity &&
      existingMetadata.lifecycleOwnerId &&
      existingMetadata.lifecycleOwnerId !== lifecycleIdentity.ownerId
    ) {
      throw new AuroraLifecycleControlError(
        'Canonical preview target belongs to another lifecycle owner',
        409,
        'target_owner_conflict'
      )
    }
    if (targetId) {
      const { error: targetUpdateError } = await service
        .from('siteforge_wordpress_targets')
        .update({
          site_url: previewWordPressUrl,
          admin_url: `${previewWordPressUrl}/wp-admin`,
          status: 'ready',
          protection_mode: 'noindex',
          ...(lifecycleIdentity
            ? {
                metadata: auroraOwnedMetadata(
                  lifecycleIdentity,
                  existingTarget?.metadata
                ),
              }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetId)
      if (targetUpdateError) throw new Error(targetUpdateError.message)
    } else {
      const { data: createdTarget, error: targetCreateError } = await service
        .from('siteforge_wordpress_targets')
        .insert({
          org_id: website.org_id,
          property_id: website.property_id,
          website_id: website.id,
          target_type: 'canonical_preview',
          provider: 'existing_wordpress',
          site_url: previewWordPressUrl,
          admin_url: `${previewWordPressUrl}/wp-admin`,
          credential_ref: 'env:SITEFORGE_PREVIEW_WP_APP_PASSWORD',
          protection_mode: 'noindex',
          status: 'ready',
          is_active: true,
          ...(lifecycleIdentity
            ? { metadata: auroraOwnedMetadata(lifecycleIdentity) }
            : {}),
        })
        .select('id')
        .single()
      if (targetCreateError || !createdTarget) {
        throw new Error(
          `Failed to create canonical preview target: ${
            targetCreateError?.message || 'missing row'
          }`
        )
      }
      targetId = createdTarget.id
    }
    if (!targetId) {
      throw new Error('Canonical preview target identity was not created')
    }
    await service
      .from('property_websites')
      .update({ canonical_preview_target_id: targetId })
      .eq('id', website.id)

    const { data: conflictingPreview } = await service
      .from('shared_jobs')
      .select('id')
      .eq('domain', 'siteforge.preview')
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .contains('payload', { websiteId })
      .neq('subject_id', artifact.id)
      .limit(1)
      .maybeSingle()
    if (conflictingPreview) {
      return NextResponse.json(
        {
          error:
            'Another revision is currently using the shared preview target',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const dedupeKey = canonicalPreviewDedupeKey(
      artifact.id,
      artifact.content_hash
    )
    const { data: existing } = await service
      .from('shared_jobs')
      .select(
        'id, lifecycle_status, workflow_run_id, attempt_count, error_message'
      )
      .eq('org_id', website.org_id)
      .eq('domain', 'siteforge.preview')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (
      existing &&
      ['queued', 'running', 'retrying'].includes(existing.lifecycle_status)
    ) {
      return NextResponse.json(
        {
          status: existing.lifecycle_status,
          jobId: existing.id,
          workflowRunId: existing.workflow_run_id,
          artifactId: artifact.id,
          contentHash: artifact.content_hash,
          statusUrl: `/api/siteforge/canonical-preview/${websiteId}?jobId=${existing.id}`,
        },
        { status: 202, headers: ctx.responseHeaders }
      )
    }
    if (existing?.lifecycle_status === 'failed' && !parsed.data.retry) {
      return NextResponse.json(
        {
          status: 'failed',
          jobId: existing.id,
          error:
            existing.error_message ||
            'Canonical WordPress preview failed. Select Render Canonical Preview to retry.',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const payload = {
      websiteId,
      propertyId: website.property_id,
      orgId: website.org_id,
      artifactId: artifact.id,
      contentHash: artifact.content_hash,
      targetId,
      runBrowserQa: parsed.data.runBrowserQa,
      ...(lifecycleIdentity
        ? {
            lifecycleOwnerId: lifecycleIdentity.ownerId,
            lifecycleRunId: lifecycleIdentity.ownerId,
            lifecycleExpiresAt: lifecycleIdentity.expiresAt,
          }
        : {}),
    }
    const queuedJob = {
      lifecycle_status: 'queued',
      status_reason: existing
        ? 'canonical_preview_requeued'
        : 'canonical_preview_queued',
      stage: 'queued',
      progress: 0,
      current_step: 'Canonical WordPress preview queued',
      payload: payload as unknown as Json,
      workflow_run_id: null,
      error_message: null,
      error_details: null,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      lease_owner: null,
      lease_expires_at: null,
      cancel_requested: false,
      attempt_count: (existing?.attempt_count || 0) + 1,
      updated_at: new Date().toISOString(),
    }
    const jobQuery = existing
      ? service.from('shared_jobs').update(queuedJob).eq('id', existing.id)
      : service.from('shared_jobs').insert({
          ...queuedJob,
          org_id: website.org_id,
          property_id: website.property_id,
          domain: 'siteforge.preview',
          subject_type: 'siteforge_artifact',
          subject_id: artifact.id,
          dedupe_key: dedupeKey,
          max_attempts: 2,
        })
    const { data: job, error: jobError } = await jobQuery.select('id').single()
    if (jobError || !job) {
      throw new Error(
        `Failed to queue canonical preview job: ${jobError?.message}`
      )
    }
    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await service
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        status_reason: 'canonical_preview_claimed',
        current_step: 'Shared canonical preview target leased',
        lease_owner: 'siteforge-canonical-preview',
        lease_expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
        heartbeat_at: claimedAt,
        started_at: claimedAt,
        updated_at: claimedAt,
      })
      .eq('id', job.id)
      .eq('lifecycle_status', 'queued')
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      const { error: releaseError } = await service
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'canonical_preview_target_busy',
          stage: 'failed',
          current_step: 'Shared canonical preview target is busy',
          error_message:
            'The shared canonical preview target is currently leased',
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      if (releaseError) {
        throw new Error(
          `Preview target claim and terminalization failed: ${releaseError.message}`
        )
      }
      return NextResponse.json(
        { error: 'The shared canonical preview target is currently leased' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    let run: Awaited<ReturnType<typeof start>>
    try {
      run = await start(siteForgeCanonicalPreviewWorkflow, [
        { sharedJobId: job.id, ...payload },
      ])
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start preview workflow'
      const { data: terminalized, error: terminalError } = await service
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'canonical_preview_start_failed',
          stage: 'failed',
          current_step: 'Canonical preview workflow failed to start',
          error_message: message,
          finished_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('lease_owner', 'siteforge-canonical-preview')
        .select('id')
        .maybeSingle()
      if (terminalError || !terminalized) {
        throw new Error(
          'Canonical preview launch failed without terminal state'
        )
      }
      throw error
    }
    const { data: linked, error: linkError } = await service
      .from('shared_jobs')
      .update({
        workflow_run_id: run.runId,
        workflow_name: 'siteForgeCanonicalPreviewWorkflow',
      })
      .eq('id', job.id)
      .eq('lease_owner', 'siteforge-canonical-preview')
      .select('id')
      .maybeSingle()
    if (linkError || !linked) {
      await run.cancel()
      await service
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'canonical_preview_link_failed',
          stage: 'failed',
          current_step: 'Canonical preview workflow linkage failed',
          error_message:
            linkError?.message || 'Canonical preview lease was lost',
          finished_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      throw new Error(
        `Failed to link canonical preview workflow: ${
          linkError?.message || 'preview lease was lost'
        }`
      )
    }
    ctx.logSuccess(202, { jobId: job.id, artifactId: artifact.id })
    return NextResponse.json(
      {
        status: 'queued',
        jobId: job.id,
        workflowRunId: run.runId,
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
        statusUrl: `/api/siteforge/canonical-preview/${websiteId}?jobId=${job.id}`,
      },
      { status: 202, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof AuroraLifecycleControlError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to start canonical WordPress preview'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
