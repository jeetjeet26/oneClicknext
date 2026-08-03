import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { recordSharedApprovalDecision } from '@/utils/services/shared-approvals'
import {
  CloudwaysProviderClient,
  CloudwaysUnsupportedOperationError,
} from '@/utils/siteforge/providers/cloudways-provider'
import {
  getLaunchRelease,
  SiteForgeLaunchError,
  transitionLaunchRelease,
} from './repository'

type ServiceClient = SupabaseClient<Database>

interface PromotionTokenPayload {
  releaseId: string
  artifactId: string
  contentHash: string
  expiresAt: string
  nonce: string
}

function promotionSecret(): string {
  const secret = process.env.SITEFORGE_PROMOTION_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new SiteForgeLaunchError(
      'SITEFORGE_PROMOTION_TOKEN_SECRET must contain at least 32 characters',
      503
    )
  }
  return secret
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function signManualPromotionToken(
  payload: Omit<PromotionTokenPayload, 'nonce'>,
  secret = promotionSecret()
): string {
  const encoded = Buffer.from(
    JSON.stringify({ ...payload, nonce: randomBytes(18).toString('base64url') })
  ).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyManualPromotionToken(
  token: string,
  expected: {
    releaseId: string
    artifactId: string
    contentHash: string
  },
  secret = promotionSecret()
): PromotionTokenPayload {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) {
    throw new SiteForgeLaunchError('Invalid promotion token', 401)
  }
  const actual = Buffer.from(signature)
  const calculated = Buffer.from(
    createHmac('sha256', secret).update(encoded).digest('base64url')
  )
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) {
    throw new SiteForgeLaunchError('Invalid promotion token', 401)
  }
  let payload: PromotionTokenPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new SiteForgeLaunchError('Invalid promotion token', 401)
  }
  if (
    payload.releaseId !== expected.releaseId ||
    payload.artifactId !== expected.artifactId ||
    payload.contentHash !== expected.contentHash ||
    !payload.nonce ||
    new Date(payload.expiresAt).getTime() <= Date.now()
  ) {
    throw new SiteForgeLaunchError('Promotion token is expired or has the wrong release identity', 401)
  }
  return payload
}

