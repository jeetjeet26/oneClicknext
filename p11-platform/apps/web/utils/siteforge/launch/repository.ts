import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export type LaunchRelease = Tables<'siteforge_launch_releases'>
type ServiceClient = SupabaseClient<Database>

export class SiteForgeLaunchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeLaunchError'
  }
}

async function transition(
  release: LaunchRelease,
  toState: string,
  actorType: 'system' | 'operator' | 'provider',
  actorId: string,
  rationale: string,
  evidence: Json,
  requestId: string | null,
  client: ServiceClient
): Promise<LaunchRelease> {
  const { data, error } = await client.rpc('transition_siteforge_launch_release', {
    p_release_id: release.id,
    p_expected_state_version: release.state_version,
    p_to_state: toState,
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_rationale: rationale || '',
    p_evidence: evidence,
    p_request_id: requestId || '',
  })
  if (error || !data) {
    throw new SiteForgeLaunchError(
      `Failed to transition launch release to ${toState}: ${error?.message || 'missing result'}`,
      error?.message?.includes('version conflict') ? 409 : 500
    )
  }
  return data
}

export async function getLaunchRelease(
  releaseId: string,
  propertyId: string,
  client: ServiceClient = createServiceClient()
): Promise<LaunchRelease> {
  const { data, error } = await client
    .from('siteforge_launch_releases')
    .select('*')
    .eq('id', releaseId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) throw new SiteForgeLaunchError('Launch release not found', 404)
  return data
}

export async function getLaunchStatus(
  input: { releaseId?: string; websiteId?: string; propertyId: string },
  client: ServiceClient = createServiceClient()
) {
  let query = client
    .from('siteforge_launch_releases')
    .select('*')
    .eq('property_id', input.propertyId)
  query = input.releaseId
    ? query.eq('id', input.releaseId)
    : query.eq('website_id', input.websiteId || '').order('release_version', { ascending: false })
  const { data: release, error } = await query.limit(1).maybeSingle()
  if (error || !release) throw new SiteForgeLaunchError('Launch release not found', 404)

  const { data: events, error: eventsError } = await client
    .from('siteforge_launch_events')
    .select('*')
    .eq('release_id', release.id)
    .order('created_at', { ascending: true })
  if (eventsError) throw new SiteForgeLaunchError('Failed to load launch history', 500)

  return {
    release,
    events: events || [],
    humanLaunchRequired: !['live', 'rolled_back'].includes(release.state),
    promotionTokenAvailable:
      Boolean(release.promotion_token_hash) &&
      !release.promotion_token_consumed_at &&
      Boolean(
        release.promotion_token_expires_at &&
          new Date(release.promotion_token_expires_at).getTime() > Date.now()
      ),
  }
}

