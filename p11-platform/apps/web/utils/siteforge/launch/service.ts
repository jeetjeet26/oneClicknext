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
  getCloudwaysProviderCredentials,
} from '@/utils/siteforge/providers/cloudways-provider'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { normalizeSiteForgePreviewCredential } from '@/utils/siteforge/workflows/preview-steps'
import { WordPressAPIClient } from '@/utils/siteforge/wordpress-client'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  parseRenderableSiteForgeLegalConfig,
} from '@/utils/siteforge/quality/deterministic-gates'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  getLaunchRelease,
  SiteForgeLaunchError,
  transitionLaunchRelease,
} from './repository'
import { restoreDnsCutover } from './dns-cutover'

type ServiceClient = SupabaseClient<Database>

interface PromotionTokenPayload {
  releaseId: string
  artifactId: string
  contentHash: string
  bindingHash: string
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
    bindingHash: string
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
    payload.bindingHash !== expected.bindingHash ||
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

export type LaunchApprovalBinding = {
  releaseId: string
  artifactId: string
  contentHash: string
  stagingDeploymentId: string
  assetManifestHash: string
  baseThemePackageSha256: string
  overlayPackageSha256: string | null
  runtimeContractVersion: number
  runtimePackageSha256: string | null
  certificationReportHash: string
  rollbackArtifactId: string | null
  rollbackContentHash: string | null
}

export function launchApprovalBindingHash(
  binding: LaunchApprovalBinding
): string {
  return hashSiteForgeContent(binding)
}

export function assertDistinctLaunchActors(input: {
  operatorId: string | null
  reviewerId: string | null
  actingOperatorId?: string
}): void {
  if (!input.operatorId || !input.reviewerId) {
    throw new SiteForgeLaunchError(
      'Exact launch operator and reviewer identities are required',
      409
    )
  }
  if (input.operatorId === input.reviewerId) {
    throw new SiteForgeLaunchError(
      'The launch reviewer must be different from the launch operator',
      409
    )
  }
  if (
    input.actingOperatorId &&
    (input.actingOperatorId !== input.operatorId ||
      input.actingOperatorId === input.reviewerId)
  ) {
    throw new SiteForgeLaunchError(
      'Only the recorded launch operator may execute the reviewer-approved cutover',
      403
    )
  }
}

async function loadLaunchApprovalBinding(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  client: ServiceClient
): Promise<{ binding: LaunchApprovalBinding; bindingHash: string }> {
  const [{ data: artifact, error: artifactError }, { data: deployment, error: deploymentError }] =
    await Promise.all([
      client
        .from('siteforge_blueprint_versions')
        .select(
          'id, content_hash, asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, runtime_contract_version, runtime_package_sha256'
        )
        .eq('id', release.artifact_id)
        .eq('website_id', release.website_id)
        .single(),
      client
        .from('siteforge_artifact_deployments')
        .select(
          'id, artifact_id, artifact_content_hash, asset_manifest_hash, base_theme_package_sha256, overlay_package_sha256, runtime_contract_version, runtime_package_sha256, remote_manifest_hash, certification_report, certified_at'
        )
        .eq('id', release.staging_deployment_id || '')
        .eq('artifact_id', release.artifact_id)
        .single(),
    ])
  if (
    artifactError ||
    deploymentError ||
    !artifact ||
    !deployment ||
    !deployment.certified_at ||
    artifact.content_hash !== release.artifact_content_hash ||
    deployment.artifact_content_hash !== release.artifact_content_hash ||
    deployment.remote_manifest_hash !== release.artifact_content_hash ||
    !artifact.asset_manifest_hash ||
    !artifact.base_theme_package_sha256 ||
    deployment.asset_manifest_hash !== artifact.asset_manifest_hash ||
    deployment.base_theme_package_sha256 !== artifact.base_theme_package_sha256 ||
    deployment.overlay_package_sha256 !== artifact.overlay_package_sha256 ||
    deployment.runtime_contract_version !== artifact.runtime_contract_version ||
    deployment.runtime_package_sha256 !== artifact.runtime_package_sha256
  ) {
    throw new SiteForgeLaunchError(
      'The launch approval is not bound to the exact certified artifact, asset, and runtime identity',
      409
    )
  }
  const binding: LaunchApprovalBinding = {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    stagingDeploymentId: deployment.id,
    assetManifestHash: artifact.asset_manifest_hash,
    baseThemePackageSha256: artifact.base_theme_package_sha256,
    overlayPackageSha256: artifact.overlay_package_sha256,
    runtimeContractVersion: artifact.runtime_contract_version,
    runtimePackageSha256: artifact.runtime_package_sha256,
    certificationReportHash: hashSiteForgeContent(deployment.certification_report),
    rollbackArtifactId: release.rollback_artifact_id,
    rollbackContentHash: release.rollback_content_hash,
  }
  return { binding, bindingHash: launchApprovalBindingHash(binding) }
}

// A first-launch release carries no rollback artifact; require the manager
// to explicitly acknowledge that rollback relies on the pre-promotion
// Cloudways backup instead of a certified production artifact.
export function assertFirstLaunchAcknowledgment(input: {
  releaseRollbackArtifactId: string | null
  firstLaunchAcknowledged: boolean | undefined
}): void {
  if (
    !input.releaseRollbackArtifactId &&
    input.firstLaunchAcknowledged !== true
  ) {
    throw new SiteForgeLaunchError(
      'First launch requires explicit acknowledgment that no certified rollback artifact exists and recovery relies on the pre-promotion Cloudways backup',
      400
    )
  }
}

export async function approveLaunchRelease(
  input: {
    releaseId: string
    propertyId: string
    artifactId: string
    contentHash: string
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
    firstLaunchAcknowledged?: boolean
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
    (release.rollback_artifact_id ?? null) !==
      (input.rollbackArtifactId ?? null) ||
    (release.rollback_content_hash ?? null) !==
      (input.rollbackContentHash ?? null)
  ) {
    throw new SiteForgeLaunchError(
      'Approval does not match the exact launch and rollback identity',
      409
    )
  }
  assertFirstLaunchAcknowledgment({
    releaseRollbackArtifactId: release.rollback_artifact_id,
    firstLaunchAcknowledged: input.firstLaunchAcknowledged,
  })
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
  const { data: launchAction, error: launchActionError } = await client
    .from('shared_action_attempts')
    .select('requested_by')
    .eq('id', release.launch_action_attempt_id)
    .eq('property_id', input.propertyId)
    .single()
  if (launchActionError || !launchAction) {
    throw new SiteForgeLaunchError(
      'The recorded launch operator identity is unavailable',
      409
    )
  }
  assertDistinctLaunchActors({
    operatorId: release.created_by || launchAction.requested_by,
    reviewerId: input.approvedBy,
  })
  const approvalBinding = await loadLaunchApprovalBinding(release, client)

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
          launchBinding: approvalBinding.binding,
          launchBindingHash: approvalBinding.bindingHash,
          ...(release.rollback_artifact_id
            ? {}
            : { firstLaunchAcknowledged: true }),
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
        approval_rationale: input.rationale.trim(),
        legal_rights_snapshot: {
          ...legal,
          launchBinding: approvalBinding.binding,
          launchBindingHash: approvalBinding.bindingHash,
        } as unknown as Json,
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
        launchBindingHash: approvalBinding.bindingHash,
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
  } else if (
    release.approved_by !== input.approvedBy ||
    asRecord(release.legal_rights_snapshot).launchBindingHash !==
      approvalBinding.bindingHash
  ) {
    throw new SiteForgeLaunchError(
      'The existing launch approval belongs to a different reviewer or binding',
      409
    )
  }
  if (release.promotion_token_hash) {
    throw new SiteForgeLaunchError(
      'The one-use promotion token was already issued and cannot be reissued',
      409
    )
  }

