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
import { CloudwaysProviderClient } from '@/utils/siteforge/providers/cloudways-provider'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { WordPressAPIClient } from '@/utils/siteforge/wordpress-client'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
} from '@/utils/siteforge/quality/deterministic-gates'
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
    JSON.stringify({
      ...payload,
      nonce: randomBytes(18).toString('base64url'),
    })
  ).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url')
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
  if (
    actual.length !== calculated.length ||
    !timingSafeEqual(actual, calculated)
  ) {
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
    throw new SiteForgeLaunchError(
      'Promotion token is expired or has the wrong release identity',
      401
    )
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
  let release = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  if (
    release.artifact_id !== input.artifactId ||
    release.artifact_content_hash !== input.contentHash ||
    release.rollback_artifact_id !== input.rollbackArtifactId ||
    release.rollback_content_hash !== input.rollbackContentHash
  ) {
    throw new SiteForgeLaunchError(
      'Approval does not match the exact launch and rollback identity',
      409
    )
  }
  const legal =
    input.legalRightsSnapshot &&
    typeof input.legalRightsSnapshot === 'object' &&
    !Array.isArray(input.legalRightsSnapshot)
      ? input.legalRightsSnapshot
      : {}
  if (legal.confirmed !== true) {
    throw new SiteForgeLaunchError(
      'Explicit legal and asset-rights confirmation is required',
      400
    )
  }
  const expiresAt = new Date(input.expiresAt)
  const maximum = Date.now() + 24 * 60 * 60_000
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() ||
    expiresAt.getTime() > maximum
  ) {
    throw new SiteForgeLaunchError(
      'Approval expiry must be within the next 24 hours',
      400
    )
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
    if (error || !approved)
      throw new SiteForgeLaunchError('Failed to persist launch approval', 500)
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
    throw new SiteForgeLaunchError(
      `Release cannot be approved from ${release.state}`,
      409
    )
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
  if (tokenError || !tokenized)
    throw new SiteForgeLaunchError('Failed to issue promotion token', 500)
  return { release: tokenized, promotionToken: token }
}

async function loadCloudwaysTargets(releaseId: string, client: ServiceClient) {
  const release = await client
    .from('siteforge_launch_releases')
    .select('website_id')
    .eq('id', releaseId)
    .single()
  if (!release.data)
    throw new SiteForgeLaunchError('Launch release not found', 404)
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select('wordpress_credential_ref')
    .eq('id', release.data.website_id)
    .single()
  if (websiteError || !website?.wordpress_credential_ref) {
    throw new SiteForgeLaunchError(
      'Production WordPress credential identity is required',
      409
    )
  }
  const parentCredentials = await getWordPressCredentialReference(
    website.wordpress_credential_ref
  )
  const { data: targets, error } = await client
    .from('siteforge_wordpress_targets')
    .select(
      'id, target_type, provider, provider_application_id, provider_parent_application_id, provider_server_id, credential_ref, site_url'
    )
    .eq('website_id', release.data.website_id)
    .eq('is_active', true)
    .in('target_type', ['staging', 'production'])
  if (error)
    throw new SiteForgeLaunchError(
      'Failed to load Cloudways launch targets',
      500
    )
  const staging = targets?.find((target) => target.target_type === 'staging')
  const production = targets?.find(
    (target) => target.target_type === 'production'
  )
  const productionApplicationId =
    production?.provider_application_id ||
    parentCredentials.providerMetadata?.applicationId ||
    null
  const productionServerId =
    production?.provider_server_id ||
    parentCredentials.providerMetadata?.serverId ||
    null
  if (
    staging?.provider !== 'cloudways' ||
    parentCredentials.provider !== 'cloudways' ||
    !parentCredentials.providerMetadata ||
    (production && production.provider !== 'cloudways') ||
    !staging.provider_application_id ||
    !staging.provider_parent_application_id ||
    !staging.provider_server_id ||
    !productionApplicationId ||
    !productionServerId ||
    productionApplicationId !== staging.provider_parent_application_id ||
    productionServerId !== staging.provider_server_id ||
    parentCredentials.providerMetadata.applicationId !==
      staging.provider_parent_application_id ||
    parentCredentials.providerMetadata.serverId !== staging.provider_server_id
  ) {
    throw new SiteForgeLaunchError(
      'Exact Cloudways parent/child application and server ownership is required',
      409
    )
  }
  return {
    serverId: productionServerId,
    stagingApplicationId: staging.provider_application_id,
    productionApplicationId,
    productionTargetId: production?.id || null,
    productionCredentialRef:
      production?.credential_ref || website.wordpress_credential_ref,
    productionUrl: production?.site_url || parentCredentials.url,
  }
}

