import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export type LaunchRelease = Tables<'siteforge_launch_releases'>
type ServiceClient = SupabaseClient<Database>

const SHA256_HASH = /^[a-f0-9]{64}$/

export class SiteForgeLaunchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeLaunchError'
  }
}

export function isLaunchChatbotContextReady(input: {
  lumaEnabled: boolean
  context: {
    status: string
    requires_review: boolean
    context_markdown: string
  } | null
}): boolean {
  if (!input.lumaEnabled) return true
  return Boolean(
    input.context?.status === 'current' &&
    !input.context.requires_review &&
    input.context.context_markdown.trim()
  )
}

export function assertObservedRollbackIdentity(input: {
  requestedArtifactId: string
  requestedContentHash: string
  productionArtifactId: string | null
  productionContentHash: string | null
  productionCertifiedAt: string | null
  productionTargetId: string | null
  certifiedDeployment: {
    artifact_id: string
    artifact_content_hash: string
    remote_manifest_hash: string | null
    certified_at: string | null
  } | null
}): void {
  if (
    !input.productionArtifactId ||
    !input.productionContentHash ||
    !input.productionCertifiedAt ||
    !input.productionTargetId ||
    input.requestedArtifactId !== input.productionArtifactId ||
    input.requestedContentHash !== input.productionContentHash
  ) {
    throw new SiteForgeLaunchError(
      'Rollback identity must match the observed certified pre-promotion production artifact',
      409
    )
  }
  const deployment = input.certifiedDeployment
  if (
    !deployment ||
    !deployment.certified_at ||
    deployment.artifact_id !== input.productionArtifactId ||
    deployment.artifact_content_hash !== input.productionContentHash ||
    deployment.remote_manifest_hash !== input.productionContentHash
  ) {
    throw new SiteForgeLaunchError(
      'Rollback is unavailable without an observed certified production manifest',
      409
    )
  }
}

export function classifyRolloutAuditCandidate(input: {
  contentHash: string
  canonicalHash: string
  assetManifestHash: string | null
  baseThemePackageSha256: string | null
}): { classification: 'deployable' | 'quarantined'; reasonCodes: string[] } {
  const reasonCodes: string[] = []
  if (input.canonicalHash !== input.contentHash) {
    reasonCodes.push('content_hash_mismatch')
  }
  if (
    !SHA256_HASH.test(input.assetManifestHash || '') ||
    !SHA256_HASH.test(input.baseThemePackageSha256 || '')
  ) {
    reasonCodes.push('incomplete_release_identity')
  }
  return {
    classification: reasonCodes.length ? 'quarantined' : 'deployable',
    reasonCodes,
  }
}

