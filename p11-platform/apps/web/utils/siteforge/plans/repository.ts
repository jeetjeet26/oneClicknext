import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, TablesInsert } from '@/types/supabase'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import {
  siteForgePlanSchema,
  siteForgePlanStatusSchema,
  siteForgeGenerationEvidenceSnapshotSchema,
  siteForgeReadinessReportSchema,
  type SiteForgePlan,
  type SiteForgeGenerationEvidenceSnapshot,
  type SiteForgeReadinessReport,
} from '@/utils/siteforge/contracts'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { buildSiteForgePlan } from './builder'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import {
  recordSharedApprovalDecision,
  type SharedApprovalDecisionStatus,
} from '@/utils/services/shared-approvals'
import {
  evaluateRequiredAssetReadiness,
  getLatestApprovedOnboardingSnapshot,
} from '@/utils/onboarding/repository'
import {
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'
import { brandContextFromContract } from '@/utils/siteforge/brand-contract-adapter'
import { createApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plans'
import { isSyntheticInventorySource } from '@/utils/siteforge/providers/inventory-policy'
import {
  hashSiteForgeBrief,
  siteForgeBriefContradictionsSchema,
  siteForgeBriefSchema,
} from '@/utils/siteforge/briefs/contracts'
import {
  hashSiteForgeDirection,
  hashSiteForgeDirectionSet,
  siteForgeCreativeDirectionSchema,
  siteForgeDirectionPreviewSchema,
} from '@/utils/siteforge/directions/contracts'

type ServiceClient = ReturnType<typeof createServiceClient>

export class SiteForgePlanError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgePlanError'
  }
}

type ConversationEntry = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

type CreatePlanRevisionInput = {
  propertyId: string
  userId: string
  /** @deprecated Planning always uses the approved pinned BrandForge contract. */
  brandContext?: BrandContext
  preferences?: unknown
  siteType?: unknown
  operatorDirection?: string | null
  conversationHistory: ConversationEntry[]
  planId?: string | null
  expectedRevision?: number | null
}

export type PersistedPlanRevision = {
  planId: string
  planVersionId: string
  revision: number
  status: 'draft' | 'ready_for_review' | 'confirmed' | 'consumed' | 'superseded' | 'denied'
  contentHash: string
  plan: SiteForgePlan
  readiness: SiteForgeReadinessReport
  approvalActionAttemptId: string | null
}

export type ApprovedSiteForgeGenerationContext = {
  websiteId: string
  propertyId: string
  orgId: string
  planVersionId: string
  plan: SiteForgePlan
  brief: Record<string, unknown>
  creativeDirection: Record<string, unknown>
  evidenceSnapshot: SiteForgeGenerationEvidenceSnapshot
}

type LoadApprovedGenerationContextInput = {
  websiteId: string
  planId: string
  confirmedRevision: number
  contentHash: string
}

