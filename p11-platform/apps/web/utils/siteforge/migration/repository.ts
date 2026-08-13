import { createHmac, timingSafeEqual } from 'node:crypto'
import type { z } from 'zod'
import type { Json, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import { recordSharedApprovalDecision } from '@/utils/services/shared-approvals'
import {
  parityReportSchema,
  postLaunchVerificationInputSchema,
  siteForgeMigrationManifestInputSchema,
  unmigratedItemSchema,
  type SiteForgeMigrationManifestInput,
} from './contracts'

type ServiceClient = ReturnType<typeof createServiceClient>
type MigrationRow =
  DatabaseMigrationTables['siteforge_migration_manifests']['Row']
type DatabaseMigrationTables = {
  siteforge_migration_manifests: import('@/types/supabase').Database['public']['Tables']['siteforge_migration_manifests']
}

export class SiteForgeMigrationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeMigrationError'
  }
}

type MigrationLifecycleStatus =
  | 'ready_for_review'
  | 'approved'
  | 'imported'
  | 'verified'
  | 'failed'

const MIGRATION_STATUS_TRANSITIONS = {
  ready_for_review: ['approved', 'failed'],
  approved: ['imported'],
  imported: ['verified', 'failed'],
  verified: [],
  failed: [],
} as const satisfies Readonly<
  Record<MigrationLifecycleStatus, readonly MigrationLifecycleStatus[]>
>

function assertMigrationStatusTransition(
  current: string,
  next: MigrationLifecycleStatus
) {
  const allowed: readonly MigrationLifecycleStatus[] =
    current in MIGRATION_STATUS_TRANSITIONS
      ? MIGRATION_STATUS_TRANSITIONS[current as MigrationLifecycleStatus]
      : []
  if (!allowed.includes(next)) {
    throw new SiteForgeMigrationError(
      `Invalid migration lifecycle transition: ${current} -> ${next}`,
      409
    )
  }
}

function manifestContent(input: SiteForgeMigrationManifestInput) {
  return {
    sourceUrl: input.sourceUrl,
    sourceReadOnly: input.sourceReadOnly,
    sourceInventory: input.sourceInventory,
    contentManifest: input.contentManifest,
    assetManifest: input.assetManifest,
    formManifest: input.formManifest,
    redirectMap: input.redirectMap,
    redirectDecisions: input.redirectDecisions,
    unmigratedItems: input.unmigratedItems,
    dnsSnapshot: input.dnsSnapshot,
    parityReport: input.parityReport,
  }
}

function migrationEvidenceSecret() {
  const secret = process.env.SITEFORGE_MIGRATION_MANIFEST_SECRET
  if (!secret || secret.length < 32) {
    throw new SiteForgeMigrationError(
      'Migration evidence verification is not configured',
      503
    )
  }
  return secret
}

function verifySignature(payload: unknown, signature: string) {
  const expected = createHmac('sha256', migrationEvidenceSecret())
    .update(canonicalizeSiteForgeContent(payload))
    .digest('hex')
  const suppliedBytes = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new SiteForgeMigrationError(
      'Migration crawler provenance signature is invalid',
      409
    )
  }
}

function verifyCrawlerManifest(input: SiteForgeMigrationManifestInput) {
  const contentHash = hashSiteForgeContent(manifestContent(input))
  const provenance = input.crawlerProvenance
  if (contentHash !== provenance.manifestHash) {
    throw new SiteForgeMigrationError(
      'Migration crawler manifest hash is stale or invalid',
      409
    )
  }
  verifySignature(
    {
      producer: provenance.producer,
      schemaVersion: provenance.schemaVersion,
      crawlId: provenance.crawlId,
      generatedAt: provenance.generatedAt,
      checkedUrlCount: provenance.checkedUrlCount,
      manifestHash: provenance.manifestHash,
      sourceUrl: input.sourceUrl,
    },
    provenance.signature
  )
  return contentHash
}