function cloudwaysClient(): CloudwaysProviderClient {
  if (!process.env.CLOUDWAYS_API_KEY || !process.env.CLOUDWAYS_EMAIL) {
    throw new SiteForgeLaunchError(
      'Cloudways API credentials are required',
      503
    )
  }
  return new CloudwaysProviderClient({
    apiKey: process.env.CLOUDWAYS_API_KEY,
    email: process.env.CLOUDWAYS_EMAIL,
  })
}

export function assertPromotedManifestIdentity(
  expectedContentHash: string,
  remoteContentHash: string | null
): void {
  if (remoteContentHash !== expectedContentHash) {
    throw new SiteForgeLaunchError(
      'Promoted WordPress manifest does not match the approved artifact',
      409
    )
  }
}

async function finalizePromotedRelease(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  targets: Awaited<ReturnType<typeof loadCloudwaysTargets>>,
  actorId: string,
  requestId: string | null,
  client: ServiceClient
) {
  if (release.state === 'live') return release
  if (release.state !== 'promoted') {
    throw new SiteForgeLaunchError(
      `Production manifest cannot be finalized from ${release.state}`,
      409
    )
  }
  if (!targets.productionCredentialRef || !targets.productionUrl) {
    throw new SiteForgeLaunchError(
      'Production credentials and URL are required to verify promotion',
      409
    )
  }
  const credentials = await getWordPressCredentialReference(
    targets.productionCredentialRef
  )
  const manifest = await new WordPressAPIClient(targets.productionUrl, {
    username: credentials.username,
    password: credentials.password,
  }).getContentManifest()
  assertPromotedManifestIdentity(
    release.artifact_content_hash,
    manifest.content_hash
  )

  let productionTargetId = targets.productionTargetId
  if (!productionTargetId) {
    const { data: target, error } = await client
      .from('siteforge_wordpress_targets')
      .insert({
        org_id: release.org_id,
        property_id: release.property_id,
        website_id: release.website_id,
        target_type: 'production',
        provider: 'cloudways',
        provider_application_id: targets.productionApplicationId,
        provider_server_id: targets.serverId,
        credential_ref: targets.productionCredentialRef,
        site_url: targets.productionUrl,
        admin_url: `${targets.productionUrl.replace(/\/+$/, '')}/wp-admin`,
        protection_mode: 'public',
        status: 'ready',
        is_active: true,
      })
      .select('id')
      .single()
    if (error || !target) {
      throw new SiteForgeLaunchError(
        `Failed to record production target: ${error?.message || 'missing row'}`,
        500
      )
    }
    productionTargetId = target.id
  }

  const { data: artifact, error: artifactError } = await client
    .from('siteforge_blueprint_versions')
    .select(
      'asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, runtime_contract_version, runtime_package_sha256'
    )
    .eq('id', release.artifact_id)
    .eq('website_id', release.website_id)
    .single()
  if (
    artifactError ||
    !artifact?.asset_manifest_hash ||
    !artifact.base_theme_package_sha256
  ) {
    throw new SiteForgeLaunchError(
      'Approved production artifact has an incomplete immutable identity',
      409
    )
  }

  const completedAt = new Date().toISOString()
  const integrityReport = {
    policyVersion: 'siteforge-production-integrity-v1',
    passed: true,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    remoteManifestHash: manifest.content_hash,
    verifiedAt: completedAt,
  } as Json
  const { error: deploymentError } = await client
    .from('siteforge_artifact_deployments')
    .upsert(
      {
        org_id: release.org_id,
        property_id: release.property_id,
        website_id: release.website_id,
        target_id: productionTargetId,
        artifact_id: release.artifact_id,
        artifact_content_hash: release.artifact_content_hash,
        asset_manifest_hash: artifact.asset_manifest_hash,
        base_theme_package_sha256: artifact.base_theme_package_sha256,
        overlay_package_sha256: artifact.overlay_package_sha256,
        runtime_contract_version: artifact.runtime_contract_version,
        runtime_package_sha256: artifact.runtime_package_sha256,
        runtime_manifest_sha256: null,
        approval_id: release.launch_approval_id,
        status: 'live',
        certification_report: integrityReport,
        remote_manifest_hash: release.artifact_content_hash,
        final_verified_content_hash: release.artifact_content_hash,
        deployed_url: targets.productionUrl,
        deployed_at: completedAt,
        certified_at: completedAt,
        externally_promoted_at: release.promoted_at || completedAt,
      },
      { onConflict: 'target_id,artifact_id' }
    )
  if (deploymentError) {
    throw new SiteForgeLaunchError(
      `Failed to record promoted artifact identity: ${deploymentError.message}`,
      500
    )
  }

  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .update({
      editor_lifecycle_status: 'production_live',
      production_target_id: productionTargetId,
      production_artifact_id: release.artifact_id,
      production_content_hash: release.artifact_content_hash,
      production_url: targets.productionUrl,
      production_certified_at: completedAt,
      production_certification_report: integrityReport,
      externally_promoted_artifact_id: release.artifact_id,
      externally_promoted_at: release.promoted_at || completedAt,
      deployed_artifact_version_id: release.artifact_id,
      deployed_content_hash: release.artifact_content_hash,
      deployed_at: completedAt,
      wp_url: targets.productionUrl,
      current_step: 'Production artifact live; optional browser QA available',
      error_message: null,
      updated_at: completedAt,
    })
    .eq('id', release.website_id)
    .eq('staging_artifact_id', release.artifact_id)
    .select('id')
    .maybeSingle()
  if (websiteError || !website) {
    throw new SiteForgeLaunchError(
      `Failed to project promoted production identity: ${
        websiteError?.message || 'staging identity changed'
      }`,
      409
    )
  }

  const { data: checkpointed, error: checkpointError } = await client
    .from('siteforge_launch_releases')
    .update({
      production_certification_report: integrityReport,
      production_certified_at: completedAt,
    })
    .eq('id', release.id)
    .eq('state', 'promoted')
    .eq('state_version', release.state_version)
    .select('*')
    .single()
  if (checkpointError || !checkpointed) {
    throw new SiteForgeLaunchError(
      'Failed to checkpoint production manifest verification',
      500
    )
  }
  const certified = await transitionLaunchRelease(
    checkpointed,
    'production_certified',
    'system',
    actorId,
    'Exact promoted WordPress manifest verified',
    integrityReport,
    requestId,
    client
  )
  return transitionLaunchRelease(
    certified,
    'live',
    'system',
    actorId,
    'Cloudways promotion completed with exact WordPress manifest identity',
    integrityReport,
    requestId,
    client
  )
}