function generationConflict(message: string): never {
  throw new SiteForgePlanError(message, 409)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function latestInventoryTimestamp(row: {
  source_updated_at: string | null
  effective_at: string | null
  imported_at: string | null
}): string | null {
  return row.source_updated_at || row.effective_at || row.imported_at || null
}

/**
 * Loads the immutable, approval-bound generation truth and hashes every
 * mutable source into one evidence snapshot. This is used both at request time
 * and immediately before workflow generation so stale inputs fail closed.
 */
export async function loadApprovedSiteForgeGenerationContext(
  input: LoadApprovedGenerationContextInput,
  supabase: ServiceClient = createServiceClient(),
  now = new Date()
): Promise<ApprovedSiteForgeGenerationContext> {
  const { data: website, error: websiteError } = await supabase
    .from('property_websites')
    .select('id, property_id, org_id')
    .eq('id', input.websiteId)
    .single()
  if (websiteError || !website?.org_id) {
    generationConflict('Generation website is unavailable')
  }

  const { data: planRow, error: planError } = await supabase
    .from('siteforge_plans')
    .select('id, property_id, org_id, status, current_revision, confirmed_version_id')
    .eq('id', input.planId)
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .single()
  if (
    planError ||
    !planRow ||
    !['confirmed', 'consumed'].includes(planRow.status) ||
    planRow.current_revision !== input.confirmedRevision ||
    !planRow.confirmed_version_id
  ) {
    generationConflict('A matching confirmed plan is required for generation')
  }

  const { data: version, error: versionError } = await supabase
    .from('siteforge_plan_versions')
    .select(`
      id,
      plan_id,
      revision,
      plan,
      readiness_report,
      content_hash,
      onboarding_snapshot_id,
      onboarding_snapshot_hash,
      brand_asset_id,
      brand_contract_version,
      brand_contract_hash
    `)
    .eq('id', planRow.confirmed_version_id)
    .eq('plan_id', planRow.id)
    .eq('revision', input.confirmedRevision)
    .single()
  if (
    versionError ||
    !version ||
    version.content_hash !== input.contentHash
  ) {
    generationConflict('Confirmed plan content no longer matches this request')
  }
  const plan = siteForgePlanSchema.parse(version.plan)
  const readiness = siteForgeReadinessReportSchema.parse(version.readiness_report)
  if (
    plan.propertyId !== website.property_id ||
    hashSiteForgeContent(plan) !== version.content_hash ||
    !readiness.ready ||
    readiness.issues.some(issue => issue.severity === 'blocker')
  ) {
    generationConflict('Confirmed plan is stale or has unresolved readiness blockers')
  }
  if (
    !plan.onboardingSnapshot ||
    !plan.brandSnapshot ||
    plan.onboardingSnapshot.id !== version.onboarding_snapshot_id ||
    plan.onboardingSnapshot.contentHash !== version.onboarding_snapshot_hash ||
    plan.brandSnapshot.assetId !== version.brand_asset_id ||
    plan.brandSnapshot.contractVersion !== version.brand_contract_version ||
    plan.brandSnapshot.contractHash !== version.brand_contract_hash
  ) {
    generationConflict('Confirmed plan does not match its pinned readiness truth')
  }

  const { data: onboarding, error: onboardingError } = await supabase
    .from('property_onboarding_snapshots')
    .select(
      'id, org_id, property_id, status, content_hash, brand_asset_id, brand_contract_version, brand_contract_hash'
    )
    .eq('id', version.onboarding_snapshot_id || '')
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .single()
  if (
    onboardingError ||
    !onboarding ||
    onboarding.status !== 'approved' ||
    onboarding.content_hash !== version.onboarding_snapshot_hash ||
    onboarding.brand_asset_id !== version.brand_asset_id ||
    onboarding.brand_contract_version !== version.brand_contract_version ||
    onboarding.brand_contract_hash !== version.brand_contract_hash
  ) {
    generationConflict('Pinned onboarding snapshot is unavailable or changed')
  }

  const { data: brandRow, error: brandError } = await supabase
    .from('property_brand_assets')
    .select('*')
    .eq('id', version.brand_asset_id || '')
    .eq('property_id', website.property_id)
    .single()
  if (
    brandError ||
    !brandRow ||
    brandRow.approval_status !== 'approved' ||
    brandRow.contract_version !== version.brand_contract_version
  ) {
    generationConflict('Pinned BrandForge contract is unavailable or unapproved')
  }
  const brandContract = normalizeBrandAssetRow(
    brandRow as unknown as Record<string, unknown>
  )
  const brandHash = hashBrandForgeContract(brandContract)
  if (
    brandHash !== brandRow.contract_hash ||
    brandHash !== version.brand_contract_hash ||
    brandHash !== plan.brandSnapshot.contractHash
  ) {
    generationConflict('Pinned BrandForge contract hash changed')
  }

  const { data: briefRow, error: briefError } = await supabase
    .from('siteforge_brief_versions')
    .select(
      'id, version, status, brief, unresolved_contradictions, content_hash, onboarding_snapshot_id, onboarding_snapshot_hash, brand_asset_id, brand_contract_hash'
    )
    .eq('website_id', website.id)
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .eq('status', 'approved')
    .single()
  const parsedBrief = siteForgeBriefSchema.safeParse(briefRow?.brief)
  const parsedContradictions = siteForgeBriefContradictionsSchema.safeParse(
    briefRow?.unresolved_contradictions
  )
  if (
    briefError ||
    !briefRow ||
    !parsedBrief.success ||
    !parsedContradictions.success ||
    parsedContradictions.data.length > 0 ||
    briefRow.onboarding_snapshot_id !== onboarding.id ||
    briefRow.onboarding_snapshot_hash !== onboarding.content_hash ||
    briefRow.brand_asset_id !== brandRow.id ||
    briefRow.brand_contract_hash !== brandHash ||
    hashSiteForgeBrief({
      brief: parsedBrief.success ? parsedBrief.data : ({} as never),
      unresolvedContradictions: parsedContradictions.success
        ? parsedContradictions.data
        : [],
      sources: {
        onboardingSnapshotId: onboarding.id,
        onboardingSnapshotHash: onboarding.content_hash,
        brandAssetId: brandRow.id,
        brandContractHash: brandHash,
      },
    }) !== briefRow.content_hash
  ) {
    generationConflict('Approved SiteForge brief is missing, contradictory, or stale')
  }

  const { data: directionSet, error: directionSetError } = await supabase
    .from('siteforge_creative_direction_sets')
    .select(
      'id, version, status, brief_version_id, selected_direction_id, selection_notes, content_hash'
    )
    .eq('website_id', website.id)
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .eq('status', 'approved')
    .single()
  if (
    directionSetError ||
    !directionSet ||
    directionSet.brief_version_id !== briefRow.id ||
    !directionSet.selected_direction_id
  ) {
    generationConflict('Approved creative direction is missing or stale')
  }
  const { data: directionRows, error: directionError } = await supabase
    .from('siteforge_creative_directions')
    .select('id, direction_set_id, ordinal, name, direction, preview_manifest, content_hash')
    .eq('direction_set_id', directionSet.id)
    .order('ordinal', { ascending: true })
  const directions = (directionRows || []).map(row => {
    const parsedDirection = siteForgeCreativeDirectionSchema.safeParse(row.direction)
    const parsedPreview = siteForgeDirectionPreviewSchema.safeParse(
      row.preview_manifest
    )
    const canonicalHash =
      parsedDirection.success && parsedPreview.success
        ? hashSiteForgeDirection({
            name: row.name,
            ordinal: row.ordinal,
            direction: parsedDirection.data,
            previewManifest: parsedPreview.data,
          })
        : null
    return { row, parsedDirection, canonicalHash }
  })
  const selected = directions.find(
    candidate => candidate.row.id === directionSet.selected_direction_id
  )
  const canonicalSetHash = hashSiteForgeDirectionSet({
    briefVersionId: briefRow.id,
    briefContentHash: briefRow.content_hash,
    directionHashes: directions.map(candidate => candidate.row.content_hash),
    selectedDirectionHash: selected?.row.content_hash || null,
    selectionNotes: directionSet.selection_notes,
  })
  if (
    directionError ||
    directions.length < 2 ||
    directions.some(candidate =>
      candidate.canonicalHash !== candidate.row.content_hash
    ) ||
    !selected ||
    !selected.parsedDirection.success ||
    selected.parsedDirection.data.provenance.briefVersionId !== briefRow.id ||
    selected.parsedDirection.data.provenance.briefContentHash !==
      briefRow.content_hash ||
    selected.parsedDirection.data.provenance.onboardingSnapshotId !==
      onboarding.id ||
    selected.parsedDirection.data.provenance.onboardingSnapshotHash !==
      onboarding.content_hash ||
    selected.parsedDirection.data.provenance.brandAssetId !== brandRow.id ||
    selected.parsedDirection.data.provenance.brandContractHash !== brandHash ||
    canonicalSetHash !== directionSet.content_hash
  ) {
    generationConflict('Selected creative-direction hash does not match its payload')
  }
  const direction = selected.row

  const { data: assetRows, error: assetError } = await supabase
    .from('content_assets')
    .select(
      'id, asset_role, asset_type, file_url, content_hash, rights_status, rights_metadata, approval_status, curation_status, expires_at, duplicate_of'
    )
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .eq('approval_status', 'approved')
    .in('rights_status', ['owned', 'licensed', 'generated'])
    .order('id', { ascending: true })
  if (assetError) {
    generationConflict(`Failed to load approved asset manifest: ${assetError.message}`)
  }
  const currentAssetReadiness = evaluateRequiredAssetReadiness(
    assetRows || [],
    now,
  )
  if (!currentAssetReadiness.ready) {
    generationConflict(
      `Generation asset manifest no longer satisfies readiness: ${currentAssetReadiness.reasons.join('; ')}`,
    )
  }
  const assets = currentAssetReadiness.approvedRightsCleared.flatMap(asset => {
    const expired = asset.expires_at && new Date(asset.expires_at) <= now
    if (
      expired ||
      !asset.asset_role ||
      !asset.content_hash ||
      !/^[a-f0-9]{64}$/.test(asset.content_hash) ||
      !isRecord(asset.rights_metadata)
    ) {
      return []
    }
    return [{
      id: asset.id,
      role: asset.asset_role,
      fileUrl: asset.file_url,
      contentHash: asset.content_hash,
      rightsStatus: asset.rights_status as 'owned' | 'licensed' | 'generated',
      rightsEvidenceHash: hashSiteForgeContent(asset.rights_metadata),
      approvalStatus: 'approved' as const,
      expiresAt: asset.expires_at,
    }]
  })
  if (assets.length === 0) {
    generationConflict('Generation requires an approved rights-cleared asset manifest')
  }
  const assetManifestHash = hashSiteForgeContent(assets)

  const inventoryRequired = plan.pages.some(page =>
    page.sections.some(section => section.block === 'acf/plans-availability')
  )
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from('property_units')
    .select(
      'canonical_key, unit_type, bedrooms, bathrooms, sqft_min, sqft_max, rent_min, rent_max, available_count, move_in_specials, floor_plan_image_url, floor_plan_image_alt, availability_url, apply_url, source, source_identity, effective_at, expires_at, source_updated_at, imported_at'
    )
    .eq('property_id', website.property_id)
    .eq('org_id', website.org_id)
    .eq('active', true)
    .eq('review_status', 'approved')
    .order('canonical_key', { ascending: true })
  if (inventoryError) {
    generationConflict(`Failed to load approved inventory evidence: ${inventoryError.message}`)
  }
  const inventory = (inventoryRows || []).filter(
    row => !isSyntheticInventorySource(row),
  )
  if (inventoryRequired && inventory.length === 0) {
    generationConflict('Confirmed plan requires approved floor-plan inventory')
  }
  const freshnessMs = plan.floorPlanStrategy.freshnessHours * 3_600_000
  const inventoryTimestamps = inventory.map(row => latestInventoryTimestamp(row))
  if (
    inventoryRequired &&
    inventory.some((row, index) => {
      const timestamp = inventoryTimestamps[index]
      return (
        !timestamp ||
        now.getTime() - new Date(timestamp).getTime() > freshnessMs ||
        Boolean(row.expires_at && new Date(row.expires_at) <= now) ||
        (plan.floorPlanStrategy.showPricing &&
          row.rent_min == null &&
          row.rent_max == null) ||
        (plan.floorPlanStrategy.showAvailability &&
          row.available_count == null)
      )
    })
  ) {
    generationConflict(
      'Approved floor-plan inventory is stale, expired, or incomplete'
    )
  }
  const latestSourceUpdatedAt = inventoryTimestamps
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null
  const inventoryContentHash = createApprovedFloorPlanSnapshot(
    inventory,
    now.toISOString()
  ).contentHash

  const snapshotCore = {
    schemaVersion: 1 as const,
    websiteId: website.id,
    propertyId: website.property_id,
    orgId: website.org_id,
    plan: {
      id: planRow.id,
      versionId: version.id,
      revision: version.revision,
      contentHash: version.content_hash,
    },
    brief: {
      id: briefRow.id,
      version: briefRow.version,
      contentHash: briefRow.content_hash,
    },
    creativeDirection: {
      setId: directionSet.id,
      setVersion: directionSet.version,
      setContentHash: directionSet.content_hash,
      directionId: direction.id,
      directionContentHash: direction.content_hash,
    },
    onboarding: {
      id: onboarding.id,
      contentHash: onboarding.content_hash,
    },
    brand: {
      assetId: brandRow.id,
      contractVersion: brandContract.contractVersion,
      contractHash: brandHash,
    },
    assetManifest: {
      assets,
      contentHash: assetManifestHash,
    },
    inventory: {
      required: inventoryRequired,
      rowCount: inventory.length,
      contentHash: inventoryContentHash,
      latestSourceUpdatedAt,
    },
  }
  const evidenceSnapshot = siteForgeGenerationEvidenceSnapshotSchema.parse({
    ...snapshotCore,
    capturedAt: now.toISOString(),
    contentHash: hashSiteForgeContent(snapshotCore),
  })

  return {
    websiteId: website.id,
    propertyId: website.property_id,
    orgId: website.org_id,
    planVersionId: version.id,
    plan,
    brief: parsedBrief.data,
    creativeDirection: selected.parsedDirection.data,
    evidenceSnapshot,
  }
}

export async function assertSiteForgeGenerationEvidenceCurrent(
  expected: SiteForgeGenerationEvidenceSnapshot,
  supabase: ServiceClient = createServiceClient(),
  now = new Date()
): Promise<ApprovedSiteForgeGenerationContext> {
  const parsed = siteForgeGenerationEvidenceSnapshotSchema.parse(expected)
  const current = await loadApprovedSiteForgeGenerationContext(
    {
      websiteId: parsed.websiteId,
      planId: parsed.plan.id,
      confirmedRevision: parsed.plan.revision,
      contentHash: parsed.plan.contentHash,
    },
    supabase,
    now
  )
  if (current.evidenceSnapshot.contentHash !== parsed.contentHash) {
    generationConflict('Generation evidence changed after the request was approved')
  }
  return current
}

function buildReadinessReport(
  plan: SiteForgePlan,
  brandContext: BrandContext,
  floorPlans?: { activeCount: number; latestUpdatedAt: string | null }
): SiteForgeReadinessReport {
  const issues: Array<{
    code: string
    severity: 'warning' | 'blocker'
    category:
      | 'property'
      | 'brand'
      | 'knowledge'
      | 'inventory'
      | 'assets'
      | 'conversion'
      | 'wordpress'
      | 'legal'
      | 'accessibility'
      | 'seo'
      | 'analytics'
      | 'quality'
    message: string
    evidenceIds: string[]
  }> = []

  if (brandContext.source === 'generated') {
    issues.push({
      code: 'brand_evidence_missing',
      severity: 'warning',
      category: 'brand',
      message: 'No BrandForge or knowledge-base brand evidence was available.',
      evidenceIds: plan.evidence.map((item) => item.id),
    })
  }

  if (brandContext.confidence < 0.5) {
    issues.push({
      code: 'brand_confidence_low',
      severity: 'warning',
      category: 'brand',
      message: 'Brand confidence is below 50%; review the direction before confirming.',
      evidenceIds: plan.evidence.map((item) => item.id),
    })
  }

  if (plan.unresolvedQuestions.length > 0) {
    issues.push({
      code: 'plan_questions_unresolved',
      severity: 'blocker',
      category: 'property',
      message: 'Resolve all blocking plan questions before confirmation.',
      evidenceIds: [],
    })
  }

  if (floorPlans && floorPlans.activeCount === 0) {
    issues.push({
      code: 'floor_plan_inventory_missing',
      severity: 'warning',
      category: 'inventory',
      message:
        'No reviewed floor plans are available. SiteForge will publish clearly labeled placeholders that can be replaced later.',
      evidenceIds: [],
    })
  } else if (floorPlans?.latestUpdatedAt) {
    const ageHours =
      (Date.now() - new Date(floorPlans.latestUpdatedAt).getTime()) / 3_600_000
    if (ageHours > plan.floorPlanStrategy.freshnessHours) {
      issues.push({
        code: 'floor_plan_inventory_stale',
        severity: 'warning',
        category: 'inventory',
        message: `Floor-plan inventory is older than ${plan.floorPlanStrategy.freshnessHours} hours.`,
        evidenceIds: [],
      })
    }
  }

  return siteForgeReadinessReportSchema.parse({
    ready: !issues.some((issue) => issue.severity === 'blocker'),
    evaluatedAt: new Date().toISOString(),
    policyVersion: 'siteforge-plan-readiness-v2',
    issues,
  })
}

function applyCurrentReadinessPolicy(value: unknown): SiteForgeReadinessReport {
  const stored = siteForgeReadinessReportSchema.parse(value)
  const issues = stored.issues.map((issue) =>
    issue.code === 'floor_plan_inventory_missing'
      ? {
          ...issue,
          severity: 'warning' as const,
          message:
            'No reviewed floor plans are available. SiteForge will publish clearly labeled placeholders that can be replaced later.',
        }
      : issue
  )

  return siteForgeReadinessReportSchema.parse({
    ...stored,
    ready: !issues.some((issue) => issue.severity === 'blocker'),
    policyVersion: 'siteforge-plan-readiness-v2',
    issues,
  })
}

async function loadProperty(
  propertyId: string,
  supabase: ServiceClient
): Promise<{ id: string; name: string; org_id: string }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, org_id')
    .eq('id', propertyId)
    .single()

  if (error || !data?.org_id) {
    throw new SiteForgePlanError('Property not found or missing organization ownership', 404)
  }

  return {
    id: data.id,
    name: data.name,
    org_id: data.org_id,
  }
}

