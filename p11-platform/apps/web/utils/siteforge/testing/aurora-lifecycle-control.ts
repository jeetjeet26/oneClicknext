import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Json, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

export const AURORA_LIFECYCLE_DOMAIN = 'siteforge.aurora-lifecycle'
export const AURORA_LIFECYCLE_CONFIRMATION = 'DELETE_OWNED_AURORA_RESOURCES'

export const postgresUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const lifecycleIdentitySchema = z
  .object({
    ownerId: postgresUuidSchema,
    expiresAt: z.string().datetime(),
    propertyId: postgresUuidSchema,
    websiteId: postgresUuidSchema,
    targetId: postgresUuidSchema,
    rolloutAssignmentId: postgresUuidSchema,
  })
  .strict()

export type AuroraLifecycleIdentity = z.infer<typeof lifecycleIdentitySchema>
export type AuroraLifecyclePhase = 'bootstrap' | 'mutation'

type ServiceClient = ReturnType<typeof createServiceClient>

export class AuroraLifecycleControlError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'AuroraLifecycleControlError'
  }
}

function fail(message: string, statusCode: number, code: string): never {
  throw new AuroraLifecycleControlError(message, statusCode, code)
}

function controlSecret(): string {
  if (process.env.SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED !== 'true') {
    fail('Aurora lifecycle control is disabled', 404, 'control_disabled')
  }
  const secret = process.env.SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET || ''
  if (secret.length < 32) {
    fail(
      'Aurora lifecycle control secret is not configured',
      503,
      'control_secret_unavailable'
    )
  }
  return secret
}

function safeSecretMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

function sameInstant(left: string | null, right: string): boolean {
  return Boolean(
    left &&
    Number.isFinite(Date.parse(left)) &&
    Date.parse(left) === Date.parse(right)
  )
}

export function requireAuroraLifecycleBearer(request: Request): void {
  const expected = controlSecret()
  const authorization = request.headers.get('authorization') || ''
  const match = /^Bearer (.+)$/.exec(authorization)
  if (!match || !safeSecretMatch(match[1], expected)) {
    fail('Unauthorized Aurora lifecycle control request', 401, 'invalid_bearer')
  }
}

function identityFromHeaders(request: Request): AuroraLifecycleIdentity | null {
  const values = {
    ownerId: request.headers.get('x-p11-test-owner-id'),
    expiresAt: request.headers.get('x-p11-test-expires-at'),
    propertyId: request.headers.get('x-p11-test-property-id'),
    websiteId: request.headers.get('x-p11-test-website-id'),
    targetId: request.headers.get('x-p11-test-target-id'),
    rolloutAssignmentId: request.headers.get(
      'x-p11-test-rollout-assignment-id'
    ),
  }
  if (Object.values(values).every((value) => value === null)) return null
  const parsed = lifecycleIdentitySchema.safeParse(values)
  if (!parsed.success) {
    fail(
      'Complete exact Aurora lifecycle identity headers are required',
      400,
      'invalid_identity_headers'
    )
  }
  return parsed.data
}

export function hasAuroraLifecycleIdentityHeaders(request: Request): boolean {
  return Boolean(request.headers.get('x-p11-test-owner-id'))
}

export function requireAuroraLifecycleIdentity(
  request: Request
): AuroraLifecycleIdentity {
  requireAuroraLifecycleBearer(request)
  const identity = identityFromHeaders(request)
  if (!identity) {
    fail(
      'Exact Aurora lifecycle identity headers are required',
      400,
      'missing_identity_headers'
    )
  }
  return identity
}

function normalizedUrl(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    return `${url.hostname.toLowerCase()}${url.pathname.toLowerCase()}`
  } catch {
    return value.trim().toLowerCase()
  }
}

export function assertNotAcaciaIdentity(input: {
  propertyName?: string | null
  urls?: Array<string | null | undefined>
}): void {
  const propertyName = input.propertyName?.trim().toLowerCase() || ''
  const urls = (input.urls || []).map(normalizedUrl)
  if (
    propertyName === 'acacia' ||
    propertyName.includes('acacia') ||
    urls.some(
      (value) =>
        value.includes('/acacia') ||
        value.includes('/communities/acacia') ||
        value.includes('dividendhomes.com/acacia')
    )
  ) {
    fail(
      'Acacia is read-only and cannot be used by Aurora lifecycle control',
      403,
      'acacia_rejected'
    )
  }
  if (!propertyName.includes('aurora')) {
    fail(
      'Aurora lifecycle control requires an Aurora property identity',
      409,
      'non_aurora_identity'
    )
  }
}

