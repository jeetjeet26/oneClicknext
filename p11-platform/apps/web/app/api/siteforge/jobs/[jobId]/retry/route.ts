import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  loadApprovedSiteForgeGenerationContext,
  SiteForgePlanError,
} from '@/utils/siteforge/plans/repository'
import { siteForgeGenerationWorkflow } from '@/workflows/siteforge-generation'
import { siteForgeStagingDeploymentWorkflow } from '@/workflows/siteforge-staging-deployment'
import { siteForgeCanonicalPreviewWorkflow } from '@/workflows/siteforge-canonical-preview'
import { siteForgeProductionCertificationWorkflow } from '@/workflows/siteforge-production-certification'

const sharedPayloadSchema = z.object({
  planVersionId: z.guid(),
  websiteId: z.guid(),
  legacyJobId: z.guid(),
})

const deploymentPayloadSchema = z.object({
  websiteId: z.guid(),
  propertyId: z.guid(),
  orgId: z.guid(),
  targetId: z.guid(),
  deploymentId: z.guid(),
  artifactId: z.guid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvalId: z.guid(),
  localSimulation: z.boolean().default(false),
  startedAt: z.string().datetime(),
})

const previewPayloadSchema = z.object({
  websiteId: z.guid(),
  propertyId: z.guid(),
  orgId: z.guid(),
  artifactId: z.guid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetId: z.guid(),
})