export async function createPlanRevision(
  input: CreatePlanRevisionInput,
  supabase: ServiceClient = createServiceClient()
): Promise<PersistedPlanRevision> {
  const property = await loadProperty(input.propertyId, supabase)
  const onboardingSnapshot = await getLatestApprovedOnboardingSnapshot(
    property.id,
    supabase,
  )
  if (!onboardingSnapshot) {
    throw new SiteForgePlanError(
      'Approve a complete property onboarding readiness snapshot before creating a SiteForge plan',
      409,
    )
  }
  if (!onboardingSnapshot.brand_asset_id || !onboardingSnapshot.brand_contract_hash) {
    throw new SiteForgePlanError(
      'Approved onboarding snapshot is missing its pinned BrandForge contract',
      409,
    )
  }
  const { data: brandRow, error: brandError } = await supabase
    .from('property_brand_assets')
    .select('*')
    .eq('id', onboardingSnapshot.brand_asset_id)
    .eq('property_id', property.id)
    .single()
  if (brandError || !brandRow) {
    throw new SiteForgePlanError('Pinned BrandForge contract is unavailable', 409)
  }
  const brandContract = normalizeBrandAssetRow(
    brandRow as unknown as Record<string, unknown>,
  )
  const brandContractHash = hashBrandForgeContract(brandContract)
  if (
    brandContractHash !== onboardingSnapshot.brand_contract_hash
    || brandRow.contract_hash !== onboardingSnapshot.brand_contract_hash
  ) {
    throw new SiteForgePlanError(
      'Approved BrandForge contract changed after readiness approval; rebuild readiness',
      409,
    )
  }
  const pinnedBrandContext = brandContextFromContract(brandContract)
  const sourceReferences = Array.isArray(onboardingSnapshot.source_references)
    ? onboardingSnapshot.source_references.flatMap(reference =>
        reference && typeof reference === 'object' && !Array.isArray(reference)
          ? [{
              domain: typeof reference.domain === 'string' ? reference.domain : undefined,
              sourceId: typeof reference.sourceId === 'string' ? reference.sourceId : undefined,
            }]
          : [],
      )
    : []
  const snapshotPayload =
    onboardingSnapshot.snapshot_payload
    && typeof onboardingSnapshot.snapshot_payload === 'object'
    && !Array.isArray(onboardingSnapshot.snapshot_payload)
      ? onboardingSnapshot.snapshot_payload
      : {}
  const snapshotAssets = Array.isArray(snapshotPayload.assets)
    ? snapshotPayload.assets.flatMap(value => {
        if (!isRecord(value)) return []
        if (
          typeof value.id !== 'string'
          || typeof value.asset_type !== 'string'
          || typeof value.approval_status !== 'string'
          || typeof value.curation_status !== 'string'
          || typeof value.rights_status !== 'string'
        ) {
          return []
        }
        return [{
          id: value.id,
          asset_role:
            typeof value.asset_role === 'string' ? value.asset_role : null,
          asset_type: value.asset_type,
          approval_status: value.approval_status,
          curation_status: value.curation_status,
          rights_status: value.rights_status,
          expires_at:
            typeof value.expires_at === 'string' ? value.expires_at : null,
          duplicate_of:
            typeof value.duplicate_of === 'string' ? value.duplicate_of : null,
        }]
      })
    : []
  const assetReadiness = evaluateRequiredAssetReadiness(snapshotAssets)
  if (!assetReadiness.ready) {
    throw new SiteForgePlanError(
      `Approved readiness no longer satisfies SiteForge asset policy: ${assetReadiness.reasons.join('; ')}. Rebuild and approve readiness.`,
      409,
    )
  }
  const enabledCapabilities = Array.isArray(snapshotPayload.enabledCapabilities)
    ? snapshotPayload.enabledCapabilities.filter(
        (capability): capability is 'crm' | 'tours' | 'chatbot' | 'analytics' =>
          capability === 'crm'
          || capability === 'tours'
          || capability === 'chatbot'
          || capability === 'analytics',
      )
    : []
  const plan = buildSiteForgePlan({
    propertyId: property.id,
    propertyName: property.name,
    brandContext: pinnedBrandContext,
    brandAssetId: brandRow.id,
    brandContract,
    brandContractHash,
    onboardingSnapshot: {
      id: onboardingSnapshot.id,
      contentHash: onboardingSnapshot.content_hash,
      enabledCapabilities,
      sourceReferences,
    },
    preferences: input.preferences,
    siteType: input.siteType,
    operatorDirection: input.operatorDirection,
  })
  const missingCapabilities = plan.enabledCapabilities.filter(
    capability => !enabledCapabilities.includes(capability),
  )
  if (missingCapabilities.length) {
    throw new SiteForgePlanError(
      `Rebuild onboarding readiness with enabled SiteForge capabilities: ${missingCapabilities.join(', ')}`,
      409,
    )
  }
  const { data: reviewedFloorPlans, error: floorPlanError } = await supabase
    .from('property_units')
    .select(
      'source, source_identity, source_updated_at, effective_at, imported_at',
    )
    .eq('property_id', property.id)
    .eq('active', true)
    .eq('review_status', 'approved')
  if (floorPlanError) {
    throw new SiteForgePlanError('Failed to evaluate floor-plan readiness', 503)
  }
  const publishableFloorPlans = (reviewedFloorPlans || []).filter(
    floorPlan => !isSyntheticInventorySource(floorPlan),
  )
  const latestFloorPlanTimestamp = publishableFloorPlans
    .flatMap(floorPlan => {
      const timestamp =
        floorPlan.source_updated_at ||
        floorPlan.effective_at ||
        floorPlan.imported_at
      return timestamp ? [timestamp] : []
    })
    .sort()
    .at(-1) || null
  const readiness = buildReadinessReport(plan, pinnedBrandContext, {
    activeCount: publishableFloorPlans.length,
    latestUpdatedAt: latestFloorPlanTimestamp,
  })
  const contentHash = hashSiteForgeContent(plan)
  const now = new Date().toISOString()

  let planId = input.planId || null
  let nextRevision = 1

  if (planId) {
    const { data: existing, error } = await supabase
      .from('siteforge_plans')
      .select('id, property_id, current_revision, status')
      .eq('id', planId)
      .eq('property_id', property.id)
      .single()

    if (error || !existing) {
      throw new SiteForgePlanError('SiteForge plan not found', 404)
    }
    if (
      input.expectedRevision !== null &&
      input.expectedRevision !== undefined &&
      existing.current_revision !== input.expectedRevision
    ) {
      throw new SiteForgePlanError('Plan revision changed; reload before editing', 409)
    }
    if (existing.status === 'consumed') {
      throw new SiteForgePlanError('Consumed plans cannot be edited', 409)
    }
    nextRevision = existing.current_revision + 1
  } else {
    const insert: TablesInsert<'siteforge_plans'> = {
      org_id: property.org_id,
      property_id: property.id,
      status: 'draft',
      current_revision: 0,
      created_by: input.userId,
      created_at: now,
      updated_at: now,
    }
    const { data: created, error } = await supabase
      .from('siteforge_plans')
      .insert(insert)
      .select('id')
      .single()

    if (error || !created) {
      throw new SiteForgePlanError('Failed to create SiteForge plan', 500)
    }
    planId = created.id
  }

  const contextPayload = {
    property: {
      id: property.id,
      name: property.name,
      orgId: property.org_id,
    },
    brandContext: pinnedBrandContext,
    brandContract,
    brandContractHash,
    onboardingSnapshotId: onboardingSnapshot.id,
    onboardingSnapshotHash: onboardingSnapshot.content_hash,
    onboardingSnapshotPayload: onboardingSnapshot.snapshot_payload,
    preferences: input.preferences || {},
    siteType: plan.siteType,
  }
  const { data: contextSnapshot, error: contextError } = await supabase
    .from('shared_context_snapshots')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      source_domain: 'siteforge',
      source_ref: `${planId}:${nextRevision}`,
      context_hash: hashSiteForgeContent(contextPayload),
      context_payload: contextPayload as unknown as Json,
      captured_by: input.userId,
    })
    .select('id')
    .single()

  if (contextError || !contextSnapshot) {
    throw new SiteForgePlanError('Failed to persist trusted planning context', 500)
  }

  const versionInsert: TablesInsert<'siteforge_plan_versions'> = {
    plan_id: planId,
    revision: nextRevision,
    context_snapshot_id: contextSnapshot.id,
    plan: plan as unknown as Json,
    preferences: plan.preferences as unknown as Json,
    readiness_report: readiness as unknown as Json,
    conversation_history: input.conversationHistory as unknown as Json,
    content_hash: contentHash,
    onboarding_snapshot_id: onboardingSnapshot.id,
    onboarding_snapshot_hash: onboardingSnapshot.content_hash,
    brand_asset_id: brandRow.id,
    brand_contract_version: brandContract.contractVersion,
    brand_contract_hash: brandContractHash,
    created_by: input.userId,
    created_at: now,
  }
  const { data: version, error: versionError } = await supabase
    .from('siteforge_plan_versions')
    .insert(versionInsert)
    .select('id')
    .single()

  if (versionError || !version) {
    if (versionError?.code === '23505') {
      throw new SiteForgePlanError('This plan revision already exists', 409)
    }
    throw new SiteForgePlanError('Failed to persist SiteForge plan revision', 500)
  }

  const { data: updated, error: updateError } = await supabase
    .from('siteforge_plans')
    .update({
      current_revision: nextRevision,
      status: 'ready_for_review',
      confirmed_version_id: null,
      confirmed_approval_id: null,
      approval_action_attempt_id: null,
      confirmed_by: null,
      confirmed_at: null,
      decision_reason: null,
      updated_at: now,
    })
    .eq('id', planId)
    .eq('property_id', property.id)
    .select('id')
    .single()

  if (updateError || !updated) {
    throw new SiteForgePlanError('Failed to publish SiteForge plan revision', 500)
  }

  return {
    planId,
    planVersionId: version.id,
    revision: nextRevision,
    status: 'ready_for_review',
    contentHash,
    plan,
    readiness,
    approvalActionAttemptId: null,
  }
}