export async function approveLaunchRelease(
  input: {
    releaseId: string
    propertyId: string
    artifactId: string
    contentHash: string
    rollbackArtifactId: string
    rollbackContentHash: string
    rationale: string
    legalRightsSnapshot: Json
    expiresAt: string
    approvedBy: string
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  let release = await getLaunchRelease(input.releaseId, input.propertyId, client)
  if (
    release.artifact_id !== input.artifactId ||
    release.artifact_content_hash !== input.contentHash ||
    release.rollback_artifact_id !== input.rollbackArtifactId ||
    release.rollback_content_hash !== input.rollbackContentHash
  ) {
    throw new SiteForgeLaunchError('Approval does not match the exact launch and rollback identity', 409)
  }
  const legal =
    input.legalRightsSnapshot &&
    typeof input.legalRightsSnapshot === 'object' &&
    !Array.isArray(input.legalRightsSnapshot)
      ? input.legalRightsSnapshot
      : {}
  if (legal.confirmed !== true) {
    throw new SiteForgeLaunchError('Explicit legal and asset-rights confirmation is required', 400)
  }
  const expiresAt = new Date(input.expiresAt)
  const maximum = Date.now() + 24 * 60 * 60_000
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() ||
    expiresAt.getTime() > maximum
  ) {
    throw new SiteForgeLaunchError('Approval expiry must be within the next 24 hours', 400)
  }
  if (!input.rationale.trim()) {
    throw new SiteForgeLaunchError('Approval rationale is required', 400)
  }
  if (!release.launch_action_attempt_id) {
    throw new SiteForgeLaunchError('Launch approval request is missing', 409)
  }

  if (release.state === 'certified') {
    const decision = await recordSharedApprovalDecision(
      {
        propertyId: input.propertyId,
        actionAttemptId: release.launch_action_attempt_id,
        reviewerProfileId: input.approvedBy,
        decisionStatus: 'approved',
        decisionReason: input.rationale,
        decisionPayload: {
          releaseId: release.id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
          rollbackArtifactId: release.rollback_artifact_id,
          rollbackContentHash: release.rollback_content_hash,
          legalRightsSnapshot: legal,
          expiresAt: expiresAt.toISOString(),
        },
        policyDecision: {
          policyName: 'siteforge-production-launch',
          policyVersion: 'v1',
          confidenceScore: 1,
        },
      },
      client
    )
    const now = new Date().toISOString()
    const { data: approved, error } = await client
      .from('siteforge_launch_releases')
      .update({
        launch_approval_id: decision.approval.id,
        approval_expires_at: expiresAt.toISOString(),
        legal_rights_snapshot: legal,
        approval_rationale: input.rationale.trim(),
        approved_by: input.approvedBy,
        approved_at: now,
      })
      .eq('id', release.id)
      .eq('state_version', release.state_version)
      .select('*')
      .single()
    if (error || !approved) throw new SiteForgeLaunchError('Failed to persist launch approval', 500)
    release = await transitionLaunchRelease(
      approved,
      'launch_approved',
      'operator',
      input.approvedBy,
      input.rationale,
      {
        approvalId: decision.approval.id,
        artifactId: release.artifact_id,
        contentHash: release.artifact_content_hash,
        rollbackArtifactId: release.rollback_artifact_id,
        rollbackContentHash: release.rollback_content_hash,
        approvalExpiresAt: expiresAt.toISOString(),
      },
      input.requestId || null,
      client
    )
  } else if (release.state !== 'launch_approved') {
    throw new SiteForgeLaunchError(`Release cannot be approved from ${release.state}`, 409)
  }

  const token = signManualPromotionToken({
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    expiresAt: expiresAt.toISOString(),
  })
  const { data: tokenized, error: tokenError } = await client
    .from('siteforge_launch_releases')
    .update({
      promotion_token_hash: tokenHash(token),
      promotion_token_expires_at: expiresAt.toISOString(),
      promotion_token_consumed_at: null,
    })
    .eq('id', release.id)
    .eq('state_version', release.state_version)
    .select('*')
    .single()
  if (tokenError || !tokenized) throw new SiteForgeLaunchError('Failed to issue promotion token', 500)
  return { release: tokenized, promotionToken: token }
}

async function loadCloudwaysTargets(releaseId: string, client: ServiceClient) {
  const release = await client
    .from('siteforge_launch_releases')
    .select('website_id')
    .eq('id', releaseId)
    .single()
  if (!release.data) throw new SiteForgeLaunchError('Launch release not found', 404)
  const { data: targets, error } = await client
    .from('siteforge_wordpress_targets')
    .select('target_type, provider, provider_application_id, provider_parent_application_id, provider_server_id')
    .eq('website_id', release.data.website_id)
    .eq('is_active', true)
    .in('target_type', ['staging', 'production'])
  if (error) throw new SiteForgeLaunchError('Failed to load Cloudways launch targets', 500)
  const staging = targets?.find(target => target.target_type === 'staging')
  const production = targets?.find(target => target.target_type === 'production')
  const productionApplicationId =
    production?.provider_application_id || staging?.provider_parent_application_id
  const serverId = production?.provider_server_id || staging?.provider_server_id
  if (
    staging?.provider !== 'cloudways' ||
    !staging.provider_application_id ||
    !productionApplicationId ||
    !serverId
  ) {
    throw new SiteForgeLaunchError('Complete Cloudways staging and production identities are required', 409)
  }
  return {
    serverId,
    stagingApplicationId: staging.provider_application_id,
    productionApplicationId,
  }
}

