import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  getConfiguredDnsProvider,
  type DnsInventory,
  type DnsProvider,
  type DnsRecordIdentity,
} from '@/utils/siteforge/providers/dns-provider'
import { SiteForgeLaunchError } from './repository'

type ServiceClient = SupabaseClient<Database>
type DnsSnapshot = Tables<'siteforge_dns_snapshots'>

export type ApexWwwPolicy = 'apex' | 'www' | 'custom'

const dnsRecordSchema = z.object({
  provider: z.literal('cloudflare'),
  zoneId: z.string().min(1),
  recordId: z.string().min(1),
  type: z.enum(['A', 'AAAA', 'CNAME']),
  hostname: z.string().min(1),
  content: z.string().min(1),
  ttl: z.number().int().positive(),
  proxied: z.boolean(),
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function resolveDnsHostPolicy(
  targetDomain: string,
  requestedPolicy?: ApexWwwPolicy
): {
  canonicalHostname: string
  hostnames: string[]
  policy: ApexWwwPolicy
} {
  const hostname = targetDomain.trim().toLowerCase()
  const labels = hostname.split('.')
  const inferred: ApexWwwPolicy = hostname.startsWith('www.')
    ? 'www'
    : labels.length === 2
      ? 'apex'
      : 'custom'
  const policy = requestedPolicy || inferred
  if (policy === 'custom') {
    return { canonicalHostname: hostname, hostnames: [hostname], policy }
  }
  const apex = hostname.startsWith('www.') ? hostname.slice(4) : hostname
  if (apex.split('.').length < 2) {
    throw new SiteForgeLaunchError('A valid apex domain is required', 400)
  }
  const www = `www.${apex}`
  return {
    canonicalHostname: policy === 'www' ? www : apex,
    hostnames: [apex, www].sort(),
    policy,
  }
}

export function buildDnsDesiredRecords(input: {
  inventory: DnsInventory
  hostnames: string[]
  address: string
  ttl: number
}): Array<{
  hostname: string
  address: string
  ttl: number
  recordId?: string
}> {
  return input.hostnames.map(hostname => {
    const records = input.inventory.records.filter(
      record => record.hostname === hostname
    )
    if (records.some(record => record.type !== 'A')) {
      throw new SiteForgeLaunchError(
        `DNS cutover for ${hostname} conflicts with an existing non-A record`,
        409
      )
    }
    if (records.length > 1) {
      throw new SiteForgeLaunchError(
        `DNS cutover for ${hostname} requires one exact record identity`,
        409
      )
    }
    return {
      hostname,
      address: input.address,
      ttl: input.ttl,
      ...(records[0] ? { recordId: records[0].recordId } : {}),
    }
  })
}

function snapshotPolicy(snapshot: DnsSnapshot): ApexWwwPolicy | undefined {
  const report = asRecord(snapshot.propagation_report)
  return report.apexWwwPolicy === 'apex' ||
    report.apexWwwPolicy === 'www' ||
    report.apexWwwPolicy === 'custom'
    ? report.apexWwwPolicy
    : undefined
}

async function requireDnsProvider(): Promise<DnsProvider> {
  const provider = getConfiguredDnsProvider()
  if (!provider) {
    throw new SiteForgeLaunchError(
      'A configured DNS provider is required for production cutover',
      503
    )
  }
  return provider
}

export async function captureDomainDnsInventory(
  input: {
    websiteId: string
    propertyId: string
    targetDomain: string
    apexWwwPolicy: ApexWwwPolicy
    actorId: string
  },
  client: ServiceClient = createServiceClient()
) {
  const { data: website, error } = await client
    .from('property_websites')
    .select('id, org_id, property_id')
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (error || !website) {
    throw new SiteForgeLaunchError('Website not found', 404)
  }
  const policy = resolveDnsHostPolicy(
    input.targetDomain,
    input.apexWwwPolicy
  )
  const provider = await requireDnsProvider()
  const inventory = await provider.readInventory(policy.hostnames)
  const capturedAt = inventory.capturedAt
  const { data: snapshot, error: snapshotError } = await client
    .from('siteforge_dns_snapshots')
    .insert({
      org_id: website.org_id,
      property_id: website.property_id,
      website_id: website.id,
      release_id: null,
      provider: inventory.provider,
      domain: policy.canonicalHostname,
      record_manifest: inventory.records as unknown as Json,
      rollback_manifest: inventory.records as unknown as Json,
      ownership_evidence: {
        verified: true,
        verifiedAt: capturedAt,
        verifiedBy: input.actorId,
        zone: inventory.zone,
        requestedHostnames: policy.hostnames,
      } as unknown as Json,
      propagation_report: {
        phase: 'inventory',
        apexWwwPolicy: policy.policy,
        canonicalHostname: policy.canonicalHostname,
        intendedTtlSeconds: 300,
        ttlLoweringIntent: true,
        mutationPerformed: false,
      } as Json,
      captured_at: capturedAt,
    })
    .select('*')
    .single()
  if (snapshotError || !snapshot) {
    throw new SiteForgeLaunchError(
      `Failed to persist DNS inventory: ${snapshotError?.message || 'missing row'}`,
      500
    )
  }
  return { snapshot, policy, inventory }
}

async function loadOrCaptureReleaseSnapshot(
  input: {
    releaseId: string
    websiteId: string
    propertyId: string
    orgId: string
    targetDomain: string
    actorId: string
  },
  provider: DnsProvider,
  client: ServiceClient
): Promise<{
  snapshot: DnsSnapshot
  inventory: DnsInventory
  policy: ReturnType<typeof resolveDnsHostPolicy>
}> {
  const { data: existing, error: existingError } = await client
    .from('siteforge_dns_snapshots')
    .select('*')
    .eq('website_id', input.websiteId)
    .eq('release_id', input.releaseId)
    .eq('domain', input.targetDomain)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) {
    throw new SiteForgeLaunchError(
      `Failed to load the DNS rollback manifest: ${existingError.message}`,
      500
    )
  }
  if (existing) {
    const policy = resolveDnsHostPolicy(
      input.targetDomain,
      snapshotPolicy(existing)
    )
    const inventory = await provider.readInventory(policy.hostnames)
    const ownership = asRecord(existing.ownership_evidence)
    const zone = asRecord(ownership.zone)
    if (
      ownership.verified !== true ||
      zone.zoneId !== inventory.zone.zoneId ||
      zone.accountId !== inventory.zone.accountId
    ) {
      throw new SiteForgeLaunchError(
        'Persisted DNS ownership does not match the configured provider identity',
        409
      )
    }
    return { snapshot: existing, inventory, policy }
  }

  const { data: intent } = await client
    .from('siteforge_dns_snapshots')
    .select('*')
    .eq('website_id', input.websiteId)
    .is('release_id', null)
    .eq('domain', input.targetDomain)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const policy = resolveDnsHostPolicy(
    input.targetDomain,
    intent ? snapshotPolicy(intent) : undefined
  )
  const inventory = await provider.readInventory(policy.hostnames)
  const capturedAt = inventory.capturedAt
  const inserted = await client
    .from('siteforge_dns_snapshots')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      release_id: input.releaseId,
      provider: inventory.provider,
      domain: policy.canonicalHostname,
      record_manifest: inventory.records as unknown as Json,
      rollback_manifest: inventory.records as unknown as Json,
      ownership_evidence: {
        verified: true,
        verifiedAt: capturedAt,
        verifiedBy: input.actorId,
        zone: inventory.zone,
        requestedHostnames: policy.hostnames,
      } as unknown as Json,
      propagation_report: {
        phase: 'pre_mutation',
        apexWwwPolicy: policy.policy,
        canonicalHostname: policy.canonicalHostname,
        intendedTtlSeconds: 300,
        ttlLoweringIntent: true,
        mutationPerformed: false,
      } as Json,
      captured_at: capturedAt,
    })
    .select('*')
    .single()
  if (inserted.error || !inserted.data) {
    throw new SiteForgeLaunchError(
      `DNS mutation is blocked because its rollback manifest was not persisted: ${
        inserted.error?.message || 'missing row'
      }`,
      500
    )
  }
  return { snapshot: inserted.data, inventory, policy }
}