export async function prepareLaunchRelease(
  input: {
    websiteId: string
    propertyId: string
    artifactId: string
    contentHash: string
    rollbackArtifactId: string
    rollbackContentHash: string
    requestedBy: string
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select(
      'id, org_id, property_id, current_artifact_version_id, staging_artifact_id, staging_content_hash, staging_certified_at, staging_target_id'
    )
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (websiteError || !website) throw new SiteForgeLaunchError('Website not found', 404)
  if (
    website.current_artifact_version_id !== input.artifactId ||
    website.staging_artifact_id !== input.artifactId ||
    website.staging_content_hash !== input.contentHash ||
    !website.staging_certified_at
  ) {
    throw new SiteForgeLaunchError(
      'The exact current artifact must be certified on staging before launch preparation',
      409
    )
  }

  const [{ data: artifact }, { data: rollbackArtifact }, { data: audit }] = await Promise.all([
    client
      .from('siteforge_blueprint_versions')
      .select('id, content_hash, asset_manifest_hash, base_theme_package_sha256, deployment_decision, confirmed_approval_id')
      .eq('id', input.artifactId)
      .eq('website_id', input.websiteId)
      .single(),
    client
      .from('siteforge_blueprint_versions')
      .select('id, content_hash')
      .eq('id', input.rollbackArtifactId)
      .eq('website_id', input.websiteId)
      .single(),
    client
      .from('siteforge_rollout_audits')
      .select('classification, canonical_content_hash')
      .eq('website_id', input.websiteId)
      .eq('artifact_id', input.artifactId)
      .single(),
  ])
  if (
    !artifact ||
    artifact.content_hash !== input.contentHash ||
    artifact.deployment_decision !== 'approved' ||
    !artifact.confirmed_approval_id ||
    !artifact.asset_manifest_hash ||
    !artifact.base_theme_package_sha256 ||
    audit?.classification !== 'deployable'
  ) {
    throw new SiteForgeLaunchError('The exact artifact is not approved and deployable', 409)
  }
  if (
    !rollbackArtifact ||
    rollbackArtifact.content_hash !== input.rollbackContentHash
  ) {
    throw new SiteForgeLaunchError('Exact rollback artifact identity is required', 409)
  }

  const { data: deployment, error: deploymentError } = await client
    .from('siteforge_artifact_deployments')
    .select('id, certification_report, certified_at, artifact_content_hash, remote_manifest_hash')
    .eq('website_id', input.websiteId)
    .eq('artifact_id', input.artifactId)
    .eq('artifact_content_hash', input.contentHash)
    .eq('target_id', website.staging_target_id || '')
    .not('certified_at', 'is', null)
    .order('certified_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (
    deploymentError ||
    !deployment ||
    deployment.remote_manifest_hash !== input.contentHash
  ) {
    throw new SiteForgeLaunchError('Matching staging certification evidence was not found', 409)
  }

  const { data: existing } = await client
    .from('siteforge_launch_releases')
    .select('*')
    .eq('website_id', input.websiteId)
    .not('state', 'in', '(live,failed,rolled_back)')
    .maybeSingle()
  let release = existing
  if (release && (release.artifact_id !== input.artifactId || release.artifact_content_hash !== input.contentHash)) {
    throw new SiteForgeLaunchError('Another launch release is already active', 409)
  }

  if (!release) {
    const { data: latest } = await client
      .from('siteforge_launch_releases')
      .select('release_version')
      .eq('website_id', input.websiteId)
      .order('release_version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: created, error: createError } = await client
      .from('siteforge_launch_releases')
      .insert({
        org_id: website.org_id,
        property_id: website.property_id,
        website_id: website.id,
        release_version: (latest?.release_version || 0) + 1,
        artifact_id: artifact.id,
        artifact_content_hash: artifact.content_hash,
        staging_deployment_id: deployment.id,
        rollback_artifact_id: rollbackArtifact.id,
        rollback_content_hash: rollbackArtifact.content_hash,
        created_by: input.requestedBy,
      })
      .select('*')
      .single()
    if (createError || !created) {
      throw new SiteForgeLaunchError(
        `Failed to create launch release: ${createError?.message || 'missing row'}`,
        createError?.code === '23505' ? 409 : 500
      )
    }
    release = created
  }

  const reportHash = hashSiteForgeContent(deployment.certification_report)
  const { data: evidence } = await client
    .from('siteforge_certification_evidence')
    .select('id')
    .eq('release_id', release.id)
    .eq('environment', 'staging')
    .eq('report_hash', reportHash)
    .maybeSingle()
  if (!evidence) {
    const report =
      deployment.certification_report &&
      typeof deployment.certification_report === 'object' &&
      !Array.isArray(deployment.certification_report)
        ? deployment.certification_report
        : {}
    const { error: evidenceError } = await client
      .from('siteforge_certification_evidence')
      .insert({
        org_id: website.org_id,
        property_id: website.property_id,
        website_id: website.id,
        artifact_id: artifact.id,
        release_id: release.id,
        policy_version:
          typeof report.policyVersion === 'string'
            ? report.policyVersion
            : 'siteforge-remote-certification-v1',
        environment: 'staging',
        status: report.passed === true ? 'passed' : 'failed',
        report: deployment.certification_report,
        evidence_manifest: {
          stagingDeploymentId: deployment.id,
          certifiedAt: deployment.certified_at,
          remoteManifestHash: deployment.remote_manifest_hash,
        },
        report_hash: reportHash,
      })
    if (evidenceError) throw new SiteForgeLaunchError('Failed to link certification evidence', 500)
  }

  const dedupeKey = `siteforge-launch:${release.id}:${release.artifact_content_hash}`
  let { data: job } = await client
    .from('shared_jobs')
    .select('id')
    .eq('org_id', release.org_id)
    .eq('domain', 'siteforge.launch')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (!job) {
    const { data: createdJob, error: jobError } = await client
      .from('shared_jobs')
      .insert({
        org_id: release.org_id,
        property_id: release.property_id,
        domain: 'siteforge.launch',
        subject_type: 'siteforge_launch_release',
        subject_id: release.id,
        lifecycle_status: 'queued',
        status_reason: 'manager_approval_required',
        dedupe_key: dedupeKey,
        payload: {
          releaseId: release.id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
        },
        max_attempts: 1,
      })
      .select('id')
      .single()
    if (jobError || !createdJob) throw new SiteForgeLaunchError('Failed to create launch approval job', 500)
    job = createdJob
  }
  let { data: action } = await client
    .from('shared_action_attempts')
    .select('id')
    .eq('job_id', job.id)
    .eq('action_type', 'siteforge.launch:promote_production')
    .maybeSingle()
  if (!action) {
    const { data: createdAction, error: actionError } = await client
      .from('shared_action_attempts')
      .insert({
        job_id: job.id,
        org_id: release.org_id,
        property_id: release.property_id,
        action_type: 'siteforge.launch:promote_production',
        lifecycle_status: 'queued',
        proposal_decision_status: 'proposed',
        execution_status: 'pending_approval',
        request_payload: {
          releaseId: release.id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
          rollbackArtifactId: release.rollback_artifact_id,
          rollbackContentHash: release.rollback_content_hash,
        },
        execution_payload: { releaseId: release.id },
        policy_reason: 'A manager must separately approve the exact production artifact and rollback identity.',
        confidence_score: 1,
        requested_by: input.requestedBy,
      })
      .select('id')
      .single()
    if (actionError || !createdAction) throw new SiteForgeLaunchError('Failed to create launch approval request', 500)
    action = createdAction
  }
  if (release.launch_action_attempt_id !== action.id) {
    const { data: linked, error: linkError } = await client
      .from('siteforge_launch_releases')
      .update({ launch_action_attempt_id: action.id })
      .eq('id', release.id)
      .eq('state_version', release.state_version)
      .select('*')
      .single()
    if (linkError || !linked) throw new SiteForgeLaunchError('Failed to link launch approval request', 500)
    release = linked
  }
  if (release.state === 'prepared') {
    release = await transition(
      release,
      'certified',
      'system',
      input.requestedBy,
      'Exact staging certification linked',
      { stagingDeploymentId: deployment.id, reportHash },
      input.requestId || null,
      client
    )
  }
  return release
}

export { transition as transitionLaunchRelease }