function cloudwaysClient(): CloudwaysProviderClient {
  if (!process.env.CLOUDWAYS_API_KEY || !process.env.CLOUDWAYS_EMAIL) {
    throw new SiteForgeLaunchError('Cloudways API credentials are required', 503)
  }
  return new CloudwaysProviderClient({
    apiKey: process.env.CLOUDWAYS_API_KEY,
    email: process.env.CLOUDWAYS_EMAIL,
  })
}

async function consumePromotionToken(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  token: string,
  client: ServiceClient
) {
  verifyManualPromotionToken(token, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
  })
  if (
    !release.promotion_token_hash ||
    release.promotion_token_consumed_at ||
    tokenHash(token) !== release.promotion_token_hash ||
    !release.promotion_token_expires_at ||
    new Date(release.promotion_token_expires_at).getTime() <= Date.now()
  ) {
    throw new SiteForgeLaunchError('Promotion token is expired or already consumed', 409)
  }
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('siteforge_launch_releases')
    .update({ promotion_token_consumed_at: now })
    .eq('id', release.id)
    .eq('promotion_token_hash', release.promotion_token_hash)
    .is('promotion_token_consumed_at', null)
    .select('*')
    .maybeSingle()
  if (error || !data) throw new SiteForgeLaunchError('Promotion token was already consumed', 409)
  return data
}

export async function promoteLaunchRelease(
  input: {
    releaseId: string
    propertyId: string
    promotionToken: string
    actorId: string
    manualConfirmation?: { operationId: string }
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  let release = await getLaunchRelease(input.releaseId, input.propertyId, client)
  verifyManualPromotionToken(input.promotionToken, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
  })
  if (
    !release.approval_expires_at ||
    new Date(release.approval_expires_at).getTime() <= Date.now()
  ) {
    throw new SiteForgeLaunchError('Launch approval has expired', 409)
  }
  const targets = await loadCloudwaysTargets(release.id, client)
  const cloudways = cloudwaysClient()

  if (release.state === 'launch_approved') {
    const backup = await cloudways.createApplicationBackup(targets.productionApplicationId)
    const backupIdentity = backup.backupId || backup.operationId
    if (!backupIdentity) {
      throw new SiteForgeLaunchError('Cloudways did not return a durable backup identity', 502)
    }
    const { data: checkpointed, error } = await client
      .from('siteforge_launch_releases')
      .update({
        backup_provider: 'cloudways',
        backup_id: backupIdentity,
        backup_operation_id: backup.operationId,
      })
      .eq('id', release.id)
      .eq('state_version', release.state_version)
      .select('*')
      .single()
    if (error || !checkpointed) throw new SiteForgeLaunchError('Failed to checkpoint Cloudways backup', 500)
    if (backup.operationId) await cloudways.waitForOperation(backup.operationId)
    const now = new Date().toISOString()
    const { data: backedUp, error: backupUpdateError } = await client
      .from('siteforge_launch_releases')
      .update({ backed_up_at: now })
      .eq('id', checkpointed.id)
      .eq('state_version', checkpointed.state_version)
      .select('*')
      .single()
    if (backupUpdateError || !backedUp) throw new SiteForgeLaunchError('Failed to record completed backup', 500)
    release = await transitionLaunchRelease(
      backedUp,
      'backed_up',
      'provider',
      input.actorId,
      'Production backup completed before promotion',
      { backupId: backupIdentity, operationId: backup.operationId },
      input.requestId || null,
      client
    )
  }
  if (release.state !== 'backed_up') {
    throw new SiteForgeLaunchError(`Release cannot be promoted from ${release.state}`, 409)
  }

  let operationId: string
  if (input.manualConfirmation) {
    operationId = input.manualConfirmation.operationId
  } else {
    try {
      const promotion = await cloudways.promoteStagingApplication(targets)
      operationId = promotion.operationId || `cloudways-sync-${Date.now()}`
      if (promotion.operationId) await cloudways.waitForOperation(promotion.operationId)
    } catch (error) {
      if (error instanceof CloudwaysUnsupportedOperationError) {
        return {
          release,
          manualRequired: true as const,
          dashboardAction: 'Push the approved staging application to live in Cloudways, then resubmit this token with manualConfirmation.operationId.',
        }
      }
      throw error
    }
  }

  release = await consumePromotionToken(release, input.promotionToken, client)
  const promotedAt = new Date().toISOString()
  const { data: promoted, error: promotedError } = await client
    .from('siteforge_launch_releases')
    .update({
      promotion_provider: input.manualConfirmation ? 'cloudways-manual' : 'cloudways',
      promotion_operation_id: operationId,
      promoted_at: promotedAt,
    })
    .eq('id', release.id)
    .eq('state_version', release.state_version)
    .select('*')
    .single()
  if (promotedError || !promoted) throw new SiteForgeLaunchError('Failed to record production promotion', 500)
  release = await transitionLaunchRelease(
    promoted,
    'promoted',
    input.manualConfirmation ? 'operator' : 'provider',
    input.actorId,
    input.manualConfirmation ? 'Operator confirmed Cloudways promotion' : 'Cloudways promotion completed',
    { operationId, manual: Boolean(input.manualConfirmation) },
    input.requestId || null,
    client
  )
  return { release, manualRequired: false as const }
}