async function ensureDnsSharedAction(
  input: {
    releaseId: string
    websiteId: string
    propertyId: string
    orgId: string
    actorId: string
    reviewerId: string
    artifactId: string
    contentHash: string
    stagingDeploymentId: string
    launchApprovalId: string
    backupId: string
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
    snapshotId: string
    desiredRecords: ReturnType<typeof buildDnsDesiredRecords>
  },
  client: ServiceClient
): Promise<{ jobId: string; actionId: string }> {
  const dedupeKey = `siteforge-launch:dns-cutover:${input.releaseId}`
  let { data: job } = await client
    .from('shared_jobs')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('domain', 'siteforge.launch.dns-cutover')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (!job) {
    const created = await client
      .from('shared_jobs')
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        domain: 'siteforge.launch.dns-cutover',
        subject_type: 'siteforge_launch_release',
        subject_id: input.releaseId,
        lifecycle_status: 'running',
        status_reason: 'dns_snapshot_persisted',
        dedupe_key: dedupeKey,
        payload: {
          releaseId: input.releaseId,
          websiteId: input.websiteId,
          snapshotId: input.snapshotId,
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          stagingDeploymentId: input.stagingDeploymentId,
          launchApprovalId: input.launchApprovalId,
          backupId: input.backupId,
          rollbackArtifactId: input.rollbackArtifactId,
          rollbackContentHash: input.rollbackContentHash,
          desiredRecords: input.desiredRecords,
        } as unknown as Json,
        max_attempts: 10,
      })
      .select('id')
      .maybeSingle()
    if (created.error && created.error.code !== '23505') {
      throw new SiteForgeLaunchError(
        `Failed to audit the DNS cutover claim: ${created.error.message}`,
        500
      )
    }
    job = created.data
    if (!job) {
      const concurrent = await client
        .from('shared_jobs')
        .select('id')
        .eq('org_id', input.orgId)
        .eq('domain', 'siteforge.launch.dns-cutover')
        .eq('dedupe_key', dedupeKey)
        .single()
      job = concurrent.data
    }
  }
  if (!job) {
    throw new SiteForgeLaunchError('Failed to reconcile DNS cutover audit', 500)
  }
  let { data: action } = await client
    .from('shared_action_attempts')
    .select('id, requested_by, reviewed_by, request_payload')
    .eq('job_id', job.id)
    .eq('action_type', 'siteforge.launch:dns_cutover')
    .maybeSingle()
  if (!action) {
    const created = await client
      .from('shared_action_attempts')
      .insert({
        job_id: job.id,
        org_id: input.orgId,
        property_id: input.propertyId,
        action_type: 'siteforge.launch:dns_cutover',
        lifecycle_status: 'running',
        proposal_decision_status: 'approved',
        execution_status: 'running',
        requested_by: input.actorId,
        reviewed_by: input.reviewerId,
        request_payload: {
          releaseId: input.releaseId,
          websiteId: input.websiteId,
          snapshotId: input.snapshotId,
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          stagingDeploymentId: input.stagingDeploymentId,
          launchApprovalId: input.launchApprovalId,
          backupId: input.backupId,
          rollbackArtifactId: input.rollbackArtifactId,
          rollbackContentHash: input.rollbackContentHash,
          desiredRecords: input.desiredRecords,
        } as unknown as Json,
        execution_payload: {
          snapshotId: input.snapshotId,
          mutationPolicy: 'idempotent-upsert-only',
        } as Json,
        rollback_metadata: {
          dnsSnapshotId: input.snapshotId,
          backupId: input.backupId,
          rollbackArtifactId: input.rollbackArtifactId,
          rollbackContentHash: input.rollbackContentHash,
          destructiveProviderCallsAllowed: false,
        } as Json,
        policy_reason:
          'The exact DNS rollback manifest was persisted before idempotent record upserts.',
        confidence_score: 1,
        decided_at: new Date().toISOString(),
      })
      .select('id, requested_by, reviewed_by, request_payload')
      .single()
    if (created.error || !created.data) {
      throw new SiteForgeLaunchError(
        'Failed to persist the shared DNS action audit',
        500
      )
    }
    action = created.data
  } else {
    const requestPayload = asRecord(action.request_payload)
    if (
      action.requested_by !== input.actorId ||
      action.reviewed_by !== input.reviewerId ||
      requestPayload.snapshotId !== input.snapshotId ||
      requestPayload.artifactId !== input.artifactId ||
      requestPayload.contentHash !== input.contentHash ||
      requestPayload.backupId !== input.backupId
    ) {
      throw new SiteForgeLaunchError(
        'Existing DNS cutover audit does not match the exact approved identity',
        409
      )
    }
  }
  return { jobId: job.id, actionId: action.id }
}