function verifyPostLaunchEvidence(
  verification: z.infer<typeof postLaunchVerificationInputSchema>,
  expectedManifestHash: string
) {
  if (verification.manifestHash !== expectedManifestHash) {
    throw new SiteForgeMigrationError(
      'Post-launch crawl is bound to a stale migration manifest',
      409
    )
  }
  if (hashSiteForgeContent(verification.evidence) !== verification.evidenceHash) {
    throw new SiteForgeMigrationError(
      'Post-launch crawl evidence hash is invalid',
      409
    )
  }
  if (verification.checkedUrls !== verification.evidence.length) {
    throw new SiteForgeMigrationError(
      'Post-launch crawl URL count does not match its evidence',
      409
    )
  }
  const expectedFailures = verification.evidence.filter(
    item =>
      !item.passed ||
      item.statusCode < 200 ||
      item.statusCode >= 400 ||
      verification.requiredChecks.some(check => item.checks[check] !== true)
  )
  if (
    hashSiteForgeContent(expectedFailures) !==
      hashSiteForgeContent(verification.failures) ||
    (expectedFailures.length === 0) !== (verification.status === 'passed')
  ) {
    throw new SiteForgeMigrationError(
      'Post-launch crawl failure classification is invalid',
      409
    )
  }
  verifySignature(
    {
      schemaVersion: verification.provenance.schemaVersion,
      crawlId: verification.provenance.crawlId,
      verifiedAt: verification.verifiedAt,
      checkedUrls: verification.checkedUrls,
      status: verification.status,
      requiredChecks: verification.requiredChecks,
      evidenceHash: verification.evidenceHash,
      failuresHash: hashSiteForgeContent(verification.failures),
      manifestHash: verification.manifestHash,
    },
    verification.provenance.signature
  )
}

function verifyStoredCrawlerManifest(manifest: MigrationRow) {
  if (
    !manifest.source_inventory ||
    typeof manifest.source_inventory !== 'object' ||
    Array.isArray(manifest.source_inventory)
  ) {
    throw new SiteForgeMigrationError(
      'Stored crawler provenance is missing',
      409
    )
  }
  const {
    crawlerProvenance,
    redirectDecisions,
    ...sourceInventory
  } = manifest.source_inventory as Record<string, Json | undefined>
  const parsed = siteForgeMigrationManifestInputSchema.safeParse({
    propertyId: manifest.property_id,
    crawlerProvenance,
    sourceUrl: manifest.source_url,
    sourceReadOnly: manifest.source_read_only,
    sourceInventory,
    contentManifest: manifest.content_manifest,
    assetManifest: manifest.asset_manifest,
    formManifest: manifest.form_manifest,
    redirectMap: manifest.redirect_map,
    redirectDecisions,
    unmigratedItems: manifest.unmigrated_items,
    dnsSnapshot: manifest.dns_snapshot,
    parityReport: manifest.parity_report,
    postLaunchCrawl: manifest.post_launch_crawl,
  })
  if (!parsed.success) {
    throw new SiteForgeMigrationError(
      'Stored migration manifest evidence is invalid',
      409
    )
  }
  if (verifyCrawlerManifest(parsed.data) !== manifest.content_hash) {
    throw new SiteForgeMigrationError(
      'Stored migration manifest no longer matches its crawler hash',
      409
    )
  }
}

async function loadWebsite(
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient
) {
  const { data, error } = await supabase
    .from('property_websites')
    .select('id, org_id, property_id')
    .eq('id', websiteId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeMigrationError('SiteForge website not found', 404)
  }
  return data
}

export async function listMigrationManifests(
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient = createServiceClient()
) {
  await loadWebsite(websiteId, propertyId, supabase)
  const { data, error } = await supabase
    .from('siteforge_migration_manifests')
    .select('*')
    .eq('website_id', websiteId)
    .eq('property_id', propertyId)
    .order('version', { ascending: false })
  if (error) {
    throw new SiteForgeMigrationError('Failed to load migration manifests', 500)
  }
  return data || []
}

async function createApprovalProposal(
  manifest: Pick<
    MigrationRow,
    'id' | 'org_id' | 'property_id' | 'website_id' | 'version' | 'content_hash'
  >,
  requestedBy: string
) {
  return proposeSharedAction({
    orgId: manifest.org_id,
    propertyId: manifest.property_id,
    domain: 'siteforge',
    subjectType: 'migration_manifest',
    subjectId: manifest.id,
    dedupeKey: `siteforge-migration:${manifest.id}:${manifest.content_hash}`,
    requestedBy,
    capturedBy: requestedBy,
    payload: {
      manifestId: manifest.id,
      websiteId: manifest.website_id,
      version: manifest.version,
      contentHash: manifest.content_hash,
      sourceReadOnly: true,
    },
    action: {
      actionType: 'siteforge.migration:approve_manifest',
      requestPayload: {
        manifestId: manifest.id,
        contentHash: manifest.content_hash,
      },
      executionPayload: {
        manifestId: manifest.id,
        websiteId: manifest.website_id,
        contentHash: manifest.content_hash,
      },
      policyReason:
        'Explicit operator approval of the exact read-only migration manifest is required before import.',
      confidenceScore: 1,
    },
  })
}