export function isAuroraBootstrapAnchor(input: {
  targetType: string
  targetRuntimeContractVersion: number
  rolloutRequestedContractVersion: number
  rolloutStatus: string
}): boolean {
  return (
    input.targetType === 'canonical_preview' &&
    [1, 2].includes(input.targetRuntimeContractVersion) &&
    input.rolloutRequestedContractVersion === 3 &&
    input.rolloutStatus === 'paused'
  )
}

export async function loadExactAuroraIdentity(
  identity: AuroraLifecycleIdentity,
  client: ServiceClient = createServiceClient(),
  phase: AuroraLifecyclePhase = 'bootstrap'
) {
  const [
    { data: property, error: propertyError },
    { data: website, error: websiteError },
    { data: target, error: targetError },
    { data: rollout, error: rolloutError },
  ] = await Promise.all([
    client
      .from('properties')
      .select('id, org_id, name, website_url')
      .eq('id', identity.propertyId)
      .single(),
    client
      .from('property_websites')
      .select(
        'id, org_id, property_id, wp_url, staging_url, production_url, target_domain'
      )
      .eq('id', identity.websiteId)
      .eq('property_id', identity.propertyId)
      .single(),
    client
      .from('siteforge_wordpress_targets')
      .select(
        'id, org_id, property_id, website_id, target_type, provider, site_url, metadata, runtime_contract_version, runtime_package_sha256, runtime_manifest_sha256, last_verified_artifact_id, last_verified_content_hash, last_verified_asset_manifest_hash'
      )
      .eq('id', identity.targetId)
      .eq('property_id', identity.propertyId)
      .eq('website_id', identity.websiteId)
      .eq('is_active', true)
      .single(),
    client
      .from('siteforge_runtime_target_rollouts')
      .select(
        'id, org_id, property_id, website_id, target_id, requested_contract_version, runtime_package_sha256, status'
      )
      .eq('id', identity.rolloutAssignmentId)
      .eq('target_id', identity.targetId)
      .eq('property_id', identity.propertyId)
      .eq('website_id', identity.websiteId)
      .single(),
  ])
  if (propertyError || websiteError || targetError || rolloutError) {
    fail(
      'Exact Aurora property, website, target, and runtime assignment are required',
      404,
      'identity_not_found'
    )
  }
  if (
    !property ||
    !website ||
    !target ||
    !rollout ||
    property.org_id !== website.org_id ||
    property.org_id !== target.org_id ||
    property.org_id !== rollout.org_id
  ) {
    fail(
      'Aurora lifecycle identity does not belong to one tenant',
      403,
      'tenant_mismatch'
    )
  }
  assertNotAcaciaIdentity({
    propertyName: property.name,
    urls: [
      property.website_url,
      website.wp_url,
      website.staging_url,
      website.production_url,
      website.target_domain,
      target.site_url,
    ],
  })
  const bootstrapAnchor = isAuroraBootstrapAnchor({
    targetType: target.target_type,
    targetRuntimeContractVersion: target.runtime_contract_version,
    rolloutRequestedContractVersion: rollout.requested_contract_version,
    rolloutStatus: rollout.status,
  })
  if (
    phase === 'bootstrap' &&
    (!website.wp_url ||
      !target.site_url ||
      normalizedUrl(website.wp_url) !== normalizedUrl(target.site_url))
  ) {
    fail(
      'Bootstrap target URL must exactly match the explicit Aurora WordPress URL',
      409,
      'target_url_mismatch'
    )
  }
  const mutationAnchor =
    rollout.requested_contract_version === 3 &&
    ((target.target_type === 'canonical_preview' &&
      rollout.status === 'paused' &&
      [1, 2].includes(target.runtime_contract_version)) ||
      (target.target_type === 'canonical_preview' &&
        rollout.status === 'enabled' &&
        [1, 2].includes(target.runtime_contract_version) &&
        Boolean(rollout.runtime_package_sha256)) ||
      (rollout.status === 'enabled' &&
        target.runtime_contract_version === 3 &&
        target.runtime_package_sha256 === rollout.runtime_package_sha256))
  if (phase === 'bootstrap' ? !bootstrapAnchor : !mutationAnchor) {
    fail(
      phase === 'bootstrap'
        ? 'Bootstrap requires the exact Aurora contract-1/2 preview target and paused v3 rollout'
        : 'Aurora lifecycle target assignment is not valid for mutation',
      409,
      'runtime_assignment_mismatch'
    )
  }
  return { property, website, target, rollout }
}