  const token = signManualPromotionToken({
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    bindingHash: approvalBinding.bindingHash,
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
    stagingCredentialRef: staging.credential_ref,
    productionUrl: production?.site_url || parentCredentials.url,
  }
}

function launchHostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return value.trim().toLowerCase()
  }
}

async function loadPromotedContentManifest(
  productionUrl: string,
  credentialRefs: Array<string | null>
) {
  const candidates: Array<{ username: string; password: string }> = []
  // WordPress REST basic auth only accepts application passwords, never the
  // login password stored at provisioning time. When production shares
  // lineage with the SiteForge preview application, the preview application
  // password is the identity the preview and staging paths already
  // authenticate with, so it is the known-good REST reader here too.
  const previewUsername = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_USERNAME
  )
  const previewPassword = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD
  )
  const previewUrl = normalizeSiteForgePreviewCredential(
    process.env.SITEFORGE_PREVIEW_WP_URL
  )
  if (
    previewUsername &&
    previewPassword &&
    previewUrl &&
    launchHostOf(previewUrl) === launchHostOf(productionUrl)
  ) {
    candidates.push({ username: previewUsername, password: previewPassword })
  }
  for (const ref of credentialRefs) {
    if (!ref) continue
    const credentials = await getWordPressCredentialReference(ref)
    candidates.push({
      username: credentials.username,
      password: credentials.password,
    })
  }
  let lastError: unknown = new SiteForgeLaunchError(
    'No WordPress credential is available to verify the promoted manifest',
    409
  )
  for (const candidate of candidates) {
    try {
      return await new WordPressAPIClient(
        productionUrl,
        candidate
      ).getContentManifest()
    } catch (error) {
      const authFailure =
        error instanceof Error && /\((?:401|403)\)/.test(error.message)
      if (!authFailure) throw error
      lastError = error
    }
  }
  throw lastError
}