export async function createMigrationManifest(
  input: {
    websiteId: string
    userId: string
    manifest: unknown
  },
  supabase: ServiceClient = createServiceClient()
) {
  const manifest = siteForgeMigrationManifestInputSchema.parse(input.manifest)
  if (manifest.postLaunchCrawl.status !== 'pending') {
    throw new SiteForgeMigrationError(
      'Post-launch evidence must be recorded through server verification',
      409
    )
  }
  const contentHash = verifyCrawlerManifest(manifest)
  const website = await loadWebsite(
    input.websiteId,
    manifest.propertyId,
    supabase
  )
  const { data: latest, error: latestError } = await supabase
    .from('siteforge_migration_manifests')
    .select('version')
    .eq('website_id', input.websiteId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new SiteForgeMigrationError('Failed to determine manifest version', 500)
  }

  const insert: TablesInsert<'siteforge_migration_manifests'> = {
    org_id: website.org_id,
    property_id: website.property_id,
    website_id: website.id,
    version: (latest?.version || 0) + 1,
    status: 'ready_for_review',
    source_url: manifest.sourceUrl,
    source_read_only: true,
    source_inventory: {
      ...manifest.sourceInventory,
      crawlerProvenance: manifest.crawlerProvenance,
      redirectDecisions: manifest.redirectDecisions,
    } as unknown as Json,
    content_manifest: manifest.contentManifest as unknown as Json,
    asset_manifest: manifest.assetManifest as unknown as Json,
    form_manifest: manifest.formManifest as unknown as Json,
    redirect_map: manifest.redirectMap as unknown as Json,
    unmigrated_items: manifest.unmigratedItems as unknown as Json,
    dns_snapshot: manifest.dnsSnapshot as unknown as Json,
    parity_report: manifest.parityReport as unknown as Json,
    post_launch_crawl: manifest.postLaunchCrawl as unknown as Json,
    content_hash: contentHash,
    created_by: input.userId,
  }
  const { data: created, error: insertError } = await supabase
    .from('siteforge_migration_manifests')
    .insert(insert)
    .select('*')
    .single()
  if (insertError || !created) {
    if (insertError?.code === '23505') {
      throw new SiteForgeMigrationError(
        'This migration manifest already exists',
        409
      )
    }
    throw new SiteForgeMigrationError('Failed to persist migration manifest', 500)
  }

  const proposal = await createApprovalProposal(created, input.userId)
  const { data: linked, error: linkError } = await supabase
    .from('siteforge_migration_manifests')
    .update({
      shared_job_id: proposal.sharedJobId,
      approval_action_attempt_id: proposal.sharedActionAttemptId,
    })
    .eq('id', created.id)
    .eq('content_hash', contentHash)
    .select('*')
    .single()
  if (linkError || !linked) {
    throw new SiteForgeMigrationError(
      'Failed to link migration approval proposal',
      500
    )
  }
  return linked
}

async function loadManifestForDecision(
  manifestId: string,
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient
) {
  const { data, error } = await supabase
    .from('siteforge_migration_manifests')
    .select('*')
    .eq('id', manifestId)
    .eq('website_id', websiteId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeMigrationError('Migration manifest not found', 404)
  }
  return data
}