function leaseDedupeKey(websiteId: string): string {
  return `aurora-lifecycle:${websiteId}`
}

export function isAuroraLeaseActive(
  expiresAt: string | null,
  now = Date.now()
): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > now)
}

async function loadLease(
  identity: AuroraLifecycleIdentity,
  client: ServiceClient
) {
  const { data, error } = await client
    .from('shared_jobs')
    .select(
      'id, org_id, property_id, lifecycle_status, lease_owner, lease_expires_at, payload, output, created_at, updated_at'
    )
    .eq('domain', AURORA_LIFECYCLE_DOMAIN)
    .eq('dedupe_key', leaseDedupeKey(identity.websiteId))
    .maybeSingle()
  if (error) {
    fail('Failed to load Aurora lifecycle lease', 500, 'lease_lookup_failed')
  }
  return data
}

function leasePayload(
  identity: AuroraLifecycleIdentity,
  prior: Json | null | undefined
): Json {
  const record =
    prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {}
  return {
    ...record,
    ownerId: identity.ownerId,
    propertyId: identity.propertyId,
    websiteId: identity.websiteId,
    targetId: identity.targetId,
    rolloutAssignmentId: identity.rolloutAssignmentId,
    expiresAt: identity.expiresAt,
    resourceTags: {
      lifecycleOwnerId: identity.ownerId,
      lifecycleRunId: identity.ownerId,
    },
    phase:
      typeof record.phase === 'string' ? record.phase : ('bootstrap' as const),
  }
}

export async function acquireOrRenewAuroraLifecycleLease(
  identity: AuroraLifecycleIdentity,
  actorId: string,
  operation: 'acquire' | 'renew',
  client: ServiceClient = createServiceClient()
) {
  const expiresAt = new Date(identity.expiresAt)
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() ||
    expiresAt.getTime() > Date.now() + 24 * 60 * 60_000
  ) {
    fail(
      'Aurora lifecycle lease expiry must be within the next 24 hours',
      400,
      'invalid_lease_expiry'
    )
  }
  const exact = await loadExactAuroraIdentity(identity, client, 'bootstrap')
  const orgId = exact.property.org_id
  if (!orgId) {
    fail(
      'Aurora property tenant identity is incomplete',
      409,
      'tenant_mismatch'
    )
  }
  let lease = await loadLease(identity, client)
  const now = new Date().toISOString()
  if (!lease) {
    if (operation === 'renew') {
      fail('Aurora lifecycle lease does not exist', 409, 'lease_not_found')
    }
    const created = await client
      .from('shared_jobs')
      .insert({
        org_id: orgId,
        property_id: identity.propertyId,
        domain: AURORA_LIFECYCLE_DOMAIN,
        subject_type: 'property_website',
        subject_id: identity.websiteId,
        lifecycle_status: 'running',
        status_reason: 'aurora_run_tracking_active',
        dedupe_key: leaseDedupeKey(identity.websiteId),
        payload: leasePayload(identity, null),
        lease_owner: identity.ownerId,
        lease_expires_at: identity.expiresAt,
        heartbeat_at: now,
        started_at: now,
        max_attempts: 1,
      })
      .select('*')
      .maybeSingle()
    if (created.error && created.error.code !== '23505') {
      fail(
        'Failed to acquire Aurora lifecycle lease',
        500,
        'lease_acquire_failed'
      )
    }
    lease = created.data || (await loadLease(identity, client))
  }
  if (!lease) {
    fail(
      'Aurora lifecycle lease could not be reconciled',
      409,
      'lease_conflict'
    )
  }
  const active = isAuroraLeaseActive(lease.lease_expires_at)
  if (active && lease.lease_owner !== identity.ownerId) {
    fail(
      'Another owner holds the Aurora lifecycle lease',
      409,
      'lease_owner_conflict'
    )
  }
  if (operation === 'renew' && lease.lease_owner !== identity.ownerId) {
    fail(
      'Only the current owner can renew the Aurora lifecycle lease',
      409,
      'lease_owner_conflict'
    )
  }
  if (
    lease.lease_owner !== identity.ownerId ||
    !sameInstant(lease.lease_expires_at, identity.expiresAt) ||
    lease.lifecycle_status !== 'running'
  ) {
    let update = client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        status_reason: 'aurora_run_tracking_active',
        lease_owner: identity.ownerId,
        lease_expires_at: identity.expiresAt,
        heartbeat_at: now,
        finished_at: null,
        error_message: null,
        output:
          operation === 'acquire' && lease.lifecycle_status === 'cancelled'
            ? { phase: 'bootstrap' }
            : lease.output,
        payload: leasePayload(identity, lease.payload),
        updated_at: now,
      })
      .eq('id', lease.id)
    update = active
      ? update.eq('lease_owner', identity.ownerId)
      : update.eq('updated_at', lease.updated_at)
    const updated = await update.select('*').maybeSingle()
    if (updated.error || !updated.data) {
      fail('Aurora lifecycle lease changed concurrently', 409, 'lease_conflict')
    }
    lease = updated.data
  }
  const actionType = `siteforge.aurora-lifecycle:${operation}`
  const { data: existingAction } = await client
    .from('shared_action_attempts')
    .select('id')
    .eq('job_id', lease.id)
    .eq('action_type', actionType)
    .maybeSingle()
  const actionValues: TablesInsert<'shared_action_attempts'> = {
    job_id: lease.id,
    org_id: orgId,
    property_id: identity.propertyId,
    action_type: actionType,
    lifecycle_status: 'succeeded',
    proposal_decision_status: 'approved',
    execution_status: 'executed',
    requested_by: actorId,
    request_payload: leasePayload(identity, null),
    execution_payload: { leaseId: lease.id } as Json,
    execution_result: {
      acquired: true,
      expiresAt: identity.expiresAt,
    } as Json,
    confidence_score: 1,
    policy_reason: 'Explicit authenticated Aurora lifecycle control',
    executed_at: now,
  }
  const actionResult = existingAction
    ? await client
        .from('shared_action_attempts')
        .update(actionValues)
        .eq('id', existingAction.id)
    : await client.from('shared_action_attempts').insert(actionValues)
  if (actionResult.error) {
    fail(
      'Aurora lifecycle lease was acquired but its action ledger failed',
      500,
      'action_ledger_failed'
    )
  }
  return lease
}