export async function executeDnsCutover(
  input: {
    releaseId: string
    websiteId: string
    propertyId: string
    orgId: string
    targetDomain: string
    address: string
    actorId: string
  },
  client: ServiceClient = createServiceClient(),
  providerOverride?: DnsProvider
) {
  const provider = providerOverride || (await requireDnsProvider())
  const prepared = await prepareDnsCutover(input, client, provider)
  const desiredRecords = buildDnsDesiredRecords({
    inventory: prepared.inventory,
    hostnames: prepared.policy.hostnames,
    address: input.address,
    ttl: 300,
  })
  const { data: release, error: releaseError } = await client
    .from('siteforge_launch_releases')
    .select(
      'id, state, created_by, approved_by, artifact_id, artifact_content_hash, staging_deployment_id, launch_approval_id, backup_id, rollback_artifact_id, rollback_content_hash'
    )
    .eq('id', input.releaseId)
    .eq('website_id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (
    releaseError ||
    !release ||
    release.state !== 'promoted' ||
    !release.created_by ||
    !release.approved_by ||
    release.created_by === release.approved_by ||
    release.created_by !== input.actorId ||
    !release.staging_deployment_id ||
    !release.launch_approval_id ||
    !release.backup_id
  ) {
    throw new SiteForgeLaunchError(
      'DNS cutover requires the exact promoted release, separate reviewer, certification, and backup identities',
      409
    )
  }
  const audit = await ensureDnsSharedAction(
    {
      ...input,
      reviewerId: release.approved_by,
      artifactId: release.artifact_id,
      contentHash: release.artifact_content_hash,
      stagingDeploymentId: release.staging_deployment_id,
      launchApprovalId: release.launch_approval_id,
      backupId: release.backup_id,
      rollbackArtifactId: release.rollback_artifact_id,
      rollbackContentHash: release.rollback_content_hash,
      snapshotId: prepared.snapshot.id,
      desiredRecords,
    },
    client
  )

  const identities: DnsRecordIdentity[] = []
  for (const desired of desiredRecords) {
    identities.push(await provider.upsertAddressRecord(desired))
  }
  const propagation = await provider.probePropagation({
    hostnames: prepared.policy.hostnames,
    expectedAddress: input.address,
  })
  const report = {
    phase: propagation.propagated ? 'propagated' : 'propagation_pending',
    apexWwwPolicy: prepared.policy.policy,
    canonicalHostname: prepared.policy.canonicalHostname,
    intendedTtlSeconds: 300,
    ttlLoweringIntent: true,
    mutationPerformed: true,
    desiredRecords,
    appliedRecords: identities,
    propagation,
    sharedJobId: audit.jobId,
    sharedActionAttemptId: audit.actionId,
  } as unknown as Json
  const completedAt = new Date().toISOString()
  const [{ error: snapshotError }, { error: jobError }, { error: actionError }] =
    await Promise.all([
      client
        .from('siteforge_dns_snapshots')
        .update({ propagation_report: report })
        .eq('id', prepared.snapshot.id)
        .eq('release_id', input.releaseId),
      client
        .from('shared_jobs')
        .update({
          lifecycle_status: propagation.propagated ? 'succeeded' : 'retrying',
          status_reason: propagation.propagated
            ? 'dns_propagated'
            : 'dns_propagation_pending',
          output: report,
          progress: propagation.propagated ? 100 : 75,
          current_step: propagation.propagated
            ? 'DNS cutover propagated'
            : 'Waiting for public DNS propagation',
          finished_at: propagation.propagated ? completedAt : null,
          updated_at: completedAt,
        })
        .eq('id', audit.jobId),
      client
        .from('shared_action_attempts')
        .update({
          lifecycle_status: propagation.propagated ? 'succeeded' : 'running',
          execution_status: propagation.propagated ? 'succeeded' : 'running',
          execution_result: report,
          executed_at: propagation.propagated ? completedAt : null,
          updated_at: completedAt,
        })
        .eq('id', audit.actionId),
    ])
  if (snapshotError || jobError || actionError) {
    throw new SiteForgeLaunchError(
      `DNS changed but its exact provider identity could not be checkpointed: ${
        snapshotError?.message || jobError?.message || actionError?.message
      }`,
      500
    )
  }
  return {
    snapshotId: prepared.snapshot.id,
    canonicalHostname: prepared.policy.canonicalHostname,
    recordIdentities: identities,
    propagation,
  }
}