const productionPayloadSchema = z.object({
  releaseId: z.guid(),
  actorId: z.guid(),
  websiteId: z.guid(),
  propertyId: z.guid(),
  orgId: z.guid(),
  targetId: z.guid(),
  deploymentId: z.guid(),
  artifactId: z.guid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  productionUrl: z.string().url(),
  startedAt: z.string().datetime(),
})

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    if (!z.guid().safeParse(jobId).success) {
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
      .select(
        'id, domain, org_id, property_id, lifecycle_status, cancel_requested, attempt_count, max_attempts, payload, error_details'
      )
      .eq('id', jobId)
      .in('domain', [
        'siteforge.generation',
        'siteforge.deployment',
        'siteforge.preview',
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
    if (job.lifecycle_status !== 'failed' || job.cancel_requested) {
      return NextResponse.json(
        { error: 'Only failed, non-cancelled jobs can be retried' },
        { status: 409 }
      )
    }
    if (job.attempt_count >= job.max_attempts) {
      return NextResponse.json(
        { error: 'SiteForge job has exhausted its retry limit' },
        { status: 409 }
      )
    }
    const errorDetails =
      job.error_details &&
      typeof job.error_details === 'object' &&
      !Array.isArray(job.error_details)
        ? (job.error_details as Record<string, unknown>)
        : {}
    if (errorDetails.retryable !== true) {
      return NextResponse.json(
        {
          error:
            'This failure is not retryable. Review the approved inputs and prepare a new build when the issue is resolved.',
        },
        { status: 409 }
      )
    }

    const generationPayload = sharedPayloadSchema.safeParse(job.payload)
    const deploymentPayload = deploymentPayloadSchema.safeParse(job.payload)
    const previewPayload = previewPayloadSchema.safeParse(job.payload)
    const productionPayload = productionPayloadSchema.safeParse(job.payload)
    if (
      (job.domain === 'siteforge.generation' && !generationPayload.success) ||
      (job.domain === 'siteforge.deployment' && !deploymentPayload.success) ||
      (job.domain === 'siteforge.preview' && !previewPayload.success)
      || (job.domain === 'siteforge.production-certification' && !productionPayload.success)
    ) {
      return NextResponse.json(
        { error: 'SiteForge job is missing resumable workflow context' },
        { status: 409 }
      )
    }

    let generationContext: Awaited<
      ReturnType<typeof loadApprovedSiteForgeGenerationContext>
    > | null = null
    if (job.domain === 'siteforge.generation' && generationPayload.success) {
      const { data: planVersion, error: planError } = await serviceSupabase
        .from('siteforge_plan_versions')
        .select('id, plan_id, revision, content_hash')
        .eq('id', generationPayload.data.planVersionId)
        .single()
      if (planError || !planVersion) {
        return NextResponse.json({ error: 'Confirmed plan revision not found' }, { status: 404 })
      }
      try {
        generationContext = await loadApprovedSiteForgeGenerationContext(
          {
            websiteId: generationPayload.data.websiteId,
            planId: planVersion.plan_id,
            confirmedRevision: planVersion.revision,
            contentHash: planVersion.content_hash,
          },
          serviceSupabase
        )
      } catch (error) {
        if (error instanceof SiteForgePlanError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode })
        }
        throw error
      }
      if (
        generationContext.planVersionId !== generationPayload.data.planVersionId ||
        generationContext.propertyId !== job.property_id ||
        generationContext.orgId !== job.org_id
      ) {
        return NextResponse.json(
          { error: 'Generation retry context does not match the failed job' },
          { status: 409 }
        )
      }
    }
    if (
      job.domain !== 'siteforge.preview' &&
      job.domain !== 'siteforge.deployment' &&
      job.domain !== 'siteforge.production-certification' &&
      !generationContext
    ) {
      return NextResponse.json(
        { error: 'SiteForge job is missing resumable workflow context' },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const leaseOwner =
      job.domain === 'siteforge.preview'
        ? 'siteforge-canonical-preview'
        : `siteforge-retry:${job.id}:${job.attempt_count + 1}`
    const leaseExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
    const { data: claimed, error: claimError } = await serviceSupabase
      .from('shared_jobs')
      .update({
        workflow_run_id: null,
        lifecycle_status: 'retrying',
        status_reason: 'manual_retry_claimed',
        stage: 'queued',
        progress: 0,
        current_step: 'Retry claimed; starting durable workflow',
        attempt_count: job.attempt_count + 1,
        retry_at: now,
        finished_at: null,
        error_message: null,
        error_details: null,
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt,
        heartbeat_at: now,
        updated_at: now,
      })
      .eq('id', job.id)
      .eq('lifecycle_status', 'failed')
      .eq('attempt_count', job.attempt_count)
      .eq('cancel_requested', false)
      .select('id')
      .maybeSingle()

    if (claimError || !claimed) {
      const previewBusy =
        job.domain === 'siteforge.preview' && claimError?.code === '23505'
      return NextResponse.json(
        {
          error: previewBusy
            ? 'The shared canonical preview target is currently leased'
            : 'SiteForge retry was already claimed or changed',
        },
        { status: 409 }
      )
    }

    let run: Awaited<ReturnType<typeof start>>
    try {
      if (job.domain === 'siteforge.preview' && previewPayload.success) {
        run = await start(siteForgeCanonicalPreviewWorkflow, [
          { sharedJobId: job.id, ...previewPayload.data },
        ])
      } else if (job.domain === 'siteforge.deployment' && deploymentPayload.success) {
        run = await start(siteForgeStagingDeploymentWorkflow, [
          {
            sharedJobId: job.id,
            ...deploymentPayload.data,
            startedAt: now,
          },
        ])
      } else if (
        job.domain === 'siteforge.production-certification' &&
        productionPayload.success
      ) {
        run = await start(siteForgeProductionCertificationWorkflow, [
          {
            sharedJobId: job.id,
            ...productionPayload.data,
            startedAt: now,
          },
        ])
      } else if (generationPayload.success && generationContext) {
        run = await start(siteForgeGenerationWorkflow, [
          {
            sharedJobId: job.id,
            legacyJobId: generationPayload.data.legacyJobId,
            websiteId: generationPayload.data.websiteId,
            propertyId: generationContext.propertyId,
            orgId: generationContext.orgId,
            planVersionId: generationContext.planVersionId,
            preferences: { ...generationContext.plan.preferences },
            prompt: [
              generationContext.plan.summary,
              ...generationContext.plan.recommendations,
              `Approved brief:\n${JSON.stringify(generationContext.brief)}`,
              `Approved creative direction:\n${JSON.stringify(
                generationContext.creativeDirection
              )}`,
            ].join('\n\n'),
            approvedBrief: generationContext.brief,
            approvedCreativeDirection: generationContext.creativeDirection,
            evidenceSnapshot: generationContext.evidenceSnapshot,
            startedAt: now,
          },
        ])
      } else {
        throw new Error('SiteForge retry payload became invalid')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start SiteForge retry'
      const { data: terminalized, error: terminalError } = await serviceSupabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'retry_start_failed',
          stage: 'failed',
          current_step: 'Retry workflow failed to start',
          error_message: message,
          error_details: {
            code: 'retry_start_failed',
            retryable: true,
            failedCheckpoint: 'retry_start',
            safeMessage:
              'The retry could not start because the workflow provider is temporarily unavailable.',
            diagnostics: { message },
          },
          finished_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('lease_owner', leaseOwner)
        .select('id')
        .maybeSingle()
      if (terminalError || !terminalized) {
        throw new Error(
          `Retry launch failed and terminal state could not be persisted: ${
            terminalError?.message || 'job claim was lost'
          }`
        )
      }
      throw error
    }

    const { data: linked, error: updateError } = await serviceSupabase
      .from('shared_jobs')
      .update({
        workflow_run_id: run.runId,
        status_reason: 'manual_retry_queued',
        current_step: 'Retry workflow queued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('lease_owner', leaseOwner)
      .eq('lifecycle_status', 'retrying')
      .select('id')
      .maybeSingle()

    if (updateError || !linked) {
      await run.cancel()
      throw new Error(
        `Failed to link SiteForge retry: ${updateError?.message || 'job claim was lost'}`
      )
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      workflowRunId: run.runId,
      status: 'retrying',
      attemptCount: job.attempt_count + 1,
      maxAttempts: job.max_attempts,
    })
  } catch (error) {
    console.error('SiteForge job retry error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry SiteForge job' },
      { status: 500 }
    )
  }
}