async function consumePromotionToken(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  token: string,
  client: ServiceClient,
  allowClaimedReconciliation = false
) {
  verifyManualPromotionToken(token, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
  })
  if (
    !release.promotion_token_hash ||
    tokenHash(token) !== release.promotion_token_hash ||
    !release.promotion_token_expires_at ||
    new Date(release.promotion_token_expires_at).getTime() <= Date.now()
  ) {
    throw new SiteForgeLaunchError(
      'Promotion token is expired or already consumed',
      409
    )
  }
  if (release.promotion_token_consumed_at) {
    if (allowClaimedReconciliation && release.promotion_operation_id) {
      return release
    }
    throw new SiteForgeLaunchError(
      'Promotion token is expired or already consumed',
      409
    )
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
  if (error || !data)
    throw new SiteForgeLaunchError('Promotion token was already consumed', 409)
  return data
}

export async function promoteLaunchRelease(
  input: {
    releaseId: string
    propertyId: string
    promotionToken: string
    actorId: string
    backupConfirmation?: { operationId: string; backupId: string }
    manualConfirmation?: { operationId: string }
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  let release = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  verifyManualPromotionToken(input.promotionToken, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
  })
  if (
    release.state !== 'promoted' &&
    (!release.approval_expires_at ||
      new Date(release.approval_expires_at).getTime() <= Date.now())
  ) {
    throw new SiteForgeLaunchError('Launch approval has expired', 409)
  }
  const targets = await loadCloudwaysTargets(release.id, client)
  const cloudways = cloudwaysClient()

  if (release.state === 'launch_approved') {
    if (!input.backupConfirmation) {
      return {
        release,
        manualRequired: true as const,
        requiredConfirmation: 'backup' as const,
        dashboardAction:
          'Create a production application backup in Cloudways, then resubmit the exact completed backup operation ID and backup ID. Automatic backup creation is disabled because the current schema cannot safely deduplicate a crash after the provider mutation.',
      }
    }
    await cloudways.verifyOperation(input.backupConfirmation.operationId, {
      kind: 'backup',
      serverId: targets.serverId,
      applicationId: targets.productionApplicationId,
      backupId: input.backupConfirmation.backupId,
    })
    if (
      release.backup_operation_id &&
      (release.backup_operation_id !== input.backupConfirmation.operationId ||
        release.backup_id !== input.backupConfirmation.backupId)
    ) {
      throw new SiteForgeLaunchError(
        'A different backup operation is already claimed for this release',
        409
      )
    }
    if (!release.backup_operation_id) {
      const { data: checkpointed, error } = await client
        .from('siteforge_launch_releases')
        .update({
          backup_provider: 'cloudways-manual',
          backup_id: input.backupConfirmation.backupId,
          backup_operation_id: input.backupConfirmation.operationId,
          backed_up_at: new Date().toISOString(),
        })
        .eq('id', release.id)
        .eq('state', 'launch_approved')
        .eq('state_version', release.state_version)
        .is('backup_operation_id', null)
        .select('*')
        .maybeSingle()
      if (error) {
        throw new SiteForgeLaunchError(
          `Failed to claim the verified Cloudways backup: ${error.message}`,
          500
        )
      }
      if (checkpointed) release = checkpointed
      else
        release = await getLaunchRelease(
          input.releaseId,
          input.propertyId,
          client
        )
    }
    if (
      release.state === 'launch_approved' &&
      release.backup_operation_id === input.backupConfirmation.operationId &&
      release.backup_id === input.backupConfirmation.backupId
    ) {
      release = await transitionLaunchRelease(
        release,
        'backed_up',
        'operator',
        input.actorId,
        'Verified exact pre-promotion production backup',
        {
          backupId: input.backupConfirmation.backupId,
          operationId: input.backupConfirmation.operationId,
          serverId: targets.serverId,
          applicationId: targets.productionApplicationId,
        },
        input.requestId || null,
        client
      )
    }
  }
  if (release.state === 'promoted') {
    if (
      !input.manualConfirmation ||
      release.promotion_operation_id !== input.manualConfirmation.operationId
    ) {
      throw new SiteForgeLaunchError(
        'Release is already promoted by a different or unconfirmed operation',
        409
      )
    }
    await cloudways.verifyOperation(input.manualConfirmation.operationId, {
      kind: 'promotion',
      serverId: targets.serverId,
      applicationId: targets.productionApplicationId,
      stagingApplicationId: targets.stagingApplicationId,
    })
    release = await finalizePromotedRelease(
      release,
      targets,
      input.actorId,
      input.requestId || null,
      client
    )
    return { release, manualRequired: false as const }
  }
  if (release.state !== 'backed_up') {
    throw new SiteForgeLaunchError(
      `Release cannot be promoted from ${release.state}`,
      409
    )
  }
  if (!input.manualConfirmation) {
    return {
      release,
      manualRequired: true as const,
      requiredConfirmation: 'promotion' as const,
      dashboardAction:
        'Push the exact staging child application to its recorded production parent in Cloudways, then resubmit the completed operation ID. Automatic promotion is disabled because the provider mutation cannot be made crash-idempotent with the current schema.',
    }
  }

  const operationId = input.manualConfirmation.operationId
  if (
    release.promotion_operation_id &&
    release.promotion_operation_id !== operationId
  ) {
    throw new SiteForgeLaunchError(
      'A different promotion operation is already claimed for this release',
      409
    )
  }
  if (!release.promotion_operation_id) {
    const { data: claimed, error: claimError } = await client
      .from('siteforge_launch_releases')
      .update({
        promotion_provider: 'cloudways-manual-pending-verification',
        promotion_operation_id: operationId,
      })
      .eq('id', release.id)
      .eq('state', 'backed_up')
      .eq('state_version', release.state_version)
      .is('promotion_operation_id', null)
      .select('*')
      .maybeSingle()
    if (claimError) {
      throw new SiteForgeLaunchError(
        `Failed to claim the promotion operation: ${claimError.message}`,
        500
      )
    }
    release =
      claimed ||
      (await getLaunchRelease(input.releaseId, input.propertyId, client))
  }
  if (release.promotion_operation_id !== operationId) {
    throw new SiteForgeLaunchError(
      'Promotion operation claim lost to another request',
      409
    )
  }

  await cloudways.verifyOperation(operationId, {
    kind: 'promotion',
    serverId: targets.serverId,
    applicationId: targets.productionApplicationId,
    stagingApplicationId: targets.stagingApplicationId,
  })

  release = await consumePromotionToken(
    release,
    input.promotionToken,
    client,
    true
  )
  const promotedAt = new Date().toISOString()
  const { data: promoted, error: promotedError } = await client
    .from('siteforge_launch_releases')
    .update({
      promotion_provider: 'cloudways-manual',
      promotion_operation_id: operationId,
      promoted_at: promotedAt,
    })
    .eq('id', release.id)
    .eq('state', 'backed_up')
    .eq('state_version', release.state_version)
    .eq('promotion_operation_id', operationId)
    .select('*')
    .maybeSingle()
  if (promotedError) {
    throw new SiteForgeLaunchError('Failed to record production promotion', 500)
  }
  if (!promoted) {
    const reconciled = await getLaunchRelease(
      input.releaseId,
      input.propertyId,
      client
    )
    if (
      reconciled.state === 'promoted' &&
      reconciled.promotion_operation_id === operationId
    ) {
      release = await finalizePromotedRelease(
        reconciled,
        targets,
        input.actorId,
        input.requestId || null,
        client
      )
      return { release, manualRequired: false as const }
    }
    throw new SiteForgeLaunchError(
      'Promotion claim changed before completion',
      409
    )
  }
  release = await transitionLaunchRelease(
    promoted,
    'promoted',
    'operator',
    input.actorId,
    'Operator confirmed exact Cloudways promotion ownership',
    {
      operationId,
      serverId: targets.serverId,
      productionApplicationId: targets.productionApplicationId,
      stagingApplicationId: targets.stagingApplicationId,
      manual: true,
    },
    input.requestId || null,
    client
  )
  release = await finalizePromotedRelease(
    release,
    targets,
    input.actorId,
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
  let release = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  if (
    ![
      'promoted',
      'production_certified',
      'live',
      'failed',
      'rolled_back',
    ].includes(release.state)
  ) {
    throw new SiteForgeLaunchError(
      `Release cannot be restored from ${release.state}`,
      409
    )
  }
  if (
    !release.backup_id ||
    !release.rollback_artifact_id ||
    !release.rollback_content_hash
  ) {
    throw new SiteForgeLaunchError(
      'Release does not have a complete rollback identity',
      409
    )
  }
  if (!input.rationale.trim())
    throw new SiteForgeLaunchError('Restore rationale is required', 400)
  if (!input.manualConfirmation) {
    return requestLaunchRestore(
      {
        releaseId: input.releaseId,
        propertyId: input.propertyId,
        rationale: input.rationale,
        actorId: input.actorId,
        requestId: input.requestId,
        source: 'manager_request',
      },
      client
    )
  }

  const targets = await loadCloudwaysTargets(release.id, client)
  let { data: drill, error: drillError } = await client
    .from('siteforge_restore_drills')
    .select('*')
    .eq('release_id', release.id)
    .in('status', ['queued', 'restoring', 'verifying'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (drillError) {
    throw new SiteForgeLaunchError(
      `Failed to load the awaiting-operator restore request: ${drillError.message}`,
      500
    )
  }
  if (!drill) {
    await requestLaunchRestore(
      {
        releaseId: input.releaseId,
        propertyId: input.propertyId,
        rationale: input.rationale,
        actorId: input.actorId,
        requestId: input.requestId,
        source: 'manager_request',
      },
      client
    )
    const loaded = await client
      .from('siteforge_restore_drills')
      .select('*')
      .eq('release_id', release.id)
      .in('status', ['queued', 'restoring', 'verifying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    drill = loaded.data
    drillError = loaded.error
  }
  if (drillError || !drill) {
    throw new SiteForgeLaunchError(
      'An awaiting-operator restore request is required before execution confirmation',
      409
    )
  }

  const operationId = input.manualConfirmation.operationId
  if (
    drill.provider_operation_id &&
    drill.provider_operation_id !== operationId
  ) {
    throw new SiteForgeLaunchError(
      'A different restore operation is already claimed for this request',
      409
    )
  }
  if (!drill.provider_operation_id) {
    const { data: claimed, error: claimError } = await client
      .from('siteforge_restore_drills')
      .update({
        status: 'verifying',
        provider_operation_id: operationId,
        started_at: drill.started_at || new Date().toISOString(),
      })
      .eq('id', drill.id)
      .in('status', ['queued', 'restoring', 'verifying'])
      .is('provider_operation_id', null)
      .select('*')
      .maybeSingle()
    if (claimError) {
      throw new SiteForgeLaunchError(
        `Failed to claim restore verification: ${claimError.message}`,
        500
      )
    }
    if (!claimed) {
      const reloaded = await client
        .from('siteforge_restore_drills')
        .select('*')
        .eq('id', drill.id)
        .single()
      drill = reloaded.data
    } else {
      drill = claimed
    }
  }
  if (!drill || drill.provider_operation_id !== operationId) {
    throw new SiteForgeLaunchError(
      'Restore operation claim changed concurrently',
      409
    )
  }

  await cloudwaysClient().verifyOperation(operationId, {
    kind: 'restore',
    serverId: targets.serverId,
    applicationId: targets.productionApplicationId,
    backupId: release.backup_id,
  })
  if (!targets.productionCredentialRef || !targets.productionUrl) {
    throw new SiteForgeLaunchError(
      'Production credentials and URL are required to verify the restored manifest',
      409
    )
  }
  const credentials = await getWordPressCredentialReference(
    targets.productionCredentialRef
  )
  const remoteManifest = await new WordPressAPIClient(targets.productionUrl, {
    username: credentials.username,
    password: credentials.password,
  }).getContentManifest()
  if (remoteManifest.content_hash !== release.rollback_content_hash) {
    throw new SiteForgeLaunchError(
      'Restored remote manifest does not match the certified rollback identity',
      409
    )
  }

  const { data: website, error: websiteLookupError } = await client
    .from('property_websites')
    .select('production_artifact_id, production_content_hash')
    .eq('id', release.website_id)
    .single()
  if (websiteLookupError || !website) {
    throw new SiteForgeLaunchError(
      'Restore website projection is unavailable',
      500
    )
  }
  const alreadyProjected =
    website.production_artifact_id === release.rollback_artifact_id &&
    website.production_content_hash === release.rollback_content_hash
  if (
    !alreadyProjected &&
    (website.production_artifact_id !== release.artifact_id ||
      website.production_content_hash !== release.artifact_content_hash)
  ) {
    throw new SiteForgeLaunchError(
      'Production projection changed after restore was requested',
      409
    )
  }
  const { data: projected, error: websiteError } = alreadyProjected
    ? { data: { id: release.website_id }, error: null }
    : await client
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
        .select('id')
        .maybeSingle()
  if (websiteError || !projected) {
    throw new SiteForgeLaunchError(
      'Verified restore could not update the website projection',
      500
    )
  }
  if (release.state !== 'rolled_back') {
    release = await transitionLaunchRelease(
      release,
      'rolled_back',
      'operator',
      input.actorId,
      input.rationale,
      {
        backupId: release.backup_id,
        operationId,
        rollbackArtifactId: release.rollback_artifact_id,
        rollbackContentHash: release.rollback_content_hash,
        remoteManifestHash: remoteManifest.content_hash,
        serverId: targets.serverId,
        applicationId: targets.productionApplicationId,
        manual: true,
      },
      input.requestId || null,
      client
    )
  }
  return { release, manualRequired: false as const }
}

export async function requestLaunchRestore(
  input: {
    releaseId: string
    propertyId: string
    rationale: string
    actorId: string
    requestId?: string
    source:
      | 'manager_request'
      | 'production_failure'
      | 'production_cancel'
      | 'production_health'
      | 'restore_drill'
      | 'stale_job'
  },
  client: ServiceClient = createServiceClient()
) {
  const release = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  if (
    !['promoted', 'production_certified', 'live', 'failed'].includes(
      release.state
    )
  ) {
    throw new SiteForgeLaunchError(
      `Release cannot request restore protection from ${release.state}`,
      409
    )
  }
  if (
    !release.backup_id ||
    !release.rollback_artifact_id ||
    !release.rollback_content_hash
  ) {
    throw new SiteForgeLaunchError(
      'Restore request requires the observed rollback artifact and backup identity',
      409
    )
  }

  let protectionApplied = false
  let protectionError: string | null = null
  try {
    await protectLaunchProduction(release, client)
    protectionApplied = true
  } catch (error) {
    protectionError = error instanceof Error ? error.message : String(error)
  }

  const now = new Date().toISOString()
  const incidentValues = {
    org_id: release.org_id,
    property_id: release.property_id,
    website_id: release.website_id,
    artifact_id: release.artifact_id,
    dedupe_key: `restore-request:${release.id}`,
    severity: 'critical',
    status: 'open',
    category: 'restore_required',
    title: 'SiteForge production restore requires an operator',
    summary: input.rationale.trim(),
    evidence: {
      releaseId: release.id,
      source: input.source,
      requestId: input.requestId || null,
      protectionApplied,
      protectionError,
      backupId: release.backup_id,
      rollbackArtifactId: release.rollback_artifact_id,
      rollbackContentHash: release.rollback_content_hash,
      executionRequiresOperator: true,
    } as Json,
    updated_at: now,
  }
  const { data: existingIncident, error: incidentLookupError } = await client
    .from('siteforge_incidents')
    .select('id')
    .eq('website_id', release.website_id)
    .eq('dedupe_key', incidentValues.dedupe_key)
    .neq('status', 'resolved')
    .maybeSingle()
  if (incidentLookupError) {
    throw new SiteForgeLaunchError(
      `Production was protected but the restore incident could not be loaded: ${incidentLookupError.message}`,
      500
    )
  }
  const incidentResult = existingIncident
    ? await client
        .from('siteforge_incidents')
        .update(incidentValues)
        .eq('id', existingIncident.id)
    : await client.from('siteforge_incidents').insert(incidentValues)
  if (incidentResult.error && incidentResult.error.code !== '23505') {
    throw new SiteForgeLaunchError(
      `Production was protected but the restore incident could not be persisted: ${incidentResult.error.message}`,
      500
    )
  }

  const dedupeKey = `siteforge-restore-request:${release.id}`
  let { data: job, error: jobLookupError } = await client
    .from('shared_jobs')
    .select('id, lifecycle_status')
    .eq('org_id', release.org_id)
    .eq('domain', 'siteforge.restore-request')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (jobLookupError) {
    throw new SiteForgeLaunchError(
      `Failed to load the durable restore request: ${jobLookupError.message}`,
      500
    )
  }
  if (!job) {
    const created = await client
      .from('shared_jobs')
      .insert({
        org_id: release.org_id,
        property_id: release.property_id,
        domain: 'siteforge.restore-request',
        subject_type: 'siteforge_launch_release',
        subject_id: release.id,
        lifecycle_status: 'queued',
        status_reason: 'awaiting_operator_restore',
        dedupe_key: dedupeKey,
        payload: {
          releaseId: release.id,
          websiteId: release.website_id,
          actorId: input.actorId,
          source: input.source,
        },
        max_attempts: 10,
      })
      .select('id, lifecycle_status')
      .maybeSingle()
    if (created.error && created.error.code !== '23505') {
      throw new SiteForgeLaunchError(
        `Failed to create the durable restore request: ${created.error.message}`,
        500
      )
    }
    job = created.data
    if (!job) {
      const concurrent = await client
        .from('shared_jobs')
        .select('id, lifecycle_status')
        .eq('org_id', release.org_id)
        .eq('domain', 'siteforge.restore-request')
        .eq('dedupe_key', dedupeKey)
        .single()
      job = concurrent.data
      jobLookupError = concurrent.error
    }
  }
  if (jobLookupError || !job) {
    throw new SiteForgeLaunchError(
      'Failed to reconcile the durable restore request',
      500
    )
  }

  const { data: existingDrill, error: drillLookupError } = await client
    .from('siteforge_restore_drills')
    .select('id')
    .eq('release_id', release.id)
    .in('status', ['queued', 'restoring', 'verifying'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (drillLookupError) {
    throw new SiteForgeLaunchError(
      `Failed to load the awaiting-operator restore request: ${drillLookupError.message}`,
      500
    )
  }
  if (!existingDrill) {
    const { data: claimed, error: claimError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        status_reason: 'creating_restore_request',
        heartbeat_at: now,
        started_at: now,
        updated_at: now,
      })
      .eq('id', job.id)
      .in('lifecycle_status', ['queued', 'retrying'])
      .select('id')
      .maybeSingle()
    if (claimError) {
      throw new SiteForgeLaunchError(
        `Failed to claim restore request creation: ${claimError.message}`,
        500
      )
    }
    if (claimed) {
      const { error: drillCreateError } = await client
        .from('siteforge_restore_drills')
        .insert({
          org_id: release.org_id,
          property_id: release.property_id,
          website_id: release.website_id,
          release_id: release.id,
          backup_id: release.backup_id,
          expected_artifact_id: release.rollback_artifact_id,
          expected_content_hash: release.rollback_content_hash,
          status: 'verifying',
          verification_report: {
            requestType: input.source,
            executionRequiresOperator: true,
            restoreCompleted: false,
            protectionApplied,
            protectionError,
            requestedAt: now,
          } as Json,
        })
      if (drillCreateError) {
        await client
          .from('shared_jobs')
          .update({
            lifecycle_status: 'retrying',
            status_reason: 'restore_request_persistence_failed',
            retry_at: now,
            available_at: now,
            error_message: drillCreateError.message,
            updated_at: now,
          })
          .eq('id', job.id)
          .eq('lifecycle_status', 'running')
        throw new SiteForgeLaunchError(
          `Failed to persist the awaiting-operator restore request: ${drillCreateError.message}`,
          500
        )
      }
      await client
        .from('shared_jobs')
        .update({
          lifecycle_status: 'succeeded',
          status_reason: 'awaiting_operator_restore',
          current_step: 'Restore request is awaiting an operator',
          progress: 100,
          finished_at: now,
          heartbeat_at: now,
          updated_at: now,
        })
        .eq('id', job.id)
        .eq('lifecycle_status', 'running')
    }
  }

  return {
    release,
    manualRequired: true as const,
    requiredConfirmation: 'restore' as const,
    dashboardAction:
      'Production is protected/noindex. A launch manager must restore the recorded backup in Cloudways and submit the exact completed operation ID.',
    protectionApplied,
    protectionError,
  }
}

async function protectLaunchProduction(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  client: ServiceClient
): Promise<void> {
  const targets = await loadCloudwaysTargets(release.id, client)
  if (!targets.productionCredentialRef || !targets.productionUrl) {
    throw new Error(
      'Production credentials and URL are unavailable for noindex protection'
    )
  }
  const { data: artifact, error } = await client
    .from('siteforge_blueprint_versions')
    .select('blueprint, runtime_contract_version')
    .eq('id', release.artifact_id)
    .eq('website_id', release.website_id)
    .single()
  if (error || !artifact) {
    throw new Error(
      `Production artifact is unavailable for protection: ${error?.message}`
    )
  }
  if (artifact.runtime_contract_version === 3) {
    throw new Error(
      'Runtime v3 production protection requires the supervised exact restore; legacy settings protection is forbidden'
    )
  }
  const blueprint = asRecord(artifact.blueprint)
  const themeArtifact = validateWordPressThemeArtifact(
    blueprint.wordpressThemeArtifact
  )
  const credentials = await getWordPressCredentialReference(
    targets.productionCredentialRef
  )
  await new WordPressAPIClient(targets.productionUrl, {
    username: credentials.username,
    password: credentials.password,
  }).applySiteForgeSettings({
    themeArtifact,
    legal: siteForgeLegalConfigSchema.parse(blueprint.legal),
    analytics: siteForgeAnalyticsConfigSchema.parse(blueprint.analytics),
    targetMode: 'staging',
  })
  if (targets.productionTargetId) {
    const { error: targetError } = await client
      .from('siteforge_wordpress_targets')
      .update({
        protection_mode: 'noindex',
        updated_at: new Date().toISOString(),
      })
      .eq('id', targets.productionTargetId)
      .eq('provider_application_id', targets.productionApplicationId)
      .eq('provider_server_id', targets.serverId)
    if (targetError) {
      throw new Error(
        `Noindex was applied but its target projection failed: ${targetError.message}`
      )
    }
  }
}