export async function assertActiveAuroraLifecycleLease(
  request: Request,
  expected?: Partial<AuroraLifecycleIdentity>,
  client?: ServiceClient,
  requiredPhase: AuroraLifecyclePhase | 'any' = 'mutation'
): Promise<AuroraLifecycleIdentity | null> {
  const identity = identityFromHeaders(request)
  if (!identity) {
    return null
  }
  const service = client || createServiceClient()
  requireAuroraLifecycleBearer(request)
  for (const [key, value] of Object.entries(expected || {})) {
    if (value && identity[key as keyof AuroraLifecycleIdentity] !== value) {
      fail(
        `Aurora lifecycle ${key} does not match the requested resource`,
        409,
        'request_identity_mismatch'
      )
    }
  }
  const lease = await loadLease(identity, service)
  if (
    !lease ||
    lease.lifecycle_status !== 'running' ||
    lease.lease_owner !== identity.ownerId
  ) {
    fail(
      'Aurora lifecycle lease is not owned by this run',
      409,
      'lease_not_owned'
    )
  }
  if (
    !lease.lease_expires_at ||
    new Date(lease.lease_expires_at).getTime() <= Date.now() ||
    !sameInstant(lease.lease_expires_at, identity.expiresAt)
  ) {
    fail('Aurora lifecycle lease has expired', 409, 'lease_expired')
  }
  const output =
    lease.output &&
    typeof lease.output === 'object' &&
    !Array.isArray(lease.output)
      ? lease.output
      : {}
  const phase = output.phase === 'mutation' ? 'mutation' : 'bootstrap'
  await loadExactAuroraIdentity(identity, service, phase)
  if (requiredPhase !== 'any' && phase !== requiredPhase) {
    fail(
      requiredPhase === 'mutation'
        ? 'Aurora bootstrap prerequisites are not complete'
        : 'Aurora lifecycle bootstrap is already complete',
      409,
      requiredPhase === 'mutation'
        ? 'bootstrap_incomplete'
        : 'bootstrap_already_complete'
    )
  }
  return identity
}

