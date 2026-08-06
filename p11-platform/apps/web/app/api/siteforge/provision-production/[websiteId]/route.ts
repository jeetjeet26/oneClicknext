import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { start } from 'workflow/api'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  CloudwaysProviderClient,
  parseCloudwaysApplicationHostname,
} from '@/utils/siteforge/providers/cloudways-provider'
import { readCloudwaysProvisioningCheckpoint } from '@/utils/siteforge/workflows/staging-steps'
import { siteForgeProductionProvisioningWorkflow } from '@/workflows/siteforge-production-provisioning'

const requestSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/)
      .optional(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/provision-production/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    const parsed = requestSchema.safeParse(
      await request.json().catch(() => ({}))
    )
    if (!z.string().uuid().safeParse(websiteId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Valid production WordPress provisioning input is required' },
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
    const { data: website, error: websiteError } = await client
      .from('property_websites')
      .select(
        'id, org_id, property_id, wordpress_credential_ref, production_target_id'
      )
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyManagerAccess(
      user.id,
      website.property_id
    )
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    if (website.wordpress_credential_ref) {
      return NextResponse.json(
        {
          error:
            'A production WordPress application is already linked to this website',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (!process.env.CLOUDWAYS_API_KEY || !process.env.CLOUDWAYS_EMAIL) {
      return NextResponse.json(
        { error: 'Cloudways API credentials are required', requiresConfig: true },
        { status: 503, headers: ctx.responseHeaders }
      )
    }
    const previewIdentity = process.env.SITEFORGE_PREVIEW_WP_URL
      ? parseCloudwaysApplicationHostname(process.env.SITEFORGE_PREVIEW_WP_URL)
      : null
    const serverId =
      process.env.SITEFORGE_CLOUDWAYS_SERVER_ID || previewIdentity?.serverId
    if (!serverId) {
      return NextResponse.json(
        {
          error:
            'SITEFORGE_CLOUDWAYS_SERVER_ID or a Cloudways preview URL is required',
          requiresConfig: true,
        },
        { status: 503, headers: ctx.responseHeaders }
      )
    }

    const { data: existingTarget, error: targetLookupError } = await client
      .from('siteforge_wordpress_targets')
      .select(
        'id, status, metadata, provider_application_id, credential_ref, site_url'
      )
      .eq('website_id', website.id)
      .eq('target_type', 'production')
      .eq('is_active', true)
      .maybeSingle()
    if (targetLookupError) throw new Error(targetLookupError.message)
    if (
      existingTarget?.provider_application_id &&
      existingTarget.credential_ref &&
      existingTarget.site_url
    ) {
      return NextResponse.json(
        {
          error:
            'The production target is already provisioned but its website credential link is missing',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    let target = existingTarget
    if (!target) {
      const { data: createdTarget, error: targetCreateError } = await client
        .from('siteforge_wordpress_targets')
        .insert({
          org_id: website.org_id,
          property_id: website.property_id,
          website_id: website.id,
          target_type: 'production',
          provider: 'cloudways',
          provider_server_id: serverId,
          protection_mode: 'public',
          status: 'pending',
          is_active: true,
          metadata: {
            provisioningPolicy: 'siteforge-production-provisioning-v1',
          } as Json,
        })
        .select(
          'id, status, metadata, provider_application_id, credential_ref, site_url'
        )
        .single()
      if (targetCreateError || !createdTarget) {
        if (targetCreateError?.code === '23505') {
          const { data: concurrentTarget } = await client
            .from('siteforge_wordpress_targets')
            .select(
              'id, status, metadata, provider_application_id, credential_ref, site_url'
            )
            .eq('website_id', website.id)
            .eq('target_type', 'production')
            .eq('is_active', true)
            .single()
          target = concurrentTarget
        } else {
          throw new Error(
            `Failed to create production target: ${
              targetCreateError?.message || 'missing row'
            }`
          )
        }
      } else {
        target = createdTarget
      }
    }
    if (!target) throw new Error('Production target identity is missing')
    const checkpoint = readCloudwaysProvisioningCheckpoint(target.metadata)
    const targetMetadata =
      target.metadata &&
      typeof target.metadata === 'object' &&
      !Array.isArray(target.metadata)
        ? (target.metadata as Record<string, unknown>)
        : {}
    if (
      targetMetadata.provisioningCheckpoint &&
      !checkpoint.operationId &&
      !checkpoint.applicationId
    ) {
      return NextResponse.json(
        {
          error:
            'Production provisioning has an unresolved provider initiation claim. Verify the Cloudways application before retrying so a duplicate is not created.',
          requiresProviderReconciliation: true,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const dedupeKey = `siteforge-production-provisioning:${website.id}`
    const { data: existingJob } = await client
      .from('shared_jobs')
      .select('id, lifecycle_status, workflow_run_id, attempt_count')
      .eq('org_id', website.org_id)
      .eq('domain', 'siteforge.production_provisioning')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (
      existingJob &&
      ['queued', 'running', 'retrying', 'succeeded'].includes(
        existingJob.lifecycle_status
      )
    ) {
      return NextResponse.json(
        {
          jobId: existingJob.id,
          workflowRunId: existingJob.workflow_run_id,
          status: existingJob.lifecycle_status,
          duplicate: true,
        },
        {
          status: existingJob.lifecycle_status === 'succeeded' ? 200 : 202,
          headers: ctx.responseHeaders,
        }
      )
    }
    const now = new Date().toISOString()
    const jobValues = {
      lifecycle_status: 'queued' as const,
      status_reason: 'production_provisioning_starting',
      stage: 'queued',
      progress: 0,
      current_step: 'Preparing dedicated production WordPress application',
      payload: {
        websiteId: website.id,
        propertyId: website.property_id,
        orgId: website.org_id,
        targetId: target.id,
        serverId,
        startedAt: now,
      } as Json,
      workflow_run_id: null,
      error_message: null,
      error_details: null,
      cancel_requested: false,
      attempt_count: (existingJob?.attempt_count || 0) + 1,
      max_attempts: 3,
      queued_at: now,
      updated_at: now,
    }
    const jobQuery = existingJob
      ? client.from('shared_jobs').update(jobValues).eq('id', existingJob.id)
      : client.from('shared_jobs').insert({
          ...jobValues,
          org_id: website.org_id,
          property_id: website.property_id,
          domain: 'siteforge.production_provisioning',
          subject_type: 'siteforge_wordpress_target',
          subject_id: target.id,
          dedupe_key: dedupeKey,
        })
    const { data: job, error: jobError } = await jobQuery
      .select('id')
      .single()
    if (jobError || !job) {
      if (jobError?.code === '23505') {
        const { data: concurrentJob } = await client
          .from('shared_jobs')
          .select('id, lifecycle_status, workflow_run_id')
          .eq('org_id', website.org_id)
          .eq('domain', 'siteforge.production_provisioning')
          .eq('dedupe_key', dedupeKey)
          .single()
        return NextResponse.json(
          {
            jobId: concurrentJob?.id,
            workflowRunId: concurrentJob?.workflow_run_id,
            status: concurrentJob?.lifecycle_status || 'queued',
            duplicate: true,
          },
          { status: 202, headers: ctx.responseHeaders }
        )
      }
      throw new Error(
        `Failed to queue production provisioning: ${
          jobError?.message || 'missing row'
        }`
      )
    }

    if (!checkpoint.operationId && !checkpoint.applicationId) {
      const label =
        parsed.data.label || `siteforge-production-${website.id.slice(0, 8)}`
      const claimId = randomUUID()
      const { data: claimedTarget, error: claimError } = await client
        .from('siteforge_wordpress_targets')
        .update({
          provider_server_id: serverId,
          status: 'provisioning',
          metadata: {
            ...targetMetadata,
            provisioningCheckpoint: {
              state: 'initiating',
              claimId,
              serverId,
              label,
              claimedAt: now,
            },
          } as Json,
          updated_at: now,
        })
        .eq('id', target.id)
        .filter('metadata->provisioningCheckpoint', 'is', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimedTarget) {
        throw new Error(
          `Failed to claim Cloudways production provisioning: ${
            claimError?.message || 'another request already owns the claim'
          }`
        )
      }
      const cloudways = new CloudwaysProviderClient({
        apiKey: process.env.CLOUDWAYS_API_KEY,
        email: process.env.CLOUDWAYS_EMAIL,
      })
      let application: {
        operationId: string | null
        applicationId: string | null
      }
      try {
        application = await cloudways.createApplication({
          serverId,
          label,
        })
      } catch (error) {
        await markProvisioningStartFailed(
          client,
          job.id,
          target.id,
          error instanceof Error ? error.message : 'Unknown provider error'
        )
        return NextResponse.json(
          {
            error: 'Failed to create the Cloudways WordPress application',
            detail:
              error instanceof Error ? error.message : 'Unknown provider error',
          },
          { status: 502, headers: ctx.responseHeaders }
        )
      }
      if (!application.operationId && !application.applicationId) {
        const message =
          'Cloudways did not return an application operation identity'
        await markProvisioningStartFailed(
          client,
          job.id,
          target.id,
          message
        )
        return NextResponse.json(
          { error: message },
          { status: 502, headers: ctx.responseHeaders }
        )
      }
      const { data: checkpointed, error: checkpointError } = await client
        .from('siteforge_wordpress_targets')
        .update({
          provider_server_id: serverId,
          status: 'provisioning',
          metadata: {
            ...targetMetadata,
            provisioningCheckpoint: {
              state: 'started',
              claimId,
              operationId: application.operationId,
              applicationId: application.applicationId,
              serverId,
              label,
              initiatedAt: now,
            },
          } as Json,
          updated_at: now,
        })
        .eq('id', target.id)
        .contains('metadata', {
          provisioningCheckpoint: { claimId },
        })
        .select('id')
        .maybeSingle()
      if (checkpointError || !checkpointed) {
        throw new Error(
          `Failed to persist Cloudways production checkpoint: ${
            checkpointError?.message || 'target row was not updated'
          }`
        )
      }
    } else {
      await client
        .from('siteforge_wordpress_targets')
        .update({ status: 'provisioning', updated_at: now })
        .eq('id', target.id)
    }

    const workflowInput = {
      sharedJobId: job.id,
      targetId: target.id,
      websiteId: website.id,
      propertyId: website.property_id,
      orgId: website.org_id,
      serverId,
      startedAt: now,
    }
    let run: Awaited<ReturnType<typeof start>>
    try {
      run = await start(siteForgeProductionProvisioningWorkflow, [
        workflowInput,
      ])
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Production provisioning workflow failed to start'
      await markProvisioningStartFailed(
        client,
        job.id,
        target.id,
        message
      )
      throw error
    }
    const { data: linkedJob, error: linkError } = await client
      .from('shared_jobs')
      .update({
        workflow_run_id: run.runId,
        workflow_name: 'siteForgeProductionProvisioningWorkflow',
        payload: workflowInput as unknown as Json,
        status_reason: 'production_provisioning_queued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('id')
      .maybeSingle()
    if (linkError || !linkedJob) {
      await run.cancel()
      throw new Error(
        `Failed to persist production provisioning workflow: ${
          linkError?.message || 'job row was not updated'
        }`
      )
    }
    ctx.logSuccess(202, { jobId: job.id, targetId: target.id })
    return NextResponse.json(
      {
        jobId: job.id,
        workflowRunId: run.runId,
        targetId: target.id,
        status: 'queued',
      },
      { status: 202, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to provision production WordPress' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

async function markProvisioningStartFailed(
  client: ReturnType<typeof createServiceClient>,
  jobId: string,
  targetId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString()
  await Promise.all([
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'production_provisioning_start_failed',
        stage: 'failed',
        current_step: 'Production WordPress provisioning failed to start',
        error_message: message,
        error_details: { message } as Json,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', jobId),
    client
      .from('siteforge_wordpress_targets')
      .update({ status: 'failed', updated_at: now })
      .eq('id', targetId),
  ])
}