export async function prepareDnsCutover(
  input: {
    releaseId: string
    websiteId: string
    propertyId: string
    orgId: string
    targetDomain: string
    address: string
    actorId: string
  },
  client: ServiceClient = createServiceClient(),
  providerOverride?: DnsProvider
) {
  const provider = providerOverride || (await requireDnsProvider())
  const prepared = await loadOrCaptureReleaseSnapshot(
    input,
    provider,
    client
  )
  return {
    ...prepared,
    desiredRecords: buildDnsDesiredRecords({
      inventory: prepared.inventory,
      hostnames: prepared.policy.hostnames,
      address: input.address,
      ttl: 300,
    }),
  }
}

export async function restoreDnsCutover(
  input: {
    releaseId: string
    websiteId: string
    actorId: string
  },
  client: ServiceClient = createServiceClient(),
  providerOverride?: DnsProvider
) {
  const { data: snapshot, error } = await client
    .from('siteforge_dns_snapshots')
    .select('*')
    .eq('website_id', input.websiteId)
    .eq('release_id', input.releaseId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !snapshot) {
    throw new SiteForgeLaunchError(
      'The exact pre-cutover DNS rollback manifest is unavailable',
      409
    )
  }
  if (snapshot.restored_at) {
    return {
      snapshot,
      manualRequired: false as const,
      propagationPending: false as const,
      manualRemovalRecordIds: [] as string[],
      idempotent: true,
    }
  }
  const provider = providerOverride || (await requireDnsProvider())
  const rollbackRecords = z
    .array(dnsRecordSchema)
    .parse(snapshot.rollback_manifest)
  const policy = resolveDnsHostPolicy(snapshot.domain, snapshotPolicy(snapshot))
  const current = await provider.readInventory(policy.hostnames)
  const ownership = asRecord(snapshot.ownership_evidence)
  const snapshotZone = asRecord(ownership.zone)
  if (
    ownership.verified !== true ||
    snapshotZone.zoneId !== current.zone.zoneId ||
    snapshotZone.accountId !== current.zone.accountId ||
    rollbackRecords.some(record => record.zoneId !== current.zone.zoneId)
  ) {
    throw new SiteForgeLaunchError(
      'DNS restore provider ownership does not match the captured rollback identity',
      409
    )
  }
  const originalARecords = rollbackRecords.filter(record => record.type === 'A')
  const createdRecords = current.records.filter(
    record =>
      record.type === 'A' &&
      policy.hostnames.includes(record.hostname) &&
      !rollbackRecords.some(original => original.recordId === record.recordId)
  )
  for (const record of originalARecords) {
    await provider.upsertAddressRecord({
      hostname: record.hostname,
      address: record.content,
      recordId: record.recordId,
      ttl: record.ttl,
    })
  }
  const restorePropagation = await Promise.all(
    originalARecords.map(record =>
      provider.probePropagation({
        hostnames: [record.hostname],
        expectedAddress: record.content,
      })
    )
  )
  const manualRequired = createdRecords.length > 0
  const propagationPending = restorePropagation.some(
    report => !report.propagated
  )
  const exactRestoreCompleted = !manualRequired && !propagationPending
  const restoredAt = new Date().toISOString()
  const restoreReport = {
    ...asRecord(snapshot.propagation_report),
    restore: {
      requestedAt: restoredAt,
      requestedBy: input.actorId,
      restoredRecordIds: originalARecords.map(record => record.recordId),
      manualRemovalRecordIds: createdRecords.map(record => record.recordId),
      propagation: restorePropagation,
      destructiveProviderCallsPerformed: false,
      exactRestoreCompleted,
    },
  } as unknown as Json
  const { data: updated, error: updateError } = await client
    .from('siteforge_dns_snapshots')
    .update({
      propagation_report: restoreReport,
      restored_at: exactRestoreCompleted ? restoredAt : null,
    })
    .eq('id', snapshot.id)
    .is('restored_at', null)
    .select('*')
    .single()
  if (updateError || !updated) {
    throw new SiteForgeLaunchError(
      'Failed to checkpoint the DNS restore posture',
      500
    )
  }
  return {
    snapshot: updated,
    manualRequired,
    propagationPending,
    idempotent: false,
    manualRemovalRecordIds: createdRecords.map(record => record.recordId),
  }
}