export async function transitionAuroraLifecycleToMutation(
  identity: AuroraLifecycleIdentity,
  client: ServiceClient = createServiceClient()
) {
  const lease = await loadLease(identity, client)
  if (
    !lease ||
    lease.lifecycle_status !== 'running' ||
    lease.lease_owner !== identity.ownerId ||
    !lease.lease_expires_at ||
    new Date(lease.lease_expires_at).getTime() <= Date.now()
  ) {
    fail('Aurora lifecycle lease is not active', 409, 'lease_not_owned')
  }
  const output =
    lease.output &&
    typeof lease.output === 'object' &&
    !Array.isArray(lease.output)
      ? lease.output
      : {}
  if (output.phase === 'mutation') return lease
  assertAuroraMutationPrerequisites(output)
  if (process.env.SITEFORGE_RUNTIME_V3_ENABLED !== 'true') {
    fail(
      'Runtime v3 must be enabled before Aurora mutation activation',
      409,
      'runtime_v3_disabled'
    )
  }
  const [
    { data: artifacts, error: artifactsError },
    { data: targets, error: targetsError },
    { data: rollouts, error: rolloutsError },
  ] = await Promise.all([
    client
      .from('siteforge_blueprint_versions')
      .select('id, runtime_contract_version, remote_verified_at')
      .eq('website_id', identity.websiteId)
      .in('id', [
        output.rollbackArtifactId as string,
        output.startArtifactId as string,
      ]),
    client
      .from('siteforge_wordpress_targets')
      .select('id, target_type, metadata')
      .eq('website_id', identity.websiteId)
      .in('id', [
        output.stagingTargetId as string,
        output.productionTargetId as string,
      ]),
    client
      .from('siteforge_runtime_target_rollouts')
      .select(
        'id, target_id, requested_contract_version, runtime_package_sha256, status, activated_at, rolled_back_at'
      )
      .eq('website_id', identity.websiteId)
      .in('id', [
        identity.rolloutAssignmentId,
        output.stagingRolloutId as string,
        output.productionRolloutId as string,
      ]),
  ])
  const rollback = artifacts?.find(
    (artifact) => artifact.id === output.rollbackArtifactId
  )
  const start = artifacts?.find(
    (artifact) => artifact.id === output.startArtifactId
  )
  const staging = targets?.find(
    (target) =>
      target.id === output.stagingTargetId && target.target_type === 'staging'
  )
  const production = targets?.find(
    (target) =>
      target.id === output.productionTargetId &&
      target.target_type === 'production'
  )
  const stagingRollout = rollouts?.find(
    (rollout) =>
      rollout.id === output.stagingRolloutId &&
      rollout.target_id === output.stagingTargetId
  )
  const productionRollout = rollouts?.find(
    (rollout) =>
      rollout.id === output.productionRolloutId &&
      rollout.target_id === output.productionTargetId
  )
  const anchorRollout = rollouts?.find(
    (rollout) =>
      rollout.id === identity.rolloutAssignmentId &&
      rollout.target_id === identity.targetId
  )
  if (
    artifactsError ||
    targetsError ||
    rolloutsError ||
    !rollback?.remote_verified_at ||
    start?.runtime_contract_version !== 3 ||
    !staging ||
    !production ||
    !isAuroraOwnedMetadata(staging.metadata, identity.ownerId) ||
    !isAuroraOwnedMetadata(production.metadata, identity.ownerId) ||
    !anchorRollout ||
    anchorRollout.requested_contract_version !== 3 ||
    anchorRollout.runtime_package_sha256 !== output.runtimePackageSha256 ||
    anchorRollout.status !== 'paused' ||
    stagingRollout?.requested_contract_version !== 3 ||
    stagingRollout.status !== 'paused' ||
    productionRollout?.requested_contract_version !== 3 ||
    productionRollout.status !== 'paused'
  ) {
    fail(
      'Aurora bootstrap resource identities failed activation readback',
      409,
      'bootstrap_incomplete'
    )
  }
  const now = new Date().toISOString()
  const rolloutIds = [
    identity.rolloutAssignmentId,
    output.stagingRolloutId as string,
    output.productionRolloutId as string,
  ]
  const { data: activatedRollouts, error: activationError } = await client
    .from('siteforge_runtime_target_rollouts')
    .update({
      status: 'enabled',
      activated_at: now,
      rolled_back_at: null,
      updated_at: now,
    })
    .in('id', rolloutIds)
    .eq('website_id', identity.websiteId)
    .select('id')
  if (
    activationError ||
    new Set((activatedRollouts || []).map(rollout => rollout.id)).size !==
      rolloutIds.length
  ) {
    fail(
      'Aurora runtime rollout assignments could not be activated atomically',
      409,
      'rollout_activation_failed'
    )
  }
  const { data, error } = await client
    .from('shared_jobs')
    .update({
      output: {
        ...output,
        phase: 'mutation',
        mutationActivatedAt: now,
        anchorRolloutPrior: {
          status: anchorRollout.status,
          activatedAt: anchorRollout.activated_at,
          rolledBackAt: anchorRollout.rolled_back_at,
        },
      },
      status_reason: 'aurora_mutation_tracking_active',
      updated_at: now,
    })
    .eq('id', lease.id)
    .eq('lease_owner', identity.ownerId)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    fail('Aurora lifecycle phase changed concurrently', 409, 'lease_conflict')
  }
  return data
}