export async function getCurrentPlanRevision(
  planId: string,
  propertyId: string,
  supabase: ServiceClient = createServiceClient()
): Promise<PersistedPlanRevision> {
  const { data: planRow, error: planError } = await supabase
    .from('siteforge_plans')
    .select('id, property_id, current_revision, status, approval_action_attempt_id')
    .eq('id', planId)
    .eq('property_id', propertyId)
    .single()

  if (planError || !planRow) {
    throw new SiteForgePlanError('SiteForge plan not found', 404)
  }

  const { data: version, error: versionError } = await supabase
    .from('siteforge_plan_versions')
    .select('id, plan, readiness_report, content_hash')
    .eq('plan_id', planId)
    .eq('revision', planRow.current_revision)
    .single()

  if (versionError || !version) {
    throw new SiteForgePlanError('Current SiteForge plan revision not found', 404)
  }

  return {
    planId,
    planVersionId: version.id,
    revision: planRow.current_revision,
    status: siteForgePlanStatusSchema.parse(planRow.status),
    contentHash: version.content_hash,
    plan: siteForgePlanSchema.parse(version.plan),
    readiness: applyCurrentReadinessPolicy(version.readiness_report),
    approvalActionAttemptId: planRow.approval_action_attempt_id,
  }
}

export async function getLatestPropertyPlanRevision(
  propertyId: string,
  supabase: ServiceClient = createServiceClient(),
): Promise<PersistedPlanRevision | null> {
  const { data, error } = await supabase
    .from('siteforge_plans')
    .select('id')
    .eq('property_id', propertyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new SiteForgePlanError('Failed to load the current SiteForge plan', 500)
  }
  return data ? getCurrentPlanRevision(data.id, propertyId, supabase) : null
}

