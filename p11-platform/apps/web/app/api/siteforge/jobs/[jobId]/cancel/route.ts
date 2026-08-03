import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRun } from 'workflow/api'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { Json } from '@/types/supabase'
import { restoreLaunchRelease } from '@/utils/siteforge/launch/service'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    if (!z.string().uuid().safeParse(jobId).success) {
      return NextResponse.json({ error: 'Invalid job identifier' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceSupabase = createServiceClient()
    const { data: job, error: jobError } = await serviceSupabase
      .from('shared_jobs')
      .select('id, domain, property_id, subject_id, lifecycle_status, workflow_run_id, payload')
      .eq('id', jobId)
      .in('domain', [
        'siteforge.generation',
        'siteforge.deployment',
        'siteforge.preview',
        'siteforge.semantic_edit',
        'siteforge.production-certification',
      ])
      .single()
    if (jobError || !job?.property_id) {
      return NextResponse.json({ error: 'SiteForge job not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, job.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (['succeeded', 'failed', 'cancelled'].includes(job.lifecycle_status)) {
      return NextResponse.json(
        { error: `Cannot cancel a ${job.lifecycle_status} job` },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const isDeployment = job.domain === 'siteforge.deployment'
    const isProduction = job.domain === 'siteforge.production-certification'
    const isPreview = job.domain === 'siteforge.preview'
    const isSemanticEdit = job.domain === 'siteforge.semantic_edit'
    const operationLabel = isSemanticEdit
      ? 'Semantic edit'
      : isPreview
      ? 'Canonical preview'
      : isDeployment
        ? 'Deployment'
        : isProduction
          ? 'Production certification'
        : 'Generation'
    const payload =
      job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? job.payload
        : {}
    const deploymentWebsiteId =
      (isDeployment || isProduction) && typeof payload.websiteId === 'string'
        ? payload.websiteId
        : null
    const { data: cancelledJob, error: cancelError } = await serviceSupabase
      .from('shared_jobs')
      .update({
        cancel_requested: true,
        lifecycle_status: 'cancelled',
        status_reason: 'cancelled_by_user',
        stage: 'cancelled',
        current_step: `${operationLabel} cancelled`,
        error_message: `${operationLabel} cancelled by user`,
        error_details: {
          category: 'cancellation',
          requestedBy: user.id,
          requestedAt: now,
        } as Json,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', job.id)
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .select('id')
      .maybeSingle()

    if (cancelError || !cancelledJob) {
      return NextResponse.json(
        { error: 'Job changed before cancellation completed' },
        { status: 409 }
      )
    }

    if (job.workflow_run_id) {
      await getRun(job.workflow_run_id).cancel()
    }

    if (isSemanticEdit) {
      await serviceSupabase
        .from('siteforge_edit_messages')
        .update({
          status: 'cancelled',
          content: 'The edit was cancelled. No revision was published.',
          failure_code: 'cancelled_by_user',
          failure_message: 'Semantic edit cancelled by user',
          completed_at: now,
        })
        .eq('shared_job_id', job.id)
    } else if ((isDeployment || isProduction) && deploymentWebsiteId) {
      await Promise.all([
        serviceSupabase
          .from('property_websites')
          .update({
            generation_status: isProduction ? 'ready_for_preview' : 'deploy_failed',
            editor_lifecycle_status: isProduction
              ? 'staging_ready'
              : 'approved_for_staging',
            current_step: `${operationLabel} cancelled`,
            error_message: `${operationLabel} cancelled by user`,
            updated_at: now,
          })
          .eq('id', deploymentWebsiteId),
        serviceSupabase
          .from('siteforge_artifact_deployments')
          .update({
            status: 'failed',
            certification_report: {
              category: 'cancellation',
              requestedBy: user.id,
            } as Json,
          })
          .eq('shared_job_id', job.id),
      ])
      if (
        isProduction &&
        typeof payload.releaseId === 'string'
      ) {
        await restoreLaunchRelease(
          {
            releaseId: payload.releaseId,
            propertyId: job.property_id,
            rationale: 'Automatic safety restore after operator cancelled post-promotion certification',
            actorId: user.id,
            requestId: job.id,
          },
          serviceSupabase
        ).catch(error =>
          console.error('Post-cancellation safety restore failed:', error)
        )
      }
    } else if (job.subject_id && !isPreview) {
      await Promise.all([
        serviceSupabase
          .from('property_websites')
          .update({
            generation_status: isDeployment ? 'deploy_failed' : 'failed',
            current_step: isDeployment ? 'Deployment cancelled' : 'Generation cancelled',
            error_message: `${operationLabel} cancelled by user`,
            updated_at: now,
          })
          .eq('id', job.subject_id),
        serviceSupabase
          .from('siteforge_jobs')
          .update({
            status: 'failed',
            completed_at: now,
            error_details: {
              category: 'cancellation',
              requestedBy: user.id,
            } as Json,
          })
          .eq('shared_job_id', job.id),
      ])
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: 'cancelled',
    })
  } catch (error) {
    console.error('SiteForge job cancellation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel SiteForge job' },
      { status: 500 }
    )
  }
}