export function assertAuroraMutationPrerequisites(
  output: Record<string, Json | undefined>
): void {
  const required = [
    'rollbackArtifactId',
    'rollbackContentHash',
    'startArtifactId',
    'startContentHash',
    'stagingTargetId',
    'productionTargetId',
    'stagingRolloutId',
    'productionRolloutId',
    'backupOperationId',
    'backupId',
    'backupVerifiedAt',
  ]
  const missing = required.filter((key) => !output[key])
  if (missing.length) {
    fail(
      `Aurora bootstrap prerequisites are incomplete: ${missing.join(', ')}`,
      409,
      'bootstrap_incomplete'
    )
  }
}

export async function releaseAuroraLifecycleLease(
  identity: AuroraLifecycleIdentity,
  client: ServiceClient = createServiceClient()
): Promise<void> {
  const lease = await loadLease(identity, client)
  if (!lease || lease.lease_owner !== identity.ownerId) {
    fail(
      'Aurora lifecycle lease is not owned by this run',
      409,
      'lease_not_owned'
    )
  }
  const { data, error } = await client
    .from('shared_jobs')
    .update({
      lifecycle_status: 'cancelled',
      status_reason: 'aurora_run_tracking_released',
      lease_owner: null,
      lease_expires_at: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', lease.id)
    .eq('lease_owner', identity.ownerId)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    fail('Aurora lifecycle lease changed concurrently', 409, 'lease_conflict')
  }
}

export async function registerAuroraOwnedResource(
  identity: AuroraLifecycleIdentity | null,
  resource: { kind: string; id: string },
  client: ServiceClient = createServiceClient()
): Promise<void> {
  if (!identity) return
  const lease = await loadLease(identity, client)
  if (
    !lease ||
    lease.lifecycle_status !== 'running' ||
    lease.lease_owner !== identity.ownerId ||
    !lease.lease_expires_at ||
    new Date(lease.lease_expires_at).getTime() <= Date.now()
  ) {
    fail(
      'Cannot register a resource without an active owned lifecycle lease',
      409,
      'lease_expired'
    )
  }
  const output =
    lease.output &&
    typeof lease.output === 'object' &&
    !Array.isArray(lease.output)
      ? lease.output
      : {}
  const resources = Array.isArray(output.ownedResources)
    ? output.ownedResources.filter(
        (value): value is { kind: string; id: string } =>
          Boolean(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof value.kind === 'string' &&
            typeof value.id === 'string'
          )
      )
    : []
  if (
    !resources.some(
      (item) => item.kind === resource.kind && item.id === resource.id
    )
  ) {
    resources.push(resource)
  }
  const { data, error } = await client
    .from('shared_jobs')
    .update({
      output: { ...output, ownedResources: resources },
      updated_at: new Date().toISOString(),
    })
    .eq('id', lease.id)
    .eq('lease_owner', identity.ownerId)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    fail(
      'Failed to register the owned Aurora lifecycle resource',
      500,
      'resource_registration_failed'
    )
  }
}

export function auroraOwnedMetadata(
  identity: AuroraLifecycleIdentity,
  existing?: Json | null
): Json {
  const record =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {}
  return {
    ...record,
    lifecycleOwnerId: identity.ownerId,
    lifecycleRunId: identity.ownerId,
    lifecycleExpiresAt: identity.expiresAt,
  }
}

export function isAuroraOwnedMetadata(
  metadata: Json | null,
  ownerId: string
): boolean {
  return Boolean(
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    metadata.lifecycleOwnerId === ownerId &&
    metadata.lifecycleRunId === ownerId
  )
}