async function ensureApprovalProposal(
  current: PersistedPlanRevision,
  userId: string,
  supabase: ServiceClient
): Promise<string> {
  if (current.approvalActionAttemptId) {
    const { data } = await supabase
      .from('shared_action_attempts')
      .select('id, proposal_decision_status')
      .eq('id', current.approvalActionAttemptId)
      .maybeSingle()
    if (data?.proposal_decision_status === 'proposed') {
      return data.id
    }
  }

  const { data: property, error } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', current.plan.propertyId)
    .single()
  if (error || !property?.org_id) {
    throw new SiteForgePlanError('Property organization not found', 404)
  }

  const proposal = await proposeSharedAction({
    orgId: property.org_id,
    propertyId: current.plan.propertyId,
    domain: 'siteforge',
    subjectType: 'plan_confirmation',
    subjectId: current.planId,
    dedupeKey: `siteforge-plan:${current.planId}:${current.revision}:${current.contentHash}`,
    payload: {
      planId: current.planId,
      planVersionId: current.planVersionId,
      revision: current.revision,
      contentHash: current.contentHash,
    },
    requestedBy: userId,
    capturedBy: userId,
    action: {
      actionType: 'siteforge.plan:generate_website',
      requestPayload: {
        planId: current.planId,
        revision: current.revision,
        contentHash: current.contentHash,
      },
      executionPayload: {
        planId: current.planId,
        planVersionId: current.planVersionId,
      },
      policyReason: 'Explicit approval is required before website generation.',
      confidenceScore: current.readiness.ready ? 1 : 0,
    },
  })

  const { error: updateError } = await supabase
    .from('siteforge_plans')
    .update({
      approval_action_attempt_id: proposal.sharedActionAttemptId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.planId)
    .eq('current_revision', current.revision)

  if (updateError) {
    throw new SiteForgePlanError('Failed to link plan approval proposal', 500)
  }

  return proposal.sharedActionAttemptId
}

type DecidePlanInput = {
  planId: string
  propertyId: string
  expectedRevision: number
  contentHash: string
  reviewerProfileId: string
  decisionStatus: SharedApprovalDecisionStatus
  decisionReason: string
  modifiedPlan?: unknown
}

export async function decideSiteForgePlan(
  input: DecidePlanInput,
  supabase: ServiceClient = createServiceClient()
) {
  const current = await getCurrentPlanRevision(input.planId, input.propertyId, supabase)
  if (
    current.revision !== input.expectedRevision ||
    current.contentHash !== input.contentHash
  ) {
    throw new SiteForgePlanError('Plan revision or content hash changed', 409)
  }
  if (!current.readiness.ready && input.decisionStatus === 'approved') {
    throw new SiteForgePlanError('Plan has unresolved readiness blockers', 409)
  }

  const modifiedPlan =
    input.decisionStatus === 'modified'
      ? siteForgePlanSchema.parse(input.modifiedPlan)
      : null
  if (modifiedPlan && modifiedPlan.propertyId !== input.propertyId) {
    throw new SiteForgePlanError('Modified plan property cannot be changed', 400)
  }
  const modifiedContentHash = modifiedPlan
    ? hashSiteForgeContent(modifiedPlan)
    : null
  if (modifiedContentHash === current.contentHash) {
    throw new SiteForgePlanError('Modified plan must change the approved content', 400)
  }

  const actionAttemptId = await ensureApprovalProposal(
    current,
    input.reviewerProfileId,
    supabase
  )
  const decision = await recordSharedApprovalDecision(
    {
      propertyId: input.propertyId,
      actionAttemptId,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus: input.decisionStatus,
      decisionReason: input.decisionReason,
      modifiedPayload:
        input.decisionStatus === 'modified'
          ? {
              plan: modifiedPlan,
              priorRevision: current.revision,
            }
          : null,
      decisionPayload: {
        planId: current.planId,
        planVersionId: current.planVersionId,
        revision: current.revision,
        contentHash: current.contentHash,
      },
      policyDecision: {
        policyName: 'siteforge_plan_confirmation',
        policyVersion: 'v1',
        confidenceScore: current.readiness.ready ? 1 : 0,
        decisionPayload: {
          readiness: current.readiness,
        },
      },
    },
    supabase
  )

  const now = new Date().toISOString()
  if (input.decisionStatus === 'approved') {
    const { data, error } = await supabase
      .from('siteforge_plans')
      .update({
        status: 'confirmed',
        confirmed_version_id: current.planVersionId,
        confirmed_approval_id: decision.approval.id,
        confirmed_by: input.reviewerProfileId,
        confirmed_at: now,
        decision_reason: input.decisionReason.trim(),
        updated_at: now,
      })
      .eq('id', current.planId)
      .eq('current_revision', current.revision)
      .eq('status', 'ready_for_review')
      .select('id')
      .single()

    if (error || !data) {
      throw new SiteForgePlanError('Plan changed before confirmation completed', 409)
    }
  } else if (input.decisionStatus === 'denied') {
    const { error } = await supabase
      .from('siteforge_plans')
      .update({
        status: 'denied',
        decision_reason: input.decisionReason.trim(),
        updated_at: now,
      })
      .eq('id', current.planId)
      .eq('current_revision', current.revision)

    if (error) {
      throw new SiteForgePlanError('Failed to update plan decision state', 500)
    }
  } else if (modifiedPlan) {
    const { data: priorVersion, error: priorVersionError } = await supabase
      .from('siteforge_plan_versions')
      .select('context_snapshot_id, conversation_history')
      .eq('id', current.planVersionId)
      .single()
    if (priorVersionError || !priorVersion) {
      throw new SiteForgePlanError('Prior plan context was not found', 500)
    }

    const nextRevision = current.revision + 1
    const nextContentHash = modifiedContentHash!

    const { data: nextVersion, error: nextVersionError } = await supabase
      .from('siteforge_plan_versions')
      .insert({
        plan_id: current.planId,
        revision: nextRevision,
        context_snapshot_id: priorVersion.context_snapshot_id,
        plan: modifiedPlan as unknown as Json,
        preferences: modifiedPlan.preferences as unknown as Json,
        readiness_report: current.readiness as unknown as Json,
        conversation_history: priorVersion.conversation_history,
        content_hash: nextContentHash,
        created_by: input.reviewerProfileId,
        created_at: now,
      })
      .select('id')
      .single()
    if (nextVersionError || !nextVersion) {
      throw new SiteForgePlanError('Failed to persist modified plan revision', 500)
    }

    const { data: updated, error: updateError } = await supabase
      .from('siteforge_plans')
      .update({
        current_revision: nextRevision,
        status: 'ready_for_review',
        approval_action_attempt_id: null,
        confirmed_version_id: null,
        confirmed_approval_id: null,
        confirmed_by: null,
        confirmed_at: null,
        decision_reason: input.decisionReason.trim(),
        updated_at: now,
      })
      .eq('id', current.planId)
      .eq('current_revision', current.revision)
      .select('id')
      .single()
    if (updateError || !updated) {
      throw new SiteForgePlanError('Plan changed before modification completed', 409)
    }

    return {
      planId: current.planId,
      planVersionId: nextVersion.id,
      revision: nextRevision,
      contentHash: nextContentHash,
      status: 'ready_for_review' as const,
      approvalId: decision.approval.id,
      actionAttemptId,
    }
  }

  return {
    planId: current.planId,
    planVersionId: current.planVersionId,
    revision: current.revision,
    contentHash: current.contentHash,
    status:
      input.decisionStatus === 'approved' ? 'confirmed' : 'denied',
    approvalId: decision.approval.id,
    actionAttemptId,
  }
}
