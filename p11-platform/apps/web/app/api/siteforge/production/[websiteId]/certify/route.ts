import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { siteForgeProductionCertificationWorkflow } from '@/workflows/siteforge-production-certification'

const requestSchema = z
  .object({
    releaseId: z.string().uuid(),
    promotedArtifactId: z.string().uuid(),
    promotedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/production/[websiteId]/certify'
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
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Exact promoted artifact confirmation is required' },
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
        'id, org_id, property_id, wordpress_credential_ref, target_domain, staging_artifact_id, staging_content_hash, staging_certified_at'
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
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Production certification permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    if (
      !website.staging_certified_at ||
      website.staging_artifact_id !== parsed.data.promotedArtifactId ||
      website.staging_content_hash !== parsed.data.promotedContentHash
    ) {
      return NextResponse.json(
        { error: 'Promotion confirmation does not match the certified staging artifact' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: release, error: releaseError } = await client
      .from('siteforge_launch_releases')
      .select(
        'id, state, state_version, artifact_id, artifact_content_hash, approval_expires_at, launch_approval_id, promoted_at'
      )
      .eq('id', parsed.data.releaseId)
      .eq('website_id', website.id)
      .eq('property_id', website.property_id)
      .single()
    if (
      releaseError ||
      !release ||
      release.state !== 'promoted' ||
      release.artifact_id !== parsed.data.promotedArtifactId ||
      release.artifact_content_hash !== parsed.data.promotedContentHash ||
      !release.launch_approval_id ||
      !release.promoted_at ||
      !release.approval_expires_at ||
      new Date(release.approval_expires_at).getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: 'An active, exact, human-approved promoted launch release is required' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (!website.wordpress_credential_ref) {
      return NextResponse.json(
        { error: 'Production WordPress credentials are unavailable' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: artifact, error: artifactError } = await client
      .from('siteforge_blueprint_versions')
      .select(
        'id, content_hash, asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, deployment_decision, confirmed_approval_id'
      )
      .eq('id', parsed.data.promotedArtifactId)
      .eq('website_id', website.id)
      .single()
    if (
      artifactError ||
      !artifact ||
      artifact.content_hash !== parsed.data.promotedContentHash ||
      artifact.deployment_decision !== 'approved' ||
      !artifact.confirmed_approval_id ||
      !artifact.asset_manifest_hash ||
      !artifact.base_theme_package_sha256
    ) {
      return NextResponse.json(
        { error: 'The exact promoted artifact is not approved for release' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const credentials = await getWordPressCredentialReference(
      website.wordpress_credential_ref
    )
    const productionUrl = website.target_domain
      ? `https://${website.target_domain}`
      : credentials.url
    const now = new Date().toISOString()

    const { data: existingTarget } = await client
      .from('siteforge_wordpress_targets')
      .select('id')
      .eq('website_id', website.id)
      .eq('target_type', 'production')
      .eq('is_active', true)
      .maybeSingle()
    const targetValues = {
      org_id: website.org_id,
      property_id: website.property_id,
      website_id: website.id,
      target_type: 'production',
      provider: credentials.provider,
      provider_application_id:
        credentials.providerMetadata?.applicationId || null,
      provider_server_id: credentials.providerMetadata?.serverId || null,
      site_url: productionUrl,
      admin_url: `${productionUrl.replace(/\/$/, '')}/wp-admin`,
      credential_ref: website.wordpress_credential_ref,
      protection_mode: 'noindex',
      status: 'ready',
      is_active: true,
      metadata: {
        promotionPolicy: 'siteforge_launch_release_v1',
        releaseId: release.id,
        confirmedBy: user.id,
        confirmedAt: now,
      } as Json,
      updated_at: now,
    }
    const targetQuery = existingTarget
      ? client
          .from('siteforge_wordpress_targets')
          .update(targetValues)
          .eq('id', existingTarget.id)
      : client.from('siteforge_wordpress_targets').insert(targetValues)
    const { data: target, error: targetError } = await targetQuery
      .select('id')
      .single()
    if (targetError || !target) {
      throw new Error(
        `Failed to prepare production target: ${targetError?.message || 'missing row'}`
      )
    }

    const dedupeKey = [
      'siteforge-production-certification',
      website.id,
      artifact.id,
      artifact.content_hash,
      release.id,
    ].join(':')
    const { data: existingJob } = await client
      .from('shared_jobs')
      .select('id, lifecycle_status, workflow_run_id')
      .eq('org_id', website.org_id)
      .eq('domain', 'siteforge.production-certification')
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

    const jobValues = {
      lifecycle_status: 'queued',
      status_reason: 'production_certification_starting',
      stage: 'queued',
      progress: 0,
      current_step: 'Waiting to certify operator-promoted production',
      payload: {
        websiteId: website.id,
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
        releaseId: release.id,
        productionUrl,
      } as Json,
      error_message: null,
      error_details: null,
      cancel_requested: false,
      attempt_count: 0,
      workflow_run_id: null,
      workflow_name: null,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      queued_at: now,
      updated_at: now,
    }
    const jobQuery = existingJob
      ? client.from('shared_jobs').update(jobValues).eq('id', existingJob.id)
      : client.from('shared_jobs').insert({
          ...jobValues,
          org_id: website.org_id,
          property_id: website.property_id,
          domain: 'siteforge.production-certification',
          subject_type: 'siteforge_website',
          subject_id: website.id,
          dedupe_key: dedupeKey,
          max_attempts: 1,
        })
    const { data: job, error: jobError } = await jobQuery.select('id').single()
    if (jobError || !job) {
      throw new Error(
        `Failed to queue production certification: ${jobError?.message || 'missing row'}`
      )
    }

    const { data: existingDeployment } = await client
      .from('siteforge_artifact_deployments')
      .select('id')
      .eq('target_id', target.id)
      .eq('artifact_id', artifact.id)
      .maybeSingle()
    const deploymentValues = {
      org_id: website.org_id,
      property_id: website.property_id,
      website_id: website.id,
      target_id: target.id,
      artifact_id: artifact.id,
      artifact_content_hash: artifact.content_hash,
      asset_manifest_hash: artifact.asset_manifest_hash,
      base_theme_package_sha256: artifact.base_theme_package_sha256,
      overlay_package_sha256: artifact.overlay_package_sha256,
      approval_id: artifact.confirmed_approval_id,
      shared_job_id: job.id,
      status: 'production_certifying',
      certification_report: {} as Json,
      externally_promoted_at: now,
      deployed_url: null,
      remote_manifest_hash: null,
      deployed_at: null,
      certified_at: null,
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
        `Failed to create production certification record: ${
          deploymentError?.message || 'missing row'
        }`
      )
    }

    const workflowInput = {
      sharedJobId: job.id,
      deploymentId: deployment.id,
      targetId: target.id,
      websiteId: website.id,
      propertyId: website.property_id,
      orgId: website.org_id,
      artifactId: artifact.id,
      contentHash: artifact.content_hash,
      releaseId: release.id,
      actorId: user.id,
      productionUrl,
      startedAt: now,
    }
    const run = await start(siteForgeProductionCertificationWorkflow, [
      workflowInput,
    ])
    const { error: runError } = await client
      .from('shared_jobs')
      .update({
        workflow_run_id: run.runId,
        workflow_name: 'siteForgeProductionCertificationWorkflow',
        payload: workflowInput as unknown as Json,
        status_reason: 'production_certification_queued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    if (runError) {
      throw new Error(`Failed to persist production workflow identity: ${runError.message}`)
    }

    ctx.logSuccess(202, {
      websiteId: website.id,
      artifactId: artifact.id,
      jobId: job.id,
    })
    return NextResponse.json(
      {
        status: 'queued',
        jobId: job.id,
        workflowRunId: run.runId,
        productionUrl,
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
      },
      { status: 202, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start production certification',
      },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