export async function decideMigrationManifest(
  input: {
    manifestId: string
    websiteId: string
    propertyId: string
    reviewerProfileId: string
    contentHash: string
    decisionStatus: 'approved' | 'denied'
    decisionReason: string
  },
  supabase: ServiceClient = createServiceClient()
) {
  const manifest = await loadManifestForDecision(
    input.manifestId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  if (
    manifest.status !== 'ready_for_review' ||
    manifest.content_hash !== input.contentHash
  ) {
    throw new SiteForgeMigrationError(
      'Migration manifest changed or is no longer reviewable',
      409
    )
  }
  assertMigrationStatusTransition(
    manifest.status,
    input.decisionStatus === 'approved' ? 'approved' : 'failed'
  )
  if (!manifest.approval_action_attempt_id) {
    throw new SiteForgeMigrationError(
      'Migration approval proposal is missing',
      409
    )
  }

  if (input.decisionStatus === 'approved') {
    verifyStoredCrawlerManifest(manifest)
    const parityResult = parityReportSchema.safeParse(manifest.parity_report)
    if (!parityResult.success) {
      throw new SiteForgeMigrationError(
        'Stored migration verification evidence is invalid',
        409
      )
    }
    const parity = parityResult.data
    const unmigrated = zodUnmigratedItems(manifest.unmigrated_items)
    if (parity.status !== 'complete') {
      throw new SiteForgeMigrationError(
        'Complete side-by-side parity evidence before approval',
        409
      )
    }
    if (unmigrated.some(item => item.status === 'requires_operator_review')) {
      throw new SiteForgeMigrationError(
        'Resolve or explicitly accept all unmigrated items before approval',
        409
      )
    }
  }

  const decision = await recordSharedApprovalDecision(
    {
      propertyId: input.propertyId,
      actionAttemptId: manifest.approval_action_attempt_id,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus: input.decisionStatus,
      decisionReason: input.decisionReason,
      decisionPayload: {
        manifestId: manifest.id,
        websiteId: manifest.website_id,
        version: manifest.version,
        contentHash: manifest.content_hash,
        sourceReadOnly: true,
      },
      policyDecision: {
        policyName: 'siteforge-existing-site-migration',
        policyVersion: 'v1',
        confidenceScore: 1,
        decisionPayload: {
          parityReport: manifest.parity_report,
          unmigratedItems: manifest.unmigrated_items,
          dnsSnapshot: manifest.dns_snapshot,
        },
      },
    },
    supabase
  )
  const { data: updated, error: updateError } = await supabase
    .from('siteforge_migration_manifests')
    .update({
      status: input.decisionStatus === 'approved' ? 'approved' : 'failed',
      confirmed_approval_id: decision.approval.id,
    })
    .eq('id', manifest.id)
    .eq('content_hash', manifest.content_hash)
    .eq('status', 'ready_for_review')
    .select('*')
    .single()
  if (updateError || !updated) {
    throw new SiteForgeMigrationError(
      'Migration manifest changed before the decision completed',
      409
    )
  }
  return updated
}

function zodUnmigratedItems(value: Json) {
  return unmigratedItemSchema.array().parse(value)
}

export async function recordMigrationImported(
  input: {
    manifestId: string
    websiteId: string
    propertyId: string
    contentHash: string
  },
  supabase: ServiceClient = createServiceClient()
) {
  const manifest = await loadManifestForDecision(
    input.manifestId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  if (manifest.content_hash !== input.contentHash) {
    throw new SiteForgeMigrationError(
      'Migration import is bound to a stale manifest',
      409
    )
  }
  assertMigrationStatusTransition(manifest.status, 'imported')
  if (!manifest.confirmed_approval_id) {
    throw new SiteForgeMigrationError(
      'Confirmed manifest approval is required before import',
      409
    )
  }
  verifyStoredCrawlerManifest(manifest)

  const { data, error } = await supabase
    .from('siteforge_migration_manifests')
    .update({ status: 'imported' })
    .eq('id', manifest.id)
    .eq('content_hash', manifest.content_hash)
    .eq('status', 'approved')
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeMigrationError(
      'Migration manifest changed before import was recorded',
      409
    )
  }
  return data
}

export async function recordPostLaunchCrawlVerification(
  input: {
    manifestId: string
    websiteId: string
    propertyId: string
    contentHash: string
    verification: unknown
  },
  supabase: ServiceClient = createServiceClient()
) {
  const verification = postLaunchVerificationInputSchema.parse(
    input.verification
  )
  const manifest = await loadManifestForDecision(
    input.manifestId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  if (
    manifest.content_hash !== input.contentHash
  ) {
    throw new SiteForgeMigrationError(
      'Post-launch crawl is bound to a stale migration manifest',
      409
    )
  }
  const nextStatus = verification.status === 'passed' ? 'verified' : 'failed'
  assertMigrationStatusTransition(manifest.status, nextStatus)
  if (!manifest.confirmed_approval_id) {
    throw new SiteForgeMigrationError(
      'Confirmed manifest approval is required before post-launch verification',
      409
    )
  }
  verifyPostLaunchEvidence(verification, manifest.content_hash)

  const { data, error } = await supabase
    .from('siteforge_migration_manifests')
    .update({
      post_launch_crawl: verification as unknown as Json,
      status: nextStatus,
    })
    .eq('id', manifest.id)
    .eq('content_hash', manifest.content_hash)
    .eq('status', manifest.status)
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeMigrationError(
      'Migration lifecycle changed before post-launch verification completed',
      409
    )
  }
  return data
}