export function resolveLaunchRollbackMode(input: {
  rollbackArtifactId: string | null
  rollbackContentHash: string | null
  productionArtifactId: string | null
  productionContentHash: string | null
  productionCertifiedAt: string | null
}): { bootstrapLaunch: boolean } {
  const bootstrapLaunch =
    !input.rollbackArtifactId && !input.rollbackContentHash
  if (
    !bootstrapLaunch &&
    (!input.rollbackArtifactId || !input.rollbackContentHash)
  ) {
    throw new SiteForgeLaunchError(
      'Exact rollback artifact identity is required',
      409
    )
  }
  if (
    bootstrapLaunch &&
    (input.productionArtifactId ||
      input.productionContentHash ||
      input.productionCertifiedAt)
  ) {
    throw new SiteForgeLaunchError(
      'A certified production rollback identity is required to update a live website',
      409
    )
  }
  return { bootstrapLaunch }
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
  const { data, error } = await client.rpc(
    'transition_siteforge_launch_release',
    {
      p_release_id: release.id,
      p_expected_state_version: release.state_version,
      p_to_state: toState,
      p_actor_type: actorType,
      p_actor_id: actorId,
      p_rationale: rationale || '',
      p_evidence: evidence,
      p_request_id: requestId || '',
    }
  )
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
  if (error || !data)
    throw new SiteForgeLaunchError('Launch release not found', 404)
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
    : query
        .eq('website_id', input.websiteId || '')
        .order('release_version', { ascending: false })
  const { data: release, error } = await query.limit(1).maybeSingle()
  if (error || !release)
    throw new SiteForgeLaunchError('Launch release not found', 404)

  const { data: events, error: eventsError } = await client
    .from('siteforge_launch_events')
    .select('*')
    .eq('release_id', release.id)
    .order('created_at', { ascending: true })
  if (eventsError)
    throw new SiteForgeLaunchError('Failed to load launch history', 500)

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
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
    requestedBy: string
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select(
      'id, org_id, property_id, current_artifact_version_id, staging_artifact_id, staging_content_hash, staging_certified_at, staging_target_id, production_artifact_id, production_content_hash, production_certified_at, production_target_id'
    )
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (websiteError || !website)
    throw new SiteForgeLaunchError('Website not found', 404)
  if (
    website.current_artifact_version_id !== input.artifactId ||
    website.staging_artifact_id !== input.artifactId ||
    website.staging_content_hash !== input.contentHash ||
    !website.staging_certified_at
  ) {
    throw new SiteForgeLaunchError(
      'The exact current artifact must be verified on staging before launch preparation',
      409
    )
  }

  // First-launch bootstrap: a website that has never been certified on
  // production has no rollback artifact to point at. Allow preparing the
  // release without one; the pre-promotion Cloudways backup remains the
  // rollback path for a first launch. Updating a live website still requires
  // the exact certified production rollback identity.
  const { bootstrapLaunch } = resolveLaunchRollbackMode({
    rollbackArtifactId: input.rollbackArtifactId,
    rollbackContentHash: input.rollbackContentHash,
    productionArtifactId: website.production_artifact_id,
    productionContentHash: website.production_content_hash,
    productionCertifiedAt: website.production_certified_at,
  })

  const [
    { data: artifact },
    { data: audit },
    { data: lumaConfig, error: lumaConfigError },
    { data: chatbotContext, error: chatbotContextError },
  ] = await Promise.all([
    client
      .from('siteforge_blueprint_versions')
      .select(
        'id, content_hash, asset_manifest_hash, base_theme_package_sha256, deployment_decision, confirmed_approval_id'
      )
      .eq('id', input.artifactId)
      .eq('website_id', input.websiteId)
      .single(),
    client
      .from('siteforge_rollout_audits')
      .select('classification, canonical_content_hash')
      .eq('website_id', input.websiteId)
      .eq('artifact_id', input.artifactId)
      .single(),
    client
      .from('lumaleasing_config')
      .select('is_active')
      .eq('property_id', input.propertyId)
      .maybeSingle(),
    client
      .from('property_chatbot_contexts')
      .select('status, requires_review, context_markdown')
      .eq('property_id', input.propertyId)
      .maybeSingle(),
  ])
  if (lumaConfigError || chatbotContextError) {
    throw new SiteForgeLaunchError(
      'Failed to verify LumaLeasing launch readiness',
      500
    )
  }
  if (
    !isLaunchChatbotContextReady({
      lumaEnabled: Boolean(lumaConfig?.is_active),
      context: chatbotContext,
    })
  ) {
    throw new SiteForgeLaunchError(
      'Generate and approve the current property chatbot context before launching a LumaLeasing-enabled site',
      409
    )
  }
  // Artifacts created after the one-time rollout-audit backfill migration have
  // no audit row yet. Audit them here on first launch preparation with the
  // same fail-closed criteria the backfill used (canonical content-hash
  // integrity plus a complete release identity), so fresh artifacts stay
  // launchable without weakening the deployable gate.
  let rolloutClassification: string | null = audit?.classification ?? null
  if (!audit && artifact) {
    const { data: blueprintRow } = await client
      .from('siteforge_blueprint_versions')
      .select('blueprint')
      .eq('id', artifact.id)
      .eq('website_id', input.websiteId)
      .single()
    if (blueprintRow) {
      const canonicalHash = hashSiteForgeContent(blueprintRow.blueprint)
      const verdict = classifyRolloutAuditCandidate({
        contentHash: artifact.content_hash,
        canonicalHash,
        assetManifestHash: artifact.asset_manifest_hash,
        baseThemePackageSha256: artifact.base_theme_package_sha256,
      })
      const { error: auditInsertError } = await client
        .from('siteforge_rollout_audits')
        .upsert(
          {
            org_id: website.org_id,
            property_id: website.property_id,
            website_id: input.websiteId,
            artifact_id: artifact.id,
            original_content_hash: artifact.content_hash,
            canonical_content_hash: canonicalHash,
            classification: verdict.classification,
            reason_codes: verdict.reasonCodes as unknown as Json,
          },
          { onConflict: 'website_id,artifact_id', ignoreDuplicates: true }
        )
      if (auditInsertError) {
        throw new SiteForgeLaunchError(
          'Failed to record the launch rollout audit',
          500
        )
      }
      rolloutClassification = verdict.classification
    }
  }
  if (
    !artifact ||
    artifact.content_hash !== input.contentHash ||
    artifact.deployment_decision !== 'approved' ||
    !artifact.confirmed_approval_id ||
    !artifact.asset_manifest_hash ||
    !artifact.base_theme_package_sha256 ||
    rolloutClassification !== 'deployable'
  ) {
    throw new SiteForgeLaunchError(
      'The exact artifact is not approved and deployable',
      409
    )
  }
  let rollbackArtifact: { id: string; content_hash: string } | null = null
  if (!bootstrapLaunch) {
    const { data: rollbackArtifactRow } = await client
      .from('siteforge_blueprint_versions')
      .select('id, content_hash')
      .eq('id', input.rollbackArtifactId!)
      .eq('website_id', input.websiteId)
      .single()
    if (
      !rollbackArtifactRow ||
      rollbackArtifactRow.content_hash !== input.rollbackContentHash
    ) {
      throw new SiteForgeLaunchError(
        'Exact rollback artifact identity is required',
        409
      )
    }
    rollbackArtifact = rollbackArtifactRow

    const {
      data: certifiedRollbackDeployment,
      error: rollbackDeploymentError,
    } = await client
      .from('siteforge_artifact_deployments')
      .select(
        'artifact_id, artifact_content_hash, remote_manifest_hash, certified_at'
      )
      .eq('website_id', input.websiteId)
      .eq('target_id', website.production_target_id || '')
      .eq('artifact_id', input.rollbackArtifactId!)
      .eq('artifact_content_hash', input.rollbackContentHash!)
      .eq('status', 'live')
      .not('certified_at', 'is', null)
      .order('certified_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (rollbackDeploymentError) {
      throw new SiteForgeLaunchError(
        `Failed to verify pre-promotion production manifest: ${rollbackDeploymentError.message}`,
        500
      )
    }
    assertObservedRollbackIdentity({
      requestedArtifactId: input.rollbackArtifactId!,
      requestedContentHash: input.rollbackContentHash!,
      productionArtifactId: website.production_artifact_id,
      productionContentHash: website.production_content_hash,
      productionCertifiedAt: website.production_certified_at,
      productionTargetId: website.production_target_id,
      certifiedDeployment: certifiedRollbackDeployment,
    })
  }

  const { data: deployment, error: deploymentError } = await client
    .from('siteforge_artifact_deployments')
    .select(
      'id, certification_report, certified_at, artifact_content_hash, remote_manifest_hash'
    )
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
    throw new SiteForgeLaunchError(
      'Matching staging manifest evidence was not found',
      409
    )
  }

  const { data: existing } = await client
    .from('siteforge_launch_releases')
    .select('*')
    .eq('website_id', input.websiteId)
    .not('state', 'in', '(live,failed,rolled_back)')
    .maybeSingle()
  let release = existing
  if (
    release &&
    (release.artifact_id !== input.artifactId ||
      release.artifact_content_hash !== input.contentHash)
  ) {
    throw new SiteForgeLaunchError(
      'Another launch release is already active',
      409
    )
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
        rollback_artifact_id: rollbackArtifact?.id ?? null,
        rollback_content_hash: rollbackArtifact?.content_hash ?? null,
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
    if (jobError || !createdJob)
      throw new SiteForgeLaunchError(
        'Failed to create launch approval job',
        500
      )
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
        policy_reason: release.rollback_artifact_id
          ? 'A manager must separately approve the exact production artifact and rollback identity.'
          : 'First launch: no certified production rollback artifact exists. A manager must approve the exact production artifact and explicitly acknowledge that rollback relies on the pre-promotion Cloudways backup.',
        confidence_score: 1,
        requested_by: input.requestedBy,
      })
      .select('id')
      .single()
    if (actionError || !createdAction)
      throw new SiteForgeLaunchError(
        'Failed to create launch approval request',
        500
      )
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
    if (linkError || !linked)
      throw new SiteForgeLaunchError(
        'Failed to link launch approval request',
        500
      )
    release = linked
  }
  if (release.state === 'prepared') {
    release = await transition(
      release,
      'certified',
      'system',
      input.requestedBy,
      'Exact staging manifest identity verified',
      {
        stagingDeploymentId: deployment.id,
        remoteManifestHash: deployment.remote_manifest_hash,
      },
      input.requestId || null,
      client
    )
  }
  return release
}

export { transition as transitionLaunchRelease }