export async function restoreLaunchRelease(
  input: {
    releaseId: string
    propertyId: string
    rationale: string
    actorId: string
    manualConfirmation?: { operationId: string }
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  let release = await getLaunchRelease(input.releaseId, input.propertyId, client)
  if (!['promoted', 'production_certified', 'live', 'failed'].includes(release.state)) {
    throw new SiteForgeLaunchError(`Release cannot be restored from ${release.state}`, 409)
  }
  if (!release.backup_id || !release.rollback_artifact_id || !release.rollback_content_hash) {
    throw new SiteForgeLaunchError('Release does not have a complete rollback identity', 409)
  }
  if (!input.rationale.trim()) throw new SiteForgeLaunchError('Restore rationale is required', 400)
  const targets = await loadCloudwaysTargets(release.id, client)
  let operationId: string
  if (input.manualConfirmation) {
    operationId = input.manualConfirmation.operationId
  } else {
    try {
      const cloudways = cloudwaysClient()
      const restore = await cloudways.restoreApplicationBackup({
        applicationId: targets.productionApplicationId,
        backupId: release.backup_id,
      })
      operationId = restore.operationId || `cloudways-restore-sync-${Date.now()}`
      if (restore.operationId) await cloudways.waitForOperation(restore.operationId)
    } catch (error) {
      if (error instanceof CloudwaysUnsupportedOperationError) {
        return {
          release,
          manualRequired: true as const,
          dashboardAction: 'Restore the recorded backup in Cloudways, then resubmit with manualConfirmation.operationId.',
        }
      }
      throw error
    }
  }
  release = await transitionLaunchRelease(
    release,
    'rolled_back',
    input.manualConfirmation ? 'operator' : 'provider',
    input.actorId,
    input.rationale,
    {
      backupId: release.backup_id,
      operationId,
      rollbackArtifactId: release.rollback_artifact_id,
      rollbackContentHash: release.rollback_content_hash,
      manual: Boolean(input.manualConfirmation),
    },
    input.requestId || null,
    client
  )
  const { error: websiteError } = await client
    .from('property_websites')
    .update({
      production_artifact_id: release.rollback_artifact_id,
      production_content_hash: release.rollback_content_hash,
      externally_promoted_artifact_id: release.rollback_artifact_id,
      deployed_content_hash: release.rollback_content_hash,
      current_step: 'Production restored to recorded rollback artifact',
      updated_at: new Date().toISOString(),
    })
    .eq('id', release.website_id)
    .eq('production_artifact_id', release.artifact_id)
    .eq('production_content_hash', release.artifact_content_hash)
  if (websiteError) throw new SiteForgeLaunchError('Restore succeeded but website projection update failed', 500)
  return { release, manualRequired: false as const }
}
