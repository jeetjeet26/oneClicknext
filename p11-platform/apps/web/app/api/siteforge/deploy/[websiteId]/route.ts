import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { CloudwaysProviderClient } from '@/utils/siteforge/providers/cloudways-provider'
import { readCloudwaysProvisioningCheckpoint } from '@/utils/siteforge/workflows/staging-steps'
import { siteForgeStagingDeploymentWorkflow } from '@/workflows/siteforge-staging-deployment'
import type { Json } from '@/types/supabase'
import {
  assertActiveAuroraLifecycleLease,
  auroraOwnedMetadata,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/deploy/[websiteId]')
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
        'id, org_id, property_id, current_artifact_version_id, canonical_preview_artifact_id, canonical_preview_content_hash, wordpress_credential_ref, staging_artifact_id, staging_content_hash, staging_url, staging_admin_url'
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
      client
    )
    if (!website.current_artifact_version_id) {
      return NextResponse.json(
        { error: 'Website is missing a current immutable artifact' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: artifact, error: artifactError } = await client
      .from('siteforge_blueprint_versions')
      .select(
        'id, content_hash, asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, deployment_decision, deployment_approved_at, confirmed_approval_id'
      )
      .eq('id', website.current_artifact_version_id)
      .eq('website_id', website.id)
      .single()
    if (
      artifactError ||
      !artifact ||
      !artifact.asset_manifest_hash ||
      !artifact.base_theme_package_sha256 ||
      artifact.deployment_decision !== 'approved' ||
      !artifact.deployment_approved_at ||
      !artifact.confirmed_approval_id ||
      website.canonical_preview_artifact_id !== artifact.id ||
      website.canonical_preview_content_hash !== artifact.content_hash
    ) {
      return NextResponse.json(
        {
          error:
            'Approve an exact, fully snapshotted WordPress preview before deploying to staging',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (
      website.staging_artifact_id === artifact.id &&
      website.staging_content_hash === artifact.content_hash &&
      website.staging_url
    ) {
      return NextResponse.json(
        {
          status: 'ready',
          artifactId: artifact.id,
          contentHash: artifact.content_hash,
          stagingUrl: website.staging_url,
          stagingAdminUrl: website.staging_admin_url,
          pushToLiveLocation: 'siteforge_launch_release',
        },
        { headers: ctx.responseHeaders }
      )
    }

    const localSimulation =
      request.nextUrl.searchParams.get('simulate') === '1' &&
      process.env.NODE_ENV !== 'production'
    let parentMetadata:
      | {
          serverId: string
          applicationId: string
          publicIp: string
        }
      | null = null
    if (!localSimulation) {
      if (
        !website.wordpress_credential_ref ||
        !process.env.CLOUDWAYS_API_KEY ||
        !process.env.CLOUDWAYS_EMAIL
      ) {
        return NextResponse.json(
          {
            error:
              'A linked Cloudways parent application and Cloudways API credentials are required',
            requiresConfig: true,
          },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      const parent = await getWordPressCredentialReference(
        website.wordpress_credential_ref
      )
      if (parent.provider !== 'cloudways' || !parent.providerMetadata) {
        return NextResponse.json(
          { error: 'The linked WordPress target is not a Cloudways application' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      parentMetadata = parent.providerMetadata
    }

    const { data: existingTarget, error: targetLookupError } = await client
      .from('siteforge_wordpress_targets')
      .select('id, metadata')
      .eq('website_id', website.id)
      .eq('target_type', 'staging')
      .eq('is_active', true)
      .maybeSingle()
    if (targetLookupError) throw new Error(targetLookupError.message)
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
        'Staging target belongs to another lifecycle owner',
        409,
        'target_owner_conflict'
      )
    }
    let targetId = existingTarget?.id
    if (targetId && lifecycleIdentity) {
      const { error } = await client
        .from('siteforge_wordpress_targets')
        .update({
          metadata: auroraOwnedMetadata(
            lifecycleIdentity,
            existingTarget?.metadata
          ),
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetId)
      if (error) throw new Error(error.message)
    }
    if (!targetId) {
      const { data: createdTarget, error: targetCreateError } = await client
        .from('siteforge_wordpress_targets')
        .insert({
          org_id: website.org_id,
          property_id: website.property_id,
          website_id: website.id,
          target_type: 'staging',
          provider: localSimulation ? 'local_simulation' : 'cloudways',
          provider_parent_application_id: parentMetadata?.applicationId || null,
          provider_server_id: parentMetadata?.serverId || null,
          dashboard_url: parentMetadata
            ? `https://platform.cloudways.com/apps`
            : null,
          protection_mode: 'noindex',
          status: 'pending',
          is_active: true,
          metadata: {
            parentPublicIp: parentMetadata?.publicIp || null,
            promotionPolicy: 'siteforge_launch_release_v1',
            ...(lifecycleIdentity
              ? {
                  lifecycleOwnerId: lifecycleIdentity.ownerId,
                  lifecycleRunId: lifecycleIdentity.ownerId,
                  lifecycleExpiresAt: lifecycleIdentity.expiresAt,
                }
              : {}),
          } as Json,
        })
        .select('id')
        .single()
      if (targetCreateError || !createdTarget) {
        throw new Error(
          `Failed to create staging target: ${
            targetCreateError?.message || 'missing row'
          }`
        )
      }
      targetId = createdTarget.id
    }

    if (!localSimulation && parentMetadata) {
      // Cloudways cloneApp is not idempotent, so the workflow refuses to
      // initiate it. Start the clone exactly once here and persist the
      // operation checkpoint; the workflow waits on it and resolves the
      // staging application identity from the completed operation.
      const { data: targetRow, error: targetRowError } = await client
        .from('siteforge_wordpress_targets')
        .select('id, metadata, provider_application_id, credential_ref, site_url')
        .eq('id', targetId)
        .single()
      if (targetRowError || !targetRow) {
        throw new Error(
          `Failed to load staging target for provisioning: ${
            targetRowError?.message || 'missing row'
          }`
        )
      }
      const checkpoint = readCloudwaysProvisioningCheckpoint(targetRow.metadata)
      const alreadyProvisioned = Boolean(
        targetRow.provider_application_id &&
          targetRow.credential_ref &&
          targetRow.site_url
      )
      if (
        !alreadyProvisioned &&
        !checkpoint.operationId &&
        !checkpoint.applicationId
      ) {
        const cloudways = new CloudwaysProviderClient({
          apiKey: process.env.CLOUDWAYS_API_KEY!,
          email: process.env.CLOUDWAYS_EMAIL!,
        })
        let clone: { operationId: string | null; applicationId: string | null }
        try {
          clone = await cloudways.createStagingApplication({
            serverId: parentMetadata.serverId,
            parentApplicationId: parentMetadata.applicationId,
            label: `siteforge-staging-${website.id.slice(0, 8)}`,
          })
        } catch (error) {
          ctx.logError(502, error)
          return NextResponse.json(
            {
              error: 'Failed to start the Cloudways staging clone',
              detail:
                error instanceof Error ? error.message : 'Unknown provider error',
            },
            { status: 502, headers: ctx.responseHeaders }
          )
        }
        if (!clone.operationId && !clone.applicationId) {
          return NextResponse.json(
            {
              error:
                'Cloudways did not return a staging clone operation identity',
            },
            { status: 502, headers: ctx.responseHeaders }
          )
        }
        const currentMetadata =
          targetRow.metadata &&
          typeof targetRow.metadata === 'object' &&
          !Array.isArray(targetRow.metadata)
            ? (targetRow.metadata as Record<string, unknown>)
            : {}
        const { data: checkpointRow, error: checkpointError } = await client
          .from('siteforge_wordpress_targets')
          .update({
            metadata: {
              ...currentMetadata,
              provisioningCheckpoint: {
                operationId: clone.operationId,
                applicationId: clone.applicationId,
                parentApplicationId: parentMetadata.applicationId,
                serverId: parentMetadata.serverId,
                initiatedAt: new Date().toISOString(),
              },
            } as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetId)
          .filter('metadata->provisioningCheckpoint', 'is', null)
          .select('id')
          .maybeSingle()
        if (checkpointError) {
          throw new Error(
            `Failed to persist Cloudways staging provisioning checkpoint: ${checkpointError.message}`
          )
        }
        if (!checkpointRow) {
          // A concurrent request already persisted a checkpoint; proceed with
          // that one rather than overwriting it.
          console.warn(
            '[siteforge.deploy] staging checkpoint already present; orphaning clone',
            { targetId, orphanOperationId: clone.operationId }
          )
        }
      }
    }

    const dedupeKey = [
      'siteforge-staging',
      website.id,
      artifact.id,
      artifact.content_hash,
      localSimulation ? 'simulation' : 'cloudways',
    ].join(':')
    const now = new Date().toISOString()
    const { data: existingJob } = await client
      .from('shared_jobs')
      .select('id, lifecycle_status, workflow_run_id, attempt_count')
      .eq('org_id', website.org_id)
      .eq('domain', 'siteforge.deployment')
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

    const { data: existingDeployment } = await client
      .from('siteforge_artifact_deployments')
      .select('id')
      .eq('target_id', targetId)
      .eq('artifact_id', artifact.id)
      .maybeSingle()
    const deploymentValues = {
      org_id: website.org_id,
      property_id: website.property_id,
      website_id: website.id,
      target_id: targetId,
      artifact_id: artifact.id,
      artifact_content_hash: artifact.content_hash,
      asset_manifest_hash: artifact.asset_manifest_hash,
      base_theme_package_sha256: artifact.base_theme_package_sha256,
      overlay_package_sha256: artifact.overlay_package_sha256,
      approval_id: artifact.confirmed_approval_id,
      shared_job_id: existingJob?.id || null,
      status: 'queued' as const,
      certification_report: {
        status: 'queued',
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
      } as Json,
    }
    const deploymentQuery = existingDeployment
      ? client
          .from('siteforge_artifact_deployments')
          .update(deploymentValues)
          .eq('id', existingDeployment.id)
      : client.from('siteforge_artifact_deployments').insert(deploymentValues)
    const { data: deployment, error: deploymentError } = await deploymentQuery
      .select('id')
      .single()
    if (deploymentError || !deployment) {
      throw new Error(
        `Failed to create exact staging release: ${
          deploymentError?.message || 'missing row'
        }`
      )
    }

    const jobValues = {
      lifecycle_status: 'queued' as const,
      status_reason: 'staging_workflow_starting',
      stage: 'queued',
      progress: 0,
      current_step: 'Preparing linked Cloudways staging deployment',
      payload: {
        websiteId: website.id,
        propertyId: website.property_id,
        orgId: website.org_id,
        targetId,
        deploymentId: deployment.id,
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
        approvalId: artifact.confirmed_approval_id,
        localSimulation,
        startedAt: now,
        ...(lifecycleIdentity
          ? {
              lifecycleOwnerId: lifecycleIdentity.ownerId,
              lifecycleRunId: lifecycleIdentity.ownerId,
              lifecycleExpiresAt: lifecycleIdentity.expiresAt,
            }
          : {}),
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
          domain: 'siteforge.deployment',
          subject_type: 'siteforge_artifact',
          subject_id: artifact.id,
          dedupe_key: dedupeKey,
        })
    const { data: job, error: jobError } = await jobQuery
      .select('id')
      .single()
    if (jobError || !job) {
      throw new Error(
        `Failed to queue staging deployment: ${jobError?.message || 'missing row'}`
      )
    }

    const { data: linkedDeployment, error: deploymentLinkError } = await client
      .from('siteforge_artifact_deployments')
      .update({
        shared_job_id: job.id,
        status: 'queued',
        certification_report: {
          status: 'queued',
          jobId: job.id,
          artifactId: artifact.id,
          contentHash: artifact.content_hash,
        } as Json,
      })
      .eq('id', deployment.id)
      .eq('artifact_id', artifact.id)
      .select('id')
      .maybeSingle()
    if (deploymentLinkError || !linkedDeployment) {
      throw new Error(
        `Failed to link deployment job identity: ${
          deploymentLinkError?.message || 'deployment row was not updated'
        }`
      )
    }

    const workflowInput = {
      sharedJobId: job.id,
      deploymentId: deployment.id,
      targetId,
      websiteId: website.id,
      propertyId: website.property_id,
      orgId: website.org_id,
      artifactId: artifact.id,
      contentHash: artifact.content_hash,
      approvalId: artifact.confirmed_approval_id,
      localSimulation,
      startedAt: now,
    }
    let run: Awaited<ReturnType<typeof start>>
    try {
      run = await start(siteForgeStagingDeploymentWorkflow, [workflowInput])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Staging workflow failed to start'
      const failedAt = new Date().toISOString()
      const [failedJob, failedDeployment] = await Promise.all([
        client
          .from('shared_jobs')
          .update({
            lifecycle_status: 'failed',
            status_reason: 'staging_start_failed',
            stage: 'failed',
            current_step: 'Staging workflow failed to start',
            error_message: message,
            error_details: { message } as Json,
            finished_at: failedAt,
            updated_at: failedAt,
          })
          .eq('id', job.id)
          .eq('lifecycle_status', 'queued')
          .select('id')
          .maybeSingle(),
        client
          .from('siteforge_artifact_deployments')
          .update({
            status: 'failed',
            certification_report: { status: 'failed', error: message } as Json,
          })
          .eq('id', deployment.id)
          .select('id')
          .maybeSingle(),
      ])
      if (
        failedJob.error ||
        !failedJob.data ||
        failedDeployment.error ||
        !failedDeployment.data
      ) {
        throw new Error('Staging launch failed without complete terminal state')
      }
      throw error
    }
    const [linkedJob, updatedWebsite] = await Promise.all([
      client
        .from('shared_jobs')
        .update({
          workflow_run_id: run.runId,
          workflow_name: 'siteForgeStagingDeploymentWorkflow',
          payload: workflowInput as unknown as Json,
          status_reason: 'staging_workflow_queued',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .select('id')
        .maybeSingle(),
      client
        .from('property_websites')
        .update({
          editor_lifecycle_status: 'deploying_staging',
          generation_status: 'deploying',
          staging_target_id: targetId,
          current_step: 'Deploying exact artifact to linked Cloudways staging',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', website.id)
        .select('id')
        .maybeSingle(),
    ])
    if (
      linkedJob.error ||
      !linkedJob.data ||
      updatedWebsite.error ||
      !updatedWebsite.data
    ) {
      await run.cancel()
      throw new Error(
        `Failed to persist staging workflow launch: ${
          linkedJob.error?.message ||
          updatedWebsite.error?.message ||
          'one or more rows were not updated'
        }`
      )
    }

    return NextResponse.json(
      {
        jobId: job.id,
        deploymentId: deployment.id,
        targetId,
        workflowRunId: run.runId,
        status: 'queued',
        message: 'Cloudways staging deployment queued.',
        promotionPolicy: 'Push to Live is available only in Cloudways.',
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
          status !== 500
            ? (error as Error).message
            : error instanceof Error
              ? error.message
            : 'Failed to start Cloudways staging deployment',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
