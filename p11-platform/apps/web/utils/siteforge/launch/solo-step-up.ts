import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { start } from 'workflow/api'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { recordSharedApprovalDecision } from '@/utils/services/shared-approvals'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { siteForgeProductionCertificationWorkflow } from '@/workflows/siteforge-production-certification'
import {
  executeLaunchProviderMutation,
  loadLaunchApprovalBinding,
  promoteLaunchRelease,
  signManualPromotionToken,
} from './service'
import {
  getLaunchRelease,
  prepareLaunchRelease,
  SiteForgeLaunchError,
  transitionLaunchRelease,
} from './repository'

type ServiceClient = SupabaseClient<Database>
type LaunchPolicy = Tables<'siteforge_launch_policies'>

const OWNER_LAUNCH_AUTHORITY_TTL_MS = 60 * 60_000

// Owner one-button launch is the default; both env vars remain only as
// explicit production kill switches (set to 'false' to disable).
function featureEnabled(): boolean {
  return (
    process.env.SITEFORGE_SOLO_LAUNCH_ENABLED !== 'false' &&
    process.env.SITEFORGE_VERTICALS_V2_ENABLED !== 'false'
  )
}

function assertFeatureEnabled(): void {
  if (!featureEnabled()) {
    throw new SiteForgeLaunchError(
      'Owner one-button launch is disabled by the production kill switch',
      503
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function ensureOwnerLaunchPolicy(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  actorId: string,
  client: ServiceClient
): Promise<LaunchPolicy> {
  const { data: latest, error: latestError } = await client
    .from('siteforge_launch_policies')
    .select('*')
    .eq('website_id', release.website_id)
    .eq('property_id', release.property_id)
    .eq('org_id', release.org_id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new SiteForgeLaunchError(
      `Failed to load owner launch policy: ${latestError.message}`,
      500
    )
  }
  if (latest && asRecord(latest.policy).mode === 'owner_one_button') {
    return latest
  }

  const policy = {
    schemaVersion: 3,
    mode: 'owner_one_button',
    requiredAal: 'aal1',
    requiresDistinctApprover: false,
    noteRequired: false,
    exactArtifactBindingRequired: true,
    exactStagingCertificationRequired: true,
    exactBrandAndPlanBindingRequired: true,
    rollbackBindingRequired: true,
    automaticBackupAndPromotion: true,
    protectedProductionCertificationRequired: true,
    automaticRecoveryRequestOnFailure: true,
  }
  const { data, error } = await client
    .from('siteforge_launch_policies')
    .insert({
      org_id: release.org_id,
      property_id: release.property_id,
      website_id: release.website_id,
      version: (latest?.version || 0) + 1,
      required_aal: 'aal1',
      confirmation_ttl_seconds: OWNER_LAUNCH_AUTHORITY_TTL_MS / 1_000,
      requires_distinct_approver: false,
      policy,
      content_hash: hashSiteForgeContent(policy),
      created_by: actorId,
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeLaunchError(
      `Failed to create owner launch policy: ${error?.message || 'missing policy'}`,
      500
    )
  }
  return data
}

async function authorizeOwnerLaunch(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  actorId: string,
  requestId: string,
  client: ServiceClient
) {
  const policy = await ensureOwnerLaunchPolicy(release, actorId, client)
  const { data: rebound, error: rebindError } = await client
    .from('siteforge_launch_releases')
    .update({
      launch_policy_id: policy.id,
      launch_policy_content_hash: policy.content_hash,
    })
    .eq('id', release.id)
    .eq('state', 'certified')
    .eq('state_version', release.state_version)
    .select('*')
    .single()
  if (rebindError || !rebound) {
    throw new SiteForgeLaunchError(
      'Failed to bind the exact release to the owner launch policy',
      409
    )
  }

  const approvalBinding = await loadLaunchApprovalBinding(rebound, client)
  if (!rebound.launch_action_attempt_id) {
    throw new SiteForgeLaunchError('Launch action audit is missing', 409)
  }
  const decision = await recordSharedApprovalDecision(
    {
      propertyId: rebound.property_id,
      actionAttemptId: rebound.launch_action_attempt_id,
      reviewerProfileId: actorId,
      decisionStatus: 'approved',
      decisionReason: 'owner_launch_action',
      decisionPayload: {
        releaseId: rebound.id,
        artifactId: rebound.artifact_id,
        contentHash: rebound.artifact_content_hash,
        rollbackArtifactId: rebound.rollback_artifact_id,
        rollbackContentHash: rebound.rollback_content_hash,
        launchBinding: approvalBinding.binding,
        launchBindingHash: approvalBinding.bindingHash,
      },
      policyDecision: {
        policyName: 'siteforge-owner-one-button-launch',
        policyVersion: 'v1',
        confidenceScore: 1,
      },
    },
    client
  )
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + OWNER_LAUNCH_AUTHORITY_TTL_MS
  ).toISOString()
  const token = signManualPromotionToken({
    releaseId: rebound.id,
    artifactId: rebound.artifact_id,
    contentHash: rebound.artifact_content_hash,
    bindingHash: approvalBinding.bindingHash,
    expiresAt,
  })
  const { data: approved, error } = await client
    .from('siteforge_launch_releases')
    .update({
      launch_approval_id: decision.approval.id,
      approval_expires_at: expiresAt,
      approval_rationale: null,
      legal_rights_snapshot: {
        mode: 'owner_one_button',
        launchBinding: approvalBinding.binding,
        launchBindingHash: approvalBinding.bindingHash,
      } as unknown as Json,
      approved_by: actorId,
      approved_at: now.toISOString(),
      promotion_token_hash: sha256(token),
      promotion_token_expires_at: expiresAt,
      promotion_token_consumed_at: null,
    })
    .eq('id', rebound.id)
    .eq('state_version', rebound.state_version)
    .select('*')
    .single()
  if (error || !approved) {
    throw new SiteForgeLaunchError(
      'Failed to persist exact owner launch authority',
      500
    )
  }
  await client
    .from('shared_action_attempts')
    .update({
      lifecycle_status: 'running',
      proposal_decision_status: 'approved',
      execution_status: 'running',
      reviewed_by: actorId,
      decided_at: now.toISOString(),
      policy_reason:
        'Authenticated property owner launched the exact machine-certified release.',
    })
    .eq('id', rebound.launch_action_attempt_id)

  return {
    release: await transitionLaunchRelease(
      approved,
      'launch_approved',
      'operator',
      actorId,
      'Owner launched exact certified release',
      {
        mode: 'owner_one_button',
        launchBindingHash: approvalBinding.bindingHash,
      },
      requestId,
      client
    ),
    token,
    bindingHash: approvalBinding.bindingHash,
  }
}

export function assertOwnerLaunchBinding(input: {
  actorId: string
  approvedBy: string | null
  expectedBindingHash: string
  recordedBindingHash: unknown
}): void {
  if (
    input.approvedBy !== input.actorId ||
    input.recordedBindingHash !== input.expectedBindingHash
  ) {
    throw new SiteForgeLaunchError(
      'Owner launch authority does not match the exact certified release',
      403
    )
  }
}

async function queueOwnerProductionCertification(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  actorId: string,
  client: ServiceClient
) {
  const [
    { data: website, error: websiteError },
    { data: deployment, error: deploymentError },
  ] = await Promise.all([
    client
      .from('property_websites')
      .select(
        'id, org_id, property_id, target_domain, production_url, production_target_id'
      )
      .eq('id', release.website_id)
      .eq('property_id', release.property_id)
      .single(),
    client
      .from('siteforge_artifact_deployments')
      .select('id, target_id, deployed_url')
      .eq('website_id', release.website_id)
      .eq('artifact_id', release.artifact_id)
      .eq('artifact_content_hash', release.artifact_content_hash)
      .eq('status', 'production_certifying')
      .maybeSingle(),
  ])
  if (
    websiteError ||
    deploymentError ||
    !website ||
    !deployment ||
    !website.production_target_id ||
    deployment.target_id !== website.production_target_id
  ) {
    throw new SiteForgeLaunchError(
      'Promoted production identity is unavailable for automatic certification',
      409
    )
  }
  const productionUrl =
    (website.target_domain ? `https://${website.target_domain}` : null) ||
    website.production_url ||
    deployment.deployed_url
  if (!productionUrl) {
    throw new SiteForgeLaunchError(
      'Production URL is unavailable for automatic certification',
      409
    )
  }
  const dedupeKey = [
    'siteforge-production-certification',
    website.id,
    release.artifact_id,
    release.artifact_content_hash,
    release.id,
  ].join(':')
  const { data: existing, error: existingError } = await client
    .from('shared_jobs')
    .select('id, lifecycle_status, workflow_run_id')
    .eq('org_id', website.org_id)
    .eq('domain', 'siteforge.production-certification')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (existingError) {
    throw new SiteForgeLaunchError(
      `Failed to reconcile automatic production certification: ${existingError.message}`,
      500
    )
  }
  if (
    existing &&
    ['queued', 'running', 'retrying', 'succeeded'].includes(
      existing.lifecycle_status
    )
  ) {
    return existing
  }

  const now = new Date().toISOString()
  const jobValues = {
    lifecycle_status: 'queued',
    status_reason: 'production_certification_starting',
    stage: 'queued',
    progress: 0,
    current_step: 'Waiting to certify owner-launched production',
    payload: {
      websiteId: website.id,
      artifactId: release.artifact_id,
      contentHash: release.artifact_content_hash,
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
  const jobQuery = existing
    ? client.from('shared_jobs').update(jobValues).eq('id', existing.id)
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
    throw new SiteForgeLaunchError(
      `Failed to queue automatic production certification: ${jobError?.message || 'missing job'}`,
      500
    )
  }
  const workflowInput = {
    sharedJobId: job.id,
    deploymentId: deployment.id,
    targetId: deployment.target_id,
    websiteId: website.id,
    propertyId: website.property_id,
    orgId: website.org_id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    releaseId: release.id,
    actorId,
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
    throw new SiteForgeLaunchError(
      `Failed to persist automatic certification workflow: ${runError.message}`,
      500
    )
  }
  return { ...job, workflow_run_id: run.runId, lifecycle_status: 'queued' }
}

export async function executeSoloLaunch(
  input: {
    releaseId?: string
    websiteId: string
    propertyId: string
    actorId: string
    requestId: string
  },
  client: ServiceClient = createServiceClient()
) {
  assertFeatureEnabled()
  let release
  if (input.releaseId) {
    release = await getLaunchRelease(input.releaseId, input.propertyId, client)
    if (release.website_id !== input.websiteId) {
      throw new SiteForgeLaunchError(
        'Launch release does not belong to this website',
        409
      )
    }
  } else {
    const { data: website, error } = await client
      .from('property_websites')
      .select(
        'id, staging_artifact_id, staging_content_hash, staging_certified_at, production_artifact_id, production_content_hash, production_certified_at'
      )
      .eq('id', input.websiteId)
      .eq('property_id', input.propertyId)
      .single()
    if (
      error ||
      !website?.staging_artifact_id ||
      !website.staging_content_hash ||
      !website.staging_certified_at
    ) {
      throw new SiteForgeLaunchError(
        'Exact certified staging identity is required before launch',
        409
      )
    }
    const hasRollback = Boolean(
      website.production_artifact_id &&
        website.production_content_hash &&
        website.production_certified_at
    )
    release = await prepareLaunchRelease(
      {
        websiteId: website.id,
        propertyId: input.propertyId,
        artifactId: website.staging_artifact_id,
        contentHash: website.staging_content_hash,
        rollbackArtifactId: hasRollback
          ? website.production_artifact_id
          : null,
        rollbackContentHash: hasRollback
          ? website.production_content_hash
          : null,
        requestedBy: input.actorId,
        requestId: input.requestId,
      },
      client
    )
  }
  if (['production_certified', 'live'].includes(release.state)) {
    return { release, duplicate: true as const, certificationQueued: true }
  }
  if (!['certified', 'launch_approved', 'backed_up', 'promoted'].includes(release.state)) {
    throw new SiteForgeLaunchError(
      `Owner launch cannot execute from ${release.state}`,
      409
    )
  }

  let token: string | null = null
  let bindingHash: string
  if (release.state === 'certified') {
    const authorized = await authorizeOwnerLaunch(
      release,
      input.actorId,
      input.requestId,
      client
    )
    release = authorized.release
    token = authorized.token
    bindingHash = authorized.bindingHash
  } else {
    const approvalBinding = await loadLaunchApprovalBinding(release, client)
    assertOwnerLaunchBinding({
      actorId: input.actorId,
      approvedBy: release.approved_by,
      expectedBindingHash: approvalBinding.bindingHash,
      recordedBindingHash: asRecord(release.legal_rights_snapshot)
        .launchBindingHash,
    })
    bindingHash = approvalBinding.bindingHash
    const expiresAt = new Date(
      Date.now() + OWNER_LAUNCH_AUTHORITY_TTL_MS
    ).toISOString()
    token = signManualPromotionToken({
      releaseId: release.id,
      artifactId: release.artifact_id,
      contentHash: release.artifact_content_hash,
      bindingHash,
      expiresAt,
    })
    const { data: refreshed, error } = await client
      .from('siteforge_launch_releases')
      .update({
        approval_expires_at: expiresAt,
        promotion_token_hash: sha256(token),
        promotion_token_expires_at: expiresAt,
        promotion_token_consumed_at: null,
      })
      .eq('id', release.id)
      .eq('state_version', release.state_version)
      .select('*')
      .single()
    if (error || !refreshed) {
      throw new SiteForgeLaunchError(
        'Failed to refresh server-side owner launch authority',
        409
      )
    }
    release = refreshed
  }

  if (release.state === 'launch_approved') {
    const backup = await executeLaunchProviderMutation(
      {
        releaseId: release.id,
        propertyId: release.property_id,
        mutation: 'backup',
        actorId: input.actorId,
        ownerLaunchBindingHash: bindingHash,
        requestId: input.requestId,
      },
      client
    )
    if (backup.mutation !== 'backup') {
      throw new SiteForgeLaunchError('Unexpected backup provider response', 500)
    }
    const backedUp = await promoteLaunchRelease(
      {
        releaseId: release.id,
        propertyId: release.property_id,
        promotionToken: token,
        actorId: input.actorId,
        backupConfirmation: {
          operationId: backup.operationId,
          backupId: backup.backupId,
        },
        ownerLaunchBindingHash: bindingHash,
        requestId: input.requestId,
      },
      client
    )
    release = backedUp.release
  }

  if (release.state === 'backed_up') {
    const promotion = await executeLaunchProviderMutation(
      {
        releaseId: release.id,
        propertyId: release.property_id,
        mutation: 'promotion',
        actorId: input.actorId,
        ownerLaunchBindingHash: bindingHash,
        requestId: input.requestId,
      },
      client
    )
    if (promotion.mutation !== 'promotion') {
      throw new SiteForgeLaunchError(
        'Unexpected promotion provider response',
        500
      )
    }
    const promoted = await promoteLaunchRelease(
      {
        releaseId: release.id,
        propertyId: release.property_id,
        promotionToken: token,
        actorId: input.actorId,
        manualConfirmation: { operationId: promotion.operationId },
        ownerLaunchBindingHash: bindingHash,
        requestId: input.requestId,
      },
      client
    )
    release = promoted.release
  }

  const certification =
    release.state === 'promoted'
      ? await queueOwnerProductionCertification(release, input.actorId, client)
      : null

  return {
    release,
    duplicate: false as const,
    certificationQueued: Boolean(certification),
    certificationJobId: certification?.id || null,
  }
}