function cloudwaysClient(): CloudwaysProviderClient {
  const credentials = getCloudwaysProviderCredentials()
  if (!credentials) {
    throw new SiteForgeLaunchError(
      'Cloudways API credentials are required',
      503
    )
  }
  return new CloudwaysProviderClient(credentials)
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

export type LaunchRestoreExpectation =
  | {
      mode: 'certified_artifact'
      expectedArtifactId: string
      expectedContentHash: string
      forbiddenContentHash: null
    }
  | {
      mode: 'pre_siteforge_backup'
      expectedArtifactId: null
      expectedContentHash: null
      forbiddenContentHash: string
    }

export type LaunchRestoreManifestObservation =
  | {
      verification: 'exact_siteforge_manifest'
      manifestAvailable: true
      contentHash: string
    }
  | {
      verification: 'siteforge_manifest_absent'
      manifestAvailable: false
      contentHash: null
    }

export function resolveLaunchRestoreExpectation(input: {
  rollbackArtifactId: string | null
  rollbackContentHash: string | null
  promotedContentHash: string
}): LaunchRestoreExpectation {
  if (input.rollbackArtifactId && input.rollbackContentHash) {
    return {
      mode: 'certified_artifact',
      expectedArtifactId: input.rollbackArtifactId,
      expectedContentHash: input.rollbackContentHash,
      forbiddenContentHash: null,
    }
  }
  if (input.rollbackArtifactId || input.rollbackContentHash) {
    throw new SiteForgeLaunchError(
      'Release has a partial rollback identity',
      409
    )
  }
  return {
    mode: 'pre_siteforge_backup',
    expectedArtifactId: null,
    expectedContentHash: null,
    forbiddenContentHash: input.promotedContentHash,
  }
}

export function assertRestoredManifestExpectation(
  expectation: LaunchRestoreExpectation,
  observation: LaunchRestoreManifestObservation
): void {
  if (expectation.mode === 'certified_artifact') {
    if (
      observation.verification !== 'exact_siteforge_manifest' ||
      observation.contentHash !== expectation.expectedContentHash
    ) {
      throw new SiteForgeLaunchError(
        'Restored remote manifest does not match the certified rollback identity yet. Cloudways restores can take several minutes to take effect after the operation completes; retry this confirmation shortly.',
        409
      )
    }
    return
  }
  if (observation.verification !== 'siteforge_manifest_absent') {
    throw new SiteForgeLaunchError(
      observation.contentHash === expectation.forbiddenContentHash
        ? 'The promoted SiteForge manifest is still active after the first-launch restore; retry this confirmation shortly.'
        : 'First-launch recovery did not verify a pre-SiteForge state because a valid SiteForge manifest is still present.',
      409
    )
  }
}

async function loadRestoredManifestObservation(
  productionUrl: string,
  credentialRefs: Array<string | null>,
  expectation: LaunchRestoreExpectation
): Promise<LaunchRestoreManifestObservation> {
  try {
    const manifest = await loadPromotedContentManifest(
      productionUrl,
      credentialRefs
    )
    return {
      verification: 'exact_siteforge_manifest',
      manifestAvailable: true,
      contentHash: manifest.content_hash,
    }
  } catch (error) {
    if (
      expectation.mode === 'pre_siteforge_backup' &&
      error instanceof Error &&
      /Failed to load SiteForge content manifest \(404\)/.test(error.message)
    ) {
      return {
        verification: 'siteforge_manifest_absent',
        manifestAvailable: false,
        contentHash: null,
      }
    }
    throw error
  }
}

async function finalizePromotedRelease(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  targets: Awaited<ReturnType<typeof loadCloudwaysTargets>>,
  _actorId: string,
  _requestId: string | null,
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
  const manifest = await loadPromotedContentManifest(
    targets.productionUrl,
    // A Cloudways staging push copies the staging database (including
    // WordPress users and application passwords) onto production, so the
    // staging credential is the working reader right after promotion while a
    // supervised restore flips production back to its original credential.
    // The launch gate is the exact content-hash identity below, not which
    // read-only credential fetched the manifest.
    [targets.productionCredentialRef, targets.stagingCredentialRef]
  )
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
        protection_mode: 'noindex',
        status: 'provisioning',
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
        status: 'production_certifying',
        certification_report: integrityReport,
        remote_manifest_hash: release.artifact_content_hash,
        final_verified_content_hash: release.artifact_content_hash,
        deployed_url: targets.productionUrl,
        deployed_at: completedAt,
        certified_at: null,
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
      editor_lifecycle_status: 'certifying_production',
      production_target_id: productionTargetId,
      production_artifact_id: release.artifact_id,
      production_content_hash: release.artifact_content_hash,
      production_url: targets.productionUrl,
      production_certified_at: null,
      production_certification_report: integrityReport,
      externally_promoted_artifact_id: release.artifact_id,
      externally_promoted_at: release.promoted_at || completedAt,
      wp_url: targets.productionUrl,
      current_step:
        'Promotion verified; rendered production certification required before live',
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

  // Manifest identity is a promotion preflight, not launch certification.
  // The release intentionally remains promoted and protected/noindex until
  // certifySiteForgeProduction records a complete rendered browser report and
  // performs the production_certified -> live transitions.
  return release
}

async function consumePromotionToken(
  release: Awaited<ReturnType<typeof getLaunchRelease>>,
  token: string,
  bindingHash: string,
  client: ServiceClient,
  allowClaimedReconciliation = false
) {
  verifyManualPromotionToken(token, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    bindingHash,
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
  assertDistinctLaunchActors({
    operatorId: release.created_by,
    reviewerId: release.approved_by,
    actingOperatorId: input.actorId,
  })
  const approvalBinding = await loadLaunchApprovalBinding(release, client)
  const legalSnapshot = asRecord(release.legal_rights_snapshot)
  if (legalSnapshot.launchBindingHash !== approvalBinding.bindingHash) {
    throw new SiteForgeLaunchError(
      'The approved launch binding no longer matches the exact release identity',
      409
    )
  }
  verifyManualPromotionToken(input.promotionToken, {
    releaseId: release.id,
    artifactId: release.artifact_id,
    contentHash: release.artifact_content_hash,
    bindingHash: approvalBinding.bindingHash,
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
      if (release.launch_action_attempt_id) {
        const { error: auditError } = await client
          .from('shared_action_attempts')
          .update({
            lifecycle_status: 'running',
            execution_status: 'running',
            execution_payload: {
              releaseId: release.id,
              artifactId: release.artifact_id,
              contentHash: release.artifact_content_hash,
              backupOperationId: input.backupConfirmation.operationId,
              backupId: input.backupConfirmation.backupId,
            } as Json,
            rollback_metadata: {
              backupProvider: 'cloudways-manual',
              backupOperationId: input.backupConfirmation.operationId,
              backupId: input.backupConfirmation.backupId,
              rollbackArtifactId: release.rollback_artifact_id,
              rollbackContentHash: release.rollback_content_hash,
            } as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', release.launch_action_attempt_id)
          .eq('reviewed_by', release.approved_by || '')
        if (auditError) {
          throw new SiteForgeLaunchError(
            'Backup was verified but its shared action audit could not be updated',
            500
          )
        }
      }
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
    approvalBinding.bindingHash,
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
  if (release.launch_action_attempt_id) {
    const completedAt = new Date().toISOString()
    const { error: auditError } = await client
      .from('shared_action_attempts')
      .update({
        lifecycle_status: 'succeeded',
        execution_status: 'succeeded',
        execution_result: {
          releaseId: release.id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
          promotionOperationId: operationId,
          backupOperationId: release.backup_operation_id,
          backupId: release.backup_id,
        } as Json,
        executed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', release.launch_action_attempt_id)
      .eq('reviewed_by', release.approved_by || '')
    if (auditError) {
      throw new SiteForgeLaunchError(
        'Promotion completed but its shared action audit could not be finalized',
        500
      )
    }
  }
  release = await finalizePromotedRelease(
    release,
    targets,
    input.actorId,
    input.requestId || null,
    client
  )
  return { release, manualRequired: false as const }
}

const LAUNCH_PROVIDER_MUTATION_DOMAIN = 'siteforge.launch.provider-mutation'

export type LaunchProviderMutationResult =
  | {
      mutation: 'backup'
      operationId: string
      backupId: string
      idempotent: boolean
    }
  | { mutation: 'promotion'; operationId: string; idempotent: boolean }
  | { mutation: 'restore'; operationId: string; idempotent: boolean }

/**
 * Executes the non-idempotent Cloudways mutation that the promote flow asks
 * the operator to confirm (production backup, or staging push-to-live), using
 * the same claim -> provider call -> checkpoint discipline as production
 * provisioning. The launch state machine still independently verifies the
 * returned operation before any release transition, so this only automates
 * the operator's dashboard action - it does not weaken the promotion gates.
 */
export async function executeLaunchProviderMutation(
  input: {
    releaseId: string
    propertyId: string
    mutation: 'backup' | 'promotion' | 'restore'
    actorId: string
    requestId?: string
  },
  client: ServiceClient = createServiceClient()
): Promise<LaunchProviderMutationResult> {
  const release = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  assertDistinctLaunchActors({
    operatorId: release.created_by,
    reviewerId: release.approved_by,
    actingOperatorId: input.actorId,
  })
  if (input.mutation === 'backup') {
    if (release.backup_operation_id && release.backup_id) {
      return {
        mutation: 'backup',
        operationId: release.backup_operation_id,
        backupId: release.backup_id,
        idempotent: true,
      }
    }
    if (release.state !== 'launch_approved') {
      throw new SiteForgeLaunchError(
        `A production backup cannot be created from ${release.state}`,
        409
      )
    }
  } else if (input.mutation === 'restore') {
    // The supervised restore flow independently verifies the operation and
    // the restored manifest against the certified rollback identity; this
    // only performs the operator's Cloudways restore action for a release
    // that already has an awaiting-operator restore request.
    if (!release.backup_id) {
      throw new SiteForgeLaunchError(
        'The release has no verified pre-promotion backup to restore',
        409
      )
    }
    const { data: awaitingDrill } = await client
      .from('siteforge_restore_drills')
      .select('id, provider_operation_id')
      .eq('release_id', release.id)
      .in('status', ['queued', 'restoring', 'verifying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!awaitingDrill) {
      throw new SiteForgeLaunchError(
        'An awaiting-operator restore request is required before the provider restore',
        409
      )
    }
    if (awaitingDrill.provider_operation_id) {
      return {
        mutation: 'restore',
        operationId: awaitingDrill.provider_operation_id,
        idempotent: true,
      }
    }
  } else {
    if (release.promotion_operation_id) {
      return {
        mutation: 'promotion',
        operationId: release.promotion_operation_id,
        idempotent: true,
      }
    }
    if (release.state !== 'backed_up') {
      throw new SiteForgeLaunchError(
        `A staging push-to-live cannot start from ${release.state}`,
        409
      )
    }
  }
  const targets = await loadCloudwaysTargets(release.id, client)
  const cloudways = cloudwaysClient()

  const dedupeKey = `siteforge-launch:${input.mutation}:${release.id}`
  const now = new Date().toISOString()
  const inserted = await client
    .from('shared_jobs')
    .insert({
      org_id: release.org_id,
      property_id: release.property_id,
      domain: LAUNCH_PROVIDER_MUTATION_DOMAIN,
      subject_type: 'siteforge_launch_release',
      subject_id: release.id,
      lifecycle_status: 'running',
      status_reason: `launch_${input.mutation}_provider_mutation_claimed`,
      dedupe_key: dedupeKey,
      payload: {
        releaseId: release.id,
        websiteId: release.website_id,
        mutation: input.mutation,
        requestedBy: input.actorId,
      },
      heartbeat_at: now,
      started_at: now,
      max_attempts: 1,
    })
    .select('id')
    .maybeSingle()
  let jobId = inserted.data?.id ?? null
  if (!jobId) {
    if (inserted.error?.code !== '23505') {
      throw new SiteForgeLaunchError(
        `Failed to claim the launch ${input.mutation} provider mutation`,
        500
      )
    }
    const { data: existing, error } = await client
      .from('shared_jobs')
      .select('id, lifecycle_status, output')
      .eq('domain', LAUNCH_PROVIDER_MUTATION_DOMAIN)
      .eq('dedupe_key', dedupeKey)
      .single()
    if (error || !existing) {
      throw new SiteForgeLaunchError(
        `Failed to reconcile the launch ${input.mutation} provider mutation`,
        500
      )
    }
    const checkpoint = asRecord(existing.output)
    if (
      input.mutation === 'backup' &&
      typeof checkpoint.operationId === 'string' &&
      typeof checkpoint.backupId === 'string'
    ) {
      return {
        mutation: 'backup',
        operationId: checkpoint.operationId,
        backupId: checkpoint.backupId,
        idempotent: true,
      }
    }
    if (
      (input.mutation === 'promotion' || input.mutation === 'restore') &&
      typeof checkpoint.operationId === 'string'
    ) {
      return {
        mutation: input.mutation,
        operationId: checkpoint.operationId,
        idempotent: true,
      }
    }
    if (existing.lifecycle_status !== 'failed') {
      throw new SiteForgeLaunchError(
        `The launch ${input.mutation} mutation was claimed without a persisted provider identity; manual reconciliation is required`,
        409
      )
    }
    // A prior attempt failed before the provider produced any identity, so the
    // mutation never happened. Re-claim the terminal job exactly once.
    const reclaimed = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        status_reason: `launch_${input.mutation}_provider_mutation_reclaimed`,
        heartbeat_at: now,
        started_at: now,
        finished_at: null,
        updated_at: now,
      })
      .eq('id', existing.id)
      .eq('lifecycle_status', 'failed')
      .select('id')
      .maybeSingle()
    if (!reclaimed.data) {
      throw new SiteForgeLaunchError(
        `The launch ${input.mutation} provider mutation is already being retried`,
        409
      )
    }
    jobId = reclaimed.data.id
  }

  const actionType = `siteforge.launch:${input.mutation}`
  let { data: mutationAction } = await client
    .from('shared_action_attempts')
    .select('id')
    .eq('job_id', jobId)
    .eq('action_type', actionType)
    .maybeSingle()
  if (!mutationAction) {
    const createdAction = await client
      .from('shared_action_attempts')
      .insert({
        job_id: jobId,
        org_id: release.org_id,
        property_id: release.property_id,
        action_type: actionType,
        lifecycle_status: 'running',
        proposal_decision_status: 'approved',
        execution_status: 'running',
        requested_by: input.actorId,
        reviewed_by: release.approved_by,
        request_payload: {
          releaseId: release.id,
          websiteId: release.website_id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
          backupId: release.backup_id,
          rollbackArtifactId: release.rollback_artifact_id,
          rollbackContentHash: release.rollback_content_hash,
        } as Json,
        execution_payload: {
          mutation: input.mutation,
          provider: 'cloudways',
        } as Json,
        rollback_metadata: {
          backupId: release.backup_id,
          rollbackArtifactId: release.rollback_artifact_id,
          rollbackContentHash: release.rollback_content_hash,
        } as Json,
        policy_reason:
          'The exact launch operator is executing a separately reviewed provider mutation.',
        confidence_score: 1,
        decided_at: now,
      })
      .select('id')
      .single()
    if (createdAction.error || !createdAction.data) {
      throw new SiteForgeLaunchError(
        `Failed to audit the launch ${input.mutation} shared action`,
        500
      )
    }
    mutationAction = createdAction.data
  }

  let output: Json
  let result: LaunchProviderMutationResult
  try {
    ;({ output, result } = await runLaunchProviderMutation(
      input.mutation,
      targets,
      cloudways,
      release.backup_id
    ))
  } catch (cause) {
    const failedAt = new Date().toISOString()
    await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: `launch_${input.mutation}_provider_mutation_failed`,
        error_message:
          cause instanceof Error ? cause.message : 'Unknown provider failure',
        finished_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', jobId)
      .eq('lifecycle_status', 'running')
    await client
      .from('shared_action_attempts')
      .update({
        lifecycle_status: 'failed',
        execution_status: 'failed',
        error_message:
          cause instanceof Error ? cause.message : 'Unknown provider failure',
        updated_at: failedAt,
      })
      .eq('id', mutationAction.id)
    throw cause
  }

  const completedAt = new Date().toISOString()
  const { error: checkpointError } = await client
    .from('shared_jobs')
    .update({
      lifecycle_status: 'succeeded',
      status_reason: `launch_${input.mutation}_provider_identity_persisted`,
      output,
      finished_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', jobId)
  if (checkpointError) {
    throw new SiteForgeLaunchError(
      `Failed to checkpoint the launch ${input.mutation} provider identity`,
      500
    )
  }
  const { error: actionCheckpointError } = await client
    .from('shared_action_attempts')
    .update({
      lifecycle_status: 'succeeded',
      execution_status: 'succeeded',
      execution_result: output,
      executed_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', mutationAction.id)
  if (actionCheckpointError) {
    throw new SiteForgeLaunchError(
      `Provider identity was saved but the launch ${input.mutation} shared action audit failed`,
      500
    )
  }
  return result
}

async function runLaunchProviderMutation(
  mutation: 'backup' | 'promotion' | 'restore',
  targets: Awaited<ReturnType<typeof loadCloudwaysTargets>>,
  cloudways: ReturnType<typeof cloudwaysClient>,
  releaseBackupId: string | null
): Promise<{ output: Json; result: LaunchProviderMutationResult }> {
  let output: Json
  let result: LaunchProviderMutationResult
  if (mutation === 'restore') {
    if (!releaseBackupId) {
      throw new SiteForgeLaunchError(
        'The release has no verified pre-promotion backup to restore',
        409
      )
    }
    const started = await cloudways.restoreApplicationBackup({
      serverId: targets.serverId,
      applicationId: targets.productionApplicationId,
      backupId: releaseBackupId,
    })
    if (!started.operationId) {
      throw new SiteForgeLaunchError(
        'Cloudways did not return the exact restore operation identity',
        502
      )
    }
    await cloudways.waitForOperation(started.operationId)
    output = { operationId: started.operationId }
    result = {
      mutation: 'restore',
      operationId: started.operationId,
      idempotent: false,
    }
  } else if (mutation === 'backup') {
    const started = await cloudways.createApplicationBackup({
      serverId: targets.serverId,
      applicationId: targets.productionApplicationId,
    })
    if (!started.operationId) {
      throw new SiteForgeLaunchError(
        'Cloudways did not return the exact backup operation identity',
        502
      )
    }
    // Cloudways identifies backups by restore-point timestamps, revealed only
    // after the backup operation completes.
    await cloudways.waitForOperation(started.operationId)
    const restorePoint = await cloudways.getLatestRestorePoint({
      serverId: targets.serverId,
      applicationId: targets.productionApplicationId,
    })
    if (!restorePoint) {
      throw new SiteForgeLaunchError(
        'Cloudways did not reveal the restore point for the completed backup',
        502
      )
    }
    output = { operationId: started.operationId, backupId: restorePoint }
    result = {
      mutation: 'backup',
      operationId: started.operationId,
      backupId: restorePoint,
      idempotent: false,
    }
  } else {
    const started = await cloudways.promoteStagingApplication({
      serverId: targets.serverId,
      stagingApplicationId: targets.stagingApplicationId,
      productionApplicationId: targets.productionApplicationId,
    })
    if (!started.operationId) {
      throw new SiteForgeLaunchError(
        'Cloudways did not return the exact promotion operation identity',
        502
      )
    }
    await cloudways.waitForOperation(started.operationId)
    output = { operationId: started.operationId }
    result = {
      mutation: 'promotion',
      operationId: started.operationId,
      idempotent: false,
    }
  }
  return { output, result }
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
  assertDistinctLaunchActors({
    operatorId: release.created_by,
    reviewerId: release.approved_by,
    actingOperatorId: input.actorId,
  })
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
  if (!release.backup_id) {
    throw new SiteForgeLaunchError(
      'Release does not have a verified pre-promotion backup identity',
      409
    )
  }
  const restoreExpectation = resolveLaunchRestoreExpectation({
    rollbackArtifactId: release.rollback_artifact_id,
    rollbackContentHash: release.rollback_content_hash,
    promotedContentHash: release.artifact_content_hash,
  })
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
  const remoteManifest = await loadRestoredManifestObservation(
    targets.productionUrl,
    [targets.productionCredentialRef, targets.stagingCredentialRef],
    restoreExpectation
  )
  assertRestoredManifestExpectation(restoreExpectation, remoteManifest)

  const { data: website, error: websiteLookupError } = await client
    .from('property_websites')
    .select('production_artifact_id, production_content_hash, target_domain')
    .eq('id', release.website_id)
    .single()
  if (websiteLookupError || !website) {
    throw new SiteForgeLaunchError(
      'Restore website projection is unavailable',
      500
    )
  }
  let dnsRestore:
    | Awaited<ReturnType<typeof restoreDnsCutover>>
    | null = null
  if (website.target_domain) {
    const { data: dnsSnapshot, error: dnsSnapshotError } = await client
      .from('siteforge_dns_snapshots')
      .select('id')
      .eq('website_id', release.website_id)
      .eq('release_id', release.id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (dnsSnapshotError) {
      throw new SiteForgeLaunchError(
        `Failed to determine whether DNS recovery is required: ${dnsSnapshotError.message}`,
        500
      )
    }
    // DNS mutation is impossible without a persisted release snapshot. A
    // missing snapshot therefore means this post-promotion failure happened
    // before cutover and there is no DNS state to restore.
    if (dnsSnapshot) {
      dnsRestore = await restoreDnsCutover(
        {
          releaseId: release.id,
          websiteId: release.website_id,
          actorId: input.actorId,
        },
        client
      )
      if (dnsRestore.manualRequired) {
        throw new SiteForgeLaunchError(
          `Content was restored, but exact DNS recovery requires supervised removal of provider records: ${dnsRestore.manualRemovalRecordIds.join(
            ', '
          )}`,
          409
        )
      }
      if (dnsRestore.propagationPending) {
        throw new SiteForgeLaunchError(
          'Content and DNS records were restored, but public DNS propagation is still pending',
          409
        )
      }
    }
  }
  const alreadyProjected =
    website.production_artifact_id === restoreExpectation.expectedArtifactId &&
    website.production_content_hash === restoreExpectation.expectedContentHash
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
        restoreMode: restoreExpectation.mode,
        rollbackArtifactId: restoreExpectation.expectedArtifactId,
        rollbackContentHash: restoreExpectation.expectedContentHash,
        remoteManifestHash: remoteManifest.contentHash,
        manifestAvailable: remoteManifest.manifestAvailable,
        manifestVerification: remoteManifest.verification,
        serverId: targets.serverId,
        applicationId: targets.productionApplicationId,
        dnsSnapshotId: dnsRestore?.snapshot.id || null,
        dnsRestoredAt: dnsRestore?.snapshot.restored_at || null,
        manual: true,
      },
      input.requestId || null,
      client
    )
  }
  const { data: projected, error: websiteError } = alreadyProjected
    ? { data: { id: release.website_id }, error: null }
    : await client
        .from('property_websites')
        .update({
          editor_lifecycle_status:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? 'staging_ready'
              : 'production_live',
          production_artifact_id: restoreExpectation.expectedArtifactId,
          production_content_hash: restoreExpectation.expectedContentHash,
          production_certified_at:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? null
              : undefined,
          production_certification_report:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? null
              : undefined,
          externally_promoted_artifact_id:
            restoreExpectation.expectedArtifactId,
          externally_promoted_at:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? null
              : undefined,
          deployed_artifact_version_id:
            restoreExpectation.expectedArtifactId,
          deployed_content_hash: restoreExpectation.expectedContentHash,
          deployed_at:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? null
              : undefined,
          current_step:
            restoreExpectation.mode === 'pre_siteforge_backup'
              ? 'Pre-SiteForge production backup restored'
              : 'Production restored to recorded rollback artifact',
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
  const { error: drillCloseError } = await client
    .from('siteforge_restore_drills')
    .update(
      buildRestoreDrillSuccessUpdate({
        existingReport: drill.verification_report,
        remoteManifestHash: remoteManifest.contentHash,
        manifestVerification: remoteManifest.verification,
        operationId,
        actorId: input.actorId,
      })
    )
    .eq('id', drill.id)
    .eq('status', 'verifying')
  if (drillCloseError) {
    throw new SiteForgeLaunchError(
      `Verified restore could not close the drill record: ${drillCloseError.message}`,
      500
    )
  }
  const { data: restoreJob } = await client
    .from('shared_jobs')
    .select('id')
    .eq('org_id', release.org_id)
    .eq('domain', 'siteforge.restore-request')
    .eq('dedupe_key', `siteforge-restore-request:${release.id}`)
    .maybeSingle()
  if (restoreJob) {
    const completedAt = new Date().toISOString()
    const { error: restoreAuditError } = await client
      .from('shared_action_attempts')
      .update({
        lifecycle_status: 'succeeded',
        execution_status: 'succeeded',
        execution_result: {
          releaseId: release.id,
          operationId,
          remoteManifestHash: remoteManifest.contentHash,
          manifestAvailable: remoteManifest.manifestAvailable,
          manifestVerification: remoteManifest.verification,
          dnsSnapshotId: dnsRestore?.snapshot.id || null,
          dnsRestoredAt: dnsRestore?.snapshot.restored_at || null,
        } as Json,
        executed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('job_id', restoreJob.id)
      .eq('action_type', 'siteforge.launch:restore')
      .eq('requested_by', input.actorId)
      .eq('reviewed_by', release.approved_by || '')
    if (restoreAuditError) {
      throw new SiteForgeLaunchError(
        'Restore succeeded but its shared action audit could not be finalized',
        500
      )
    }
  }
  return { release, manualRequired: false as const }
}

export function buildRestoreDrillSuccessUpdate(input: {
  existingReport: unknown
  remoteManifestHash: string | null
  manifestVerification:
    | 'exact_siteforge_manifest'
    | 'siteforge_manifest_absent'
  operationId: string
  actorId: string
}) {
  const existing =
    input.existingReport && typeof input.existingReport === 'object'
      ? (input.existingReport as Record<string, unknown>)
      : {}
  return {
    status: 'succeeded' as const,
    completed_at: new Date().toISOString(),
    verification_report: {
      ...existing,
      remoteManifestHash: input.remoteManifestHash,
      manifestVerification: input.manifestVerification,
      verifiedOperationId: input.operationId,
      verifiedBy: input.actorId,
    },
  }
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
  assertDistinctLaunchActors({
    operatorId: release.created_by,
    reviewerId: release.approved_by,
    actingOperatorId: input.actorId,
  })
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
  if (!release.backup_id) {
    throw new SiteForgeLaunchError(
      'Restore request requires the verified pre-promotion backup identity',
      409
    )
  }
  const restoreExpectation = resolveLaunchRestoreExpectation({
    rollbackArtifactId: release.rollback_artifact_id,
    rollbackContentHash: release.rollback_content_hash,
    promotedContentHash: release.artifact_content_hash,
  })

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
      restoreMode: restoreExpectation.mode,
      rollbackArtifactId: restoreExpectation.expectedArtifactId,
      rollbackContentHash: restoreExpectation.expectedContentHash,
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
  let { data: restoreAction } = await client
    .from('shared_action_attempts')
    .select('id')
    .eq('job_id', job.id)
    .eq('action_type', 'siteforge.launch:restore')
    .maybeSingle()
  if (!restoreAction) {
    const createdAction = await client
      .from('shared_action_attempts')
      .insert({
        job_id: job.id,
        org_id: release.org_id,
        property_id: release.property_id,
        action_type: 'siteforge.launch:restore',
        lifecycle_status: 'queued',
        proposal_decision_status: 'approved',
        execution_status: 'pending_approval',
        requested_by: input.actorId,
        reviewed_by: release.approved_by,
        request_payload: {
          releaseId: release.id,
          artifactId: release.artifact_id,
          contentHash: release.artifact_content_hash,
          backupId: release.backup_id,
          restoreMode: restoreExpectation.mode,
          rollbackArtifactId: restoreExpectation.expectedArtifactId,
          rollbackContentHash: restoreExpectation.expectedContentHash,
          rationale: input.rationale,
          source: input.source,
        } as Json,
        execution_payload: { releaseId: release.id } as Json,
        rollback_metadata: {
          backupId: release.backup_id,
          restoreMode: restoreExpectation.mode,
          rollbackArtifactId: restoreExpectation.expectedArtifactId,
          rollbackContentHash: restoreExpectation.expectedContentHash,
        } as Json,
        policy_reason:
          'Supervised restore is bound to the separately approved rollback and backup identities.',
        confidence_score: 1,
        decided_at: now,
      })
      .select('id')
      .single()
    if (createdAction.error || !createdAction.data) {
      throw new SiteForgeLaunchError(
        'Failed to persist the supervised restore shared action',
        500
      )
    }
    restoreAction = createdAction.data
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
          expected_artifact_id: restoreExpectation.expectedArtifactId,
          // The current schema keeps this legacy column non-null. In
          // pre-SiteForge mode it stores the promoted hash as a forbidden
          // identity; the report below is the honest nullable expectation.
          expected_content_hash:
            restoreExpectation.expectedContentHash ||
            restoreExpectation.forbiddenContentHash ||
            release.artifact_content_hash,
          status: 'verifying',
          verification_report: {
            requestType: input.source,
            restoreMode: restoreExpectation.mode,
            expectedArtifactId: restoreExpectation.expectedArtifactId,
            expectedContentHash: restoreExpectation.expectedContentHash,
            forbiddenContentHash: restoreExpectation.forbiddenContentHash,
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
    legal: parseRenderableSiteForgeLegalConfig(blueprint.legal),
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
