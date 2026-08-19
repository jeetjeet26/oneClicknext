import { FatalError } from 'workflow'
import { createServiceClient } from '@/utils/supabase/admin'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import {
  type ArchitectureProposal,
} from '@/utils/siteforge/agents/architecture-agent'
import { DesignAgent, type DesignSystem } from '@/utils/siteforge/agents/design-agent'
import {
  PhotoAgent,
  type PhotoManifest,
  type PhotoStrategy,
} from '@/utils/siteforge/agents/photo-agent'
import { ContentAgent } from '@/utils/siteforge/agents/content-agent'
import { QualityAgent, type QualityReport } from '@/utils/siteforge/agents/quality-agent'
import { WordPressMcpClient } from '@/utils/mcp/wordpress-client'
import { persistSiteForgeAssets } from '@/utils/siteforge/assets/repository'
import { publishSiteForgeArtifact } from '@/utils/siteforge/artifacts/repository'
import {
  extractSourcedMapLocation,
  finalizeSiteForgePages,
} from '@/utils/siteforge/generation/finalize-pages'
import { loadFreshApprovedFloorPlanInventory } from '@/utils/siteforge/providers/floor-plan-repository'
import { createApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plans'
import {
  buildWordPressThemeArtifact,
  type WordPressFontAsset,
} from '@/utils/siteforge/wordpress/theme-artifact'
import {
  createDefaultSiteForgeAnalyticsConfig,
  createSiteForgeLegalConfigFromSnapshot,
  evaluateDeterministicSiteForgeQuality,
  type SiteForgeLegalConfig,
} from '@/utils/siteforge/quality/deterministic-gates'
import { verifyKnowledgeBaseEvidenceIds } from '@/utils/siteforge/quality/knowledge-evidence'
import { evaluateSiteForgePremiumCreative } from '@/utils/siteforge/quality/premium-creative'
import {
  siteBlueprintV3Schema,
  type GeneratedPage,
  type GenerationPreferences,
} from '@/types/siteforge'
import type { Json, TablesUpdate } from '@/types/supabase'
import {
  type SiteForgeGenerationEvidenceSnapshot,
  siteForgePlanSchema,
  type SiteForgePlan,
  type SiteForgePlanV1,
} from '@/utils/siteforge/contracts'
import {
  brandForgeContractV1Schema,
} from '@/utils/brandforge/contracts'
import { compileBrandContractForSiteForge } from '@/utils/siteforge/brand-contract-adapter'
import {
  enforceBrandPublicationDesignSystem,
} from '@/utils/siteforge/brand-design-compiler'
import { hashBrandForgeContract } from '@/utils/brandforge/normalize'
import { brandContextFromContract } from '@/utils/siteforge/brand-contract-adapter'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  assertSiteForgeGenerationEvidenceCurrent,
} from '@/utils/siteforge/plans/repository'
import {
  assertRegisteredSiteForgeArchitecture,
  composeApprovedSiteForgeArchitecture,
  parseSiteForgeCreativeExecutionContext,
  type SiteForgeCreativeExecutionContext,
} from '@/utils/siteforge/generation/creative-execution'

export type SiteForgeGenerationWorkflowInput = {
  sharedJobId: string
  /** Historic siteforge_jobs row id; retained in old payloads, never written. */
  legacyJobId?: string
  websiteId: string
  propertyId: string
  orgId: string
  planVersionId: string
  preferences: GenerationPreferences
  prompt: string
  approvedBrief?: Record<string, unknown>
  approvedCreativeDirection?: Record<string, unknown>
  evidenceSnapshot?: SiteForgeGenerationEvidenceSnapshot
  startedAt: string
}

export type SiteForgeGenerationFailure = {
  code: string
  retryable: boolean
  failedCheckpoint: string
  message: string
  safeMessage: string
}

export const SITEFORGE_LEGAL_REMEDIATION =
  'Complete and approve every Legal section in property onboarding, then reconfirm the SiteForge plan before generating a new artifact.'

type EvidenceBoundGenerationInput = SiteForgeGenerationWorkflowInput & {
  approvedBrief: Record<string, unknown>
  approvedCreativeDirection: Record<string, unknown>
  evidenceSnapshot: SiteForgeGenerationEvidenceSnapshot
}

function requireEvidenceBoundGenerationInput(
  input: SiteForgeGenerationWorkflowInput
): asserts input is EvidenceBoundGenerationInput {
  if (
    !input.approvedBrief ||
    !input.approvedCreativeDirection ||
    !input.evidenceSnapshot
  ) {
    throw new FatalError(
      'Generation requires an approved brief, creative direction, and evidence snapshot; start a new generation request'
    )
  }
}

function creativeExecutionFromInput(
  input: SiteForgeGenerationWorkflowInput
): SiteForgeCreativeExecutionContext {
  requireEvidenceBoundGenerationInput(input)
  return parseSiteForgeCreativeExecutionContext({
    approvedBrief: input.approvedBrief,
    approvedCreativeDirection: input.approvedCreativeDirection,
  })
}

type TopologyPage = {
  slug: string
  title: string
  sections: Array<{ id: string; block: string }>
}

export type SiteForgeTopologyDiff = {
  matches: boolean
  expected: TopologyPage[]
  actual: TopologyPage[]
  changes: string[]
}

export function buildSiteForgeTopologyDiff(
  confirmedPlan: Pick<SiteForgePlan, 'pages'>,
  pages: GeneratedPage[]
): SiteForgeTopologyDiff {
  const expected = confirmedPlan.pages.map(page => ({
    slug: page.slug,
    title: page.title,
    sections: page.sections.map(section => ({
      id: section.id,
      block: section.block,
    })),
  }))
  const actual = pages.map(page => ({
    slug: page.slug,
    title: page.title,
    sections: page.sections.map(section => ({
      id: section.id || '',
      block: section.acfBlock || '',
    })),
  }))
  const changes: string[] = []
  const expectedBySlug = new Map(expected.map((page, index) => [page.slug, { page, index }]))
  const actualBySlug = new Map(actual.map((page, index) => [page.slug, { page, index }]))

  for (const { page, index } of expectedBySlug.values()) {
    const generated = actualBySlug.get(page.slug)
    if (!generated) {
      changes.push(`page removed: ${page.slug}`)
      continue
    }
    if (generated.index !== index) {
      changes.push(`page moved: ${page.slug} ${index}->${generated.index}`)
    }
    if (generated.page.title !== page.title) {
      changes.push(`page title changed: ${page.slug}`)
    }
    const expectedSections = page.sections.map(section => `${section.id}:${section.block}`)
    const actualSections = generated.page.sections.map(
      section => `${section.id}:${section.block}`
    )
    if (JSON.stringify(actualSections) !== JSON.stringify(expectedSections)) {
      changes.push(
        `section topology changed: ${page.slug} expected [${expectedSections.join(', ')}] actual [${actualSections.join(', ')}]`
      )
    }
  }
  for (const { page } of actualBySlug.values()) {
    if (!expectedBySlug.has(page.slug)) {
      changes.push(`page added: ${page.slug}`)
    }
  }

  return {
    matches: changes.length === 0,
    expected,
    actual,
    changes,
  }
}

const FORBIDDEN_GENERATED_COPY =
  /\b(?:click to edit|lorem ipsum|placeholder|todo|xxx|content for the .+ section)\b/i

// Image placeholders are explicitly allowed (photos are optional inputs); the
// junk-copy ban applies to prose, not to asset URLs or storage paths.
function isAssetReference(value: string): boolean {
  return /^(?:https?:\/\/|\/|assets\/)/i.test(value.trim())
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(stringLeaves)
  }
  return []
}

export function assertPublishableGeneratedPages(pages: GeneratedPage[]): void {
  const placeholderLocations = pages.flatMap(page =>
    page.sections.flatMap(section => {
      const strings = stringLeaves(section.content)
      const hasPlaceholder = strings.some(value =>
        !isAssetReference(value) && FORBIDDEN_GENERATED_COPY.test(value)
      )
      return hasPlaceholder ? [`${page.slug}/${section.id || section.type}`] : []
    })
  )
  if (placeholderLocations.length) {
    throw new FatalError(
      `Generated pages contain non-publishable placeholder copy: ${placeholderLocations.join(', ')}`
    )
  }
}

export function resolveApprovedLegalContractForGeneration(
  confirmedPlan: Pick<SiteForgePlan, 'onboardingSnapshot'>,
  pinnedSnapshot:
    | {
        snapshot_payload: unknown
        content_hash: string
      }
    | null
): SiteForgeLegalConfig {
  if (!confirmedPlan.onboardingSnapshot) {
    throw new FatalError(
      `New SiteForge generation requires a pinned onboarding snapshot with approved legal source data. ${SITEFORGE_LEGAL_REMEDIATION}`
    )
  }
  if (
    !pinnedSnapshot ||
    pinnedSnapshot.content_hash !== confirmedPlan.onboardingSnapshot.contentHash
  ) {
    throw new FatalError(
      `The pinned onboarding legal source is unavailable or changed. ${SITEFORGE_LEGAL_REMEDIATION}`
    )
  }
  try {
    return createSiteForgeLegalConfigFromSnapshot(
      pinnedSnapshot.snapshot_payload
    )
  } catch {
    throw new FatalError(
      `The pinned onboarding snapshot does not contain a complete approved legal contract. ${SITEFORGE_LEGAL_REMEDIATION}`
    )
  }
}

export async function assertSiteForgeJobActive(
  input: SiteForgeGenerationWorkflowInput
): Promise<void> {
  'use step'

  console.info('[siteforge_workflow] checking cancellation', {
    sharedJobId: input.sharedJobId,
  })
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('shared_jobs')
    .select('lifecycle_status, cancel_requested')
    .eq('id', input.sharedJobId)
    .single()

  if (error || !data) {
    throw new Error(`Failed to load SiteForge job: ${error?.message || 'not found'}`)
  }
  if (data.cancel_requested || data.lifecycle_status === 'cancelled') {
    throw new FatalError('SiteForge generation was cancelled')
  }
}

export async function updateSiteForgeGenerationStage(
  input: SiteForgeGenerationWorkflowInput,
  stage: string,
  progress: number,
  currentStep: string
): Promise<void> {
  'use step'

  console.info('[siteforge_workflow] stage started', {
    sharedJobId: input.sharedJobId,
    stage,
    progress,
  })
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const sharedUpdate: TablesUpdate<'shared_jobs'> = {
    lifecycle_status: 'running',
    status_reason: stage,
    stage,
    progress,
    current_step: currentStep,
    heartbeat_at: now,
    started_at: progress === 5 ? now : undefined,
    error_message: null,
    error_details: null,
    updated_at: now,
  }
  const { error: sharedError } = await supabase
    .from('shared_jobs')
    .update(sharedUpdate)
    .eq('id', input.sharedJobId)
  if (sharedError) {
    throw new Error(`Failed to persist workflow stage: ${sharedError.message}`)
  }
}

export async function analyzeSiteForgeBrand(
  input: SiteForgeGenerationWorkflowInput
): Promise<BrandContext> {
  'use step'

  console.info('[siteforge_workflow] brand analysis started', {
    sharedJobId: input.sharedJobId,
  })
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('siteforge_plan_versions')
    .select(`
      plan,
      brand_asset_id,
      brand_contract_version,
      brand_contract_hash,
      onboarding_snapshot_id,
      onboarding_snapshot_hash
    `)
    .eq('id', input.planVersionId)
    .single()
  if (error || !data) {
    throw new FatalError('Pinned SiteForge brand context is unavailable')
  }
  const plan = siteForgePlanSchema.parse(data.plan)
  if (!plan.brandSnapshot || !plan.onboardingSnapshot) {
    throw new FatalError('Confirmed SiteForge plan predates required brand and onboarding snapshots')
  }
  const contract = brandForgeContractV1Schema.parse(plan.brandSnapshot.contract)
  const contractHash = hashBrandForgeContract(contract)
  if (
    contractHash !== plan.brandSnapshot.contractHash
    || contractHash !== data.brand_contract_hash
    || plan.brandSnapshot.assetId !== data.brand_asset_id
    || plan.brandSnapshot.contractVersion !== data.brand_contract_version
  ) {
    throw new FatalError('Pinned BrandForge contract hash does not match the confirmed plan')
  }
  const { data: snapshot, error: snapshotError } = await supabase
    .from('property_onboarding_snapshots')
    .select('id, property_id, content_hash')
    .eq('id', data.onboarding_snapshot_id || '')
    .single()
  if (
    snapshotError
    || !snapshot
    || snapshot.property_id !== input.propertyId
    || snapshot.content_hash !== data.onboarding_snapshot_hash
    || snapshot.content_hash !== plan.onboardingSnapshot.contentHash
  ) {
    throw new FatalError('Pinned onboarding snapshot hash does not match the confirmed plan')
  }
  return brandContextFromContract(
    contract,
    input.evidenceSnapshot?.assetManifest.assets
  )
}

export async function loadConfirmedSiteForgePlan(
  input: SiteForgeGenerationWorkflowInput
): Promise<SiteForgePlan> {
  'use step'

  requireEvidenceBoundGenerationInput(input)
  const context = await assertSiteForgeGenerationEvidenceCurrent(
    input.evidenceSnapshot
  )
  if (
    context.websiteId !== input.websiteId ||
    context.propertyId !== input.propertyId ||
    context.orgId !== input.orgId ||
    context.planVersionId !== input.planVersionId ||
    hashSiteForgeContent(input.preferences) !==
      hashSiteForgeContent(context.plan.preferences) ||
    hashSiteForgeContent(input.approvedBrief) !== hashSiteForgeContent(context.brief) ||
    hashSiteForgeContent(input.approvedCreativeDirection) !==
      hashSiteForgeContent(context.creativeDirection)
  ) {
    throw new FatalError(
      'Generation input does not match the approved evidence snapshot'
    )
  }
  return context.plan
}

export function applyApprovedGenerationPreferences(
  designSystem: DesignSystem,
  preferences: GenerationPreferences
): DesignSystem {
  const density = preferences.contentDensity
  const densitySpacing = density === 'minimal'
    ? {
        scale: 'luxury' as const,
        sectionPadding: 'clamp(5rem, 10vw, 10rem)',
      }
    : density === 'rich'
      ? {
          scale: 'tight' as const,
          sectionPadding: 'clamp(2.5rem, 5vw, 5rem)',
        }
      : null
  const motionLevel = preferences.motion === 'expressive'
    ? 'prominent' as const
    : preferences.motion === 'none'
      ? 'none' as const
      : 'subtle' as const

  return {
    ...designSystem,
    spacing: densitySpacing
      ? {
          ...designSystem.spacing,
          ...densitySpacing,
          reasoning: `${designSystem.spacing.reasoning} Approved content density: ${density}.`,
        }
      : designSystem.spacing,
    animations: {
      ...designSystem.animations,
      level: motionLevel,
      types: motionLevel === 'none' ? [] : designSystem.animations.types,
      reasoning:
        `${designSystem.animations.reasoning} Approved motion preference: ${preferences.motion || 'subtle'}.`,
    },
  }
}

export function enforcePinnedBrandDesignSystem(
  designSystem: DesignSystem,
  contract: BrandForgeContractV1 | undefined
): DesignSystem {
  if (!contract) return designSystem
  return enforceBrandPublicationDesignSystem(
    designSystem,
    compileBrandContractForSiteForge(contract),
  )
}

export async function planSiteForgeArchitectureAndDesign(
  input: SiteForgeGenerationWorkflowInput,
  brandContext: BrandContext,
  confirmedPlan: SiteForgePlan
): Promise<{ architecture: ArchitectureProposal; designSystem: DesignSystem }> {
  'use step'

  console.info('[siteforge_workflow] architecture and design started', {
    sharedJobId: input.sharedJobId,
  })
  const execution = creativeExecutionFromInput(input)
  const architecture = composeApprovedSiteForgeArchitecture(
    confirmedPlan,
    execution,
    input.preferences
  )
  assertRegisteredSiteForgeArchitecture(architecture)
  const designSystem = applyApprovedGenerationPreferences(
    await new DesignAgent(input.propertyId).createSystem(
      brandContext,
      undefined,
      execution
    ),
    input.preferences
  )
  return { architecture, designSystem }
}

export function architectureFromConfirmedPlan(
  confirmedPlan: {
    schemaVersion?: 1 | 2
    pages: ReadonlyArray<{
      slug: string
      title: string
      navLabel: string
      purpose: string
      sections: ReadonlyArray<
        SiteForgePlanV1['pages'][number]['sections'][number]
      >
    }>
    conversionStrategy?: { primaryAction: string }
    conversionIntents?: ReadonlyArray<{ intent: string }>
  }
): ArchitectureProposal {
  return {
    navigation: {
      structure: 'primary',
      items: confirmedPlan.pages.map((page, index) => ({
        label: page.navLabel,
        slug: page.slug,
        priority: index === 0 ? 'high' : 'medium',
      })),
      reasoning: 'Exact navigation projection of the confirmed SiteForge plan.',
    },
    pages: confirmedPlan.pages.map((page, pageIndex) => ({
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      priority: pageIndex === 0 ? 'high' : 'medium',
      sections: page.sections.map((section, sectionIndex) => ({
        id: section.id,
        type: section.label,
        purpose: section.purpose,
        block: section.block,
        variant: section.variant,
        fields: {
          factsRequired: section.factsRequired,
          evidenceIds: section.evidenceIds,
          required: section.required,
        },
        reasoning: 'Exact section projection of the confirmed SiteForge plan.',
        order: sectionIndex,
      })),
    })),
    conversionStrategy: {
      primaryCTA:
        confirmedPlan.schemaVersion === 2
          ? confirmedPlan.conversionIntents?.[0]?.intent || 'inquiry'
          : confirmedPlan.conversionStrategy?.primaryAction || 'contact',
      ctaPlacement: ['confirmed-plan'],
      reasoning: 'Exact conversion intent from the confirmed SiteForge plan.',
    },
  }
}

export async function planSiteForgePhotos(
  input: SiteForgeGenerationWorkflowInput,
  brandContext: BrandContext,
  architecture: ArchitectureProposal
): Promise<PhotoStrategy> {
  'use step'

  console.info('[siteforge_workflow] photo planning started', {
    sharedJobId: input.sharedJobId,
  })
  return new PhotoAgent(input.propertyId).planStrategy(
    brandContext,
    architecture,
    creativeExecutionFromInput(input)
  )
}

export async function generateSiteForgeContent(
  input: SiteForgeGenerationWorkflowInput,
  architecture: ArchitectureProposal,
  brandContext: BrandContext
): Promise<GeneratedPage[]> {
  'use step'

  console.info('[siteforge_workflow] content generation started', {
    sharedJobId: input.sharedJobId,
  })
  const pages = await new ContentAgent(input.propertyId).generateAll(
    architecture,
    brandContext,
    creativeExecutionFromInput(input)
  )
  assertPublishableGeneratedPages(pages)
  return pages
}

export async function executeSiteForgePhotos(
  input: SiteForgeGenerationWorkflowInput,
  strategy: PhotoStrategy,
  pages: GeneratedPage[],
  brandContext: BrandContext
): Promise<PhotoManifest> {
  'use step'

  console.info('[siteforge_workflow] photo execution started', {
    sharedJobId: input.sharedJobId,
  })
  const manifest = await new PhotoAgent(input.propertyId).execute(
    strategy,
    pages,
    brandContext
  )
  return manifest
}

export async function validateSiteForgeOutput(
  input: SiteForgeGenerationWorkflowInput,
  confirmedPlan: SiteForgePlan,
  pages: GeneratedPage[],
  designSystem: DesignSystem,
  photoManifest: PhotoManifest,
  brandContext: BrandContext
): Promise<QualityReport> {
  'use step'

  console.info('[siteforge_workflow] quality validation started', {
    sharedJobId: input.sharedJobId,
  })
  const topologyDiff = buildSiteForgeTopologyDiff(confirmedPlan, pages)
  if (!topologyDiff.matches) {
    console.error('[siteforge_workflow] generation topology drift', {
      sharedJobId: input.sharedJobId,
      topologyDiff,
    })
    throw new FatalError(
      `Generated topology differs from the confirmed plan: ${JSON.stringify(topologyDiff)}`
    )
  }
  assertPublishableGeneratedPages(pages)
  const wpCapabilities = await new WordPressMcpClient().getCapabilities(
    'template-collection-theme'
  )
  return new QualityAgent(input.propertyId).validate({
    pages,
    designSystem,
    photoManifest,
    brandContext,
    wpCapabilities,
  })
}

export async function persistSiteForgeGenerationArtifact(
  input: SiteForgeGenerationWorkflowInput,
  confirmedPlan: SiteForgePlan,
  brandContext: BrandContext,
  architecture: ArchitectureProposal,
  designSystem: DesignSystem,
  photoManifest: PhotoManifest,
  pages: GeneratedPage[],
  qualityReport: QualityReport
): Promise<{
  artifactId: string
  artifactVersion: number
  artifactContentHash: string
  pages: number
  sections: number
  qualityScore: number
  generationTime: number
}> {
  'use step'

  console.info('[siteforge_workflow] artifact persistence started', {
    sharedJobId: input.sharedJobId,
    websiteId: input.websiteId,
    planVersionId: input.planVersionId,
  })
  requireEvidenceBoundGenerationInput(input)
  const generationTime = Math.max(
    0,
    Date.now() - new Date(input.startedAt).getTime()
  )
  const now = new Date().toISOString()
  const supabase = createServiceClient()
  if (!confirmedPlan.onboardingSnapshot) {
    resolveApprovedLegalContractForGeneration(confirmedPlan, null)
  }
  const { data: onboardingSnapshot, error: onboardingError } = await supabase
    .from('property_onboarding_snapshots')
    .select('snapshot_payload, content_hash')
    .eq('id', confirmedPlan.onboardingSnapshot!.id)
    .eq('property_id', input.propertyId)
    .single()
  const legal = resolveApprovedLegalContractForGeneration(
    confirmedPlan,
    onboardingError ? null : onboardingSnapshot
  )
  const propertySnapshot = onboardingSnapshot!.snapshot_payload
  assertPublishableGeneratedPages(pages)
  const durablePhotoManifest = await persistSiteForgeAssets(
    input.websiteId,
    photoManifest
  )
  let floorPlanInventory = {
    snapshot: createApprovedFloorPlanSnapshot([], now),
    stale: false,
  }
  if (
    confirmedPlan.schemaVersion === 1 &&
    input.evidenceSnapshot.schemaVersion === 1
  ) {
    try {
      floorPlanInventory = await loadFreshApprovedFloorPlanInventory(
        input.propertyId,
        supabase,
        now,
        confirmedPlan.floorPlanStrategy.freshnessHours
      )
    } catch (error) {
      if (input.evidenceSnapshot.inventory.required) {
        throw new FatalError(
          `Failed to load required approved floor-plan inventory: ${
            error instanceof Error ? error.message : 'unknown inventory error'
          }`
        )
      }
      console.warn('[siteforge_workflow] optional floor-plan inventory unavailable', {
        sharedJobId: input.sharedJobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (confirmedPlan.schemaVersion === 2) {
    // The V2 lane pins offering-catalog identity in the plan, but the
    // publishable rows still live in property_units. Load them here so
    // plans-availability sections render real inventory; missing rows omit
    // those facts instead of blocking (solo-operator doctrine).
    try {
      floorPlanInventory = await loadFreshApprovedFloorPlanInventory(
        input.propertyId,
        supabase,
        now,
        confirmedPlan.offeringStrategies.find(strategy =>
          Number.isFinite(strategy.freshnessHours)
        )?.freshnessHours || 8_760
      )
    } catch (error) {
      console.warn(
        '[siteforge_workflow] V2 offering inventory unavailable; omitting inventory facts',
        {
          sharedJobId: input.sharedJobId,
          error: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }
  const floorPlanSnapshot = floorPlanInventory.snapshot
  if (
    input.evidenceSnapshot.schemaVersion === 1 &&
    input.evidenceSnapshot.inventory.required &&
    (
      floorPlanSnapshot.rows.length === 0 ||
      floorPlanSnapshot.contentHash !== input.evidenceSnapshot.inventory.contentHash
    )
  ) {
    throw new FatalError(
      'Approved floor-plan inventory changed or is no longer publishable'
    )
  }
  const { data: approvedPointsOfInterest, error: pointsOfInterestError } =
    await supabase
      .from('property_points_of_interest')
      .select(
        'name, category, address, distance_miles, travel_time_minutes, source_url'
      )
      .eq('property_id', input.propertyId)
      .eq('approval_status', 'approved')
      .order('category', { ascending: true })
      .order('name', { ascending: true })
  if (pointsOfInterestError) {
    throw new FatalError(
      `Failed to load approved neighborhood points of interest: ${pointsOfInterestError.message}`
    )
  }
  const { data: approvedReviewRows, error: approvedReviewsError } =
    await supabase
      .from('review_testimonial_approvals')
      .select(
        'id, reviewer_name_snapshot, review_text_snapshot, rating_snapshot, platform_snapshot, review_date_snapshot'
      )
      .eq('property_id', input.propertyId)
      .eq('status', 'active')
      .gte('rating_snapshot', 4)
      .not('review_date_snapshot', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(12)
  if (approvedReviewsError) {
    throw new FatalError(
      `Failed to load approved ReviewFlow reviews: ${approvedReviewsError.message}`
    )
  }
  const approvedReviews = (approvedReviewRows || []).flatMap(review =>
    review.reviewer_name_snapshot &&
    review.review_text_snapshot &&
    review.rating_snapshot &&
    review.review_date_snapshot
      ? [
          {
            id: review.id,
            reviewerName: review.reviewer_name_snapshot,
            reviewText: review.review_text_snapshot,
            rating: review.rating_snapshot,
            platform: review.platform_snapshot,
            reviewDate: review.review_date_snapshot,
          },
        ]
      : []
  )
  const finalizedPages = finalizeSiteForgePages(
    pages,
    durablePhotoManifest,
    legal,
    floorPlanSnapshot,
    approvedPointsOfInterest || [],
    {
      mapLocation: extractSourcedMapLocation(propertySnapshot),
      ...(confirmedPlan.schemaVersion === 1
        ? {
            formProviders: {
              lead: confirmedPlan.conversionStrategy.leadDestination,
              tour: confirmedPlan.conversionStrategy.tourDestination,
            },
            floorPlanStrategy: confirmedPlan.floorPlanStrategy,
          }
        : {
            catalogSnapshots: confirmedPlan.offeringCatalog.snapshots,
            seoBySlug: Object.fromEntries(
              confirmedPlan.pages.map(page => [page.slug, page.seo])
            ),
            primaryConversionIntent:
              confirmedPlan.conversionIntents.at(-1)?.intent ||
              confirmedPlan.conversionIntents[0]?.intent,
          }),
    },
    approvedReviews
  )
  assertPublishableGeneratedPages(finalizedPages)
  if (!qualityReport.passed) {
    console.warn('[siteforge_workflow] advisory AI quality score below target', {
      sharedJobId: input.sharedJobId,
      score: Math.round(qualityReport.score),
      improvements: qualityReport.improvements,
    })
  }
  const wordpressCapabilities = await new WordPressMcpClient().getCapabilities(
    'template-collection-theme'
  )
  const fontRoles = confirmedPlan.brandSnapshot?.contract.typography.roles || []
  const fontAssetIds = fontRoles.flatMap(role =>
    role.assetId ? [role.assetId] : []
  )
  const fontAssetResult = fontAssetIds.length
    ? await createServiceClient()
        .from('content_assets')
        .select('id, property_id, asset_role, file_url, format, rights_status, approval_status, expires_at')
        .eq('property_id', input.propertyId)
        .in('id', fontAssetIds)
    : { data: [], error: null }
  if (fontAssetResult.error) {
    throw new FatalError(`Failed to load approved brand fonts: ${fontAssetResult.error.message}`)
  }
  const fontRows = new Map((fontAssetResult.data || []).map(asset => [asset.id, asset]))
  const wordpressFontAssets: WordPressFontAsset[] = fontRoles.map(role => {
    if (!role.assetId) {
      if (!role.fallback) {
        throw new FatalError(`Brand font "${role.family}" has no approved file or fallback decision`)
      }
      return {
        role: role.role,
        family: role.family,
        weights: role.weights,
        source: 'fallback',
        fallback: role.fallback,
        preload: false,
      }
    }
    const asset = fontRows.get(role.assetId)
    // Rights/expiry are passive metadata; the font must still be a real
    // approved WOFF2 asset so the theme build cannot reference missing files.
    if (
      !asset
      || asset.asset_role !== 'font'
      || asset.approval_status !== 'approved'
      || asset.format?.toLowerCase() !== 'woff2'
    ) {
      throw new FatalError(`Brand font asset ${role.assetId} is not an approved WOFF2 file`)
    }
    return {
      role: role.role,
      family: role.family,
      weights: role.weights,
      source: 'asset',
      assetId: asset.id,
      url: asset.file_url,
      fallback: role.fallback || 'Arial, sans-serif',
      preload: role.role === 'headline' || role.role === 'body',
    }
  })
  const brandPublication = confirmedPlan.brandSnapshot?.contract
    ? compileBrandContractForSiteForge(confirmedPlan.brandSnapshot.contract)
    : undefined
  const enforcedDesignSystem = enforcePinnedBrandDesignSystem(
    designSystem,
    confirmedPlan.brandSnapshot?.contract
  )
  const wordpressThemeArtifact = buildWordPressThemeArtifact(
    enforcedDesignSystem,
    wordpressCapabilities,
    undefined,
    wordpressFontAssets,
    undefined,
    brandPublication,
  )
  const analytics = createDefaultSiteForgeAnalyticsConfig()
  const verifiedKnowledgeBaseEvidenceIds =
    await verifyKnowledgeBaseEvidenceIds(
      supabase,
      input.propertyId,
      finalizedPages
    )
  const deterministicQualityReport = evaluateDeterministicSiteForgeQuality({
    pages: finalizedPages,
    confirmedPlan,
    photoManifest: durablePhotoManifest,
    themeArtifact: wordpressThemeArtifact,
    legal,
    analytics,
    additionalTrustedEvidenceIds: [
      ...verifiedKnowledgeBaseEvidenceIds,
      ...approvedReviews.map(review => review.id),
    ],
    evaluatedAt: now,
  })
  if (!deterministicQualityReport.passed) {
    const blockers = deterministicQualityReport.checks
      .filter((check) => !check.passed && check.severity === 'blocker')
      .map((check) =>
        check.locations.length
          ? `${check.id} (${check.locations.join(', ')})`
          : check.id
      )
    // Failed runs persist nothing, so emit the complete diagnostic surface to
    // runtime logs: the full report plus the evidence each section cited.
    console.error('[siteforge_workflow] deterministic gate failure detail', {
      sharedJobId: input.sharedJobId,
      report: deterministicQualityReport,
      sectionEvidence: finalizedPages.map(page => ({
        slug: page.slug,
        sections: page.sections.map(section => ({
          id: section.id,
          block: section.acfBlock,
          evidenceIds: section.evidenceIds,
        })),
      })),
      verifiedKnowledgeBaseEvidenceIds,
    })
    throw new FatalError(
      `Deterministic quality gates failed: ${blockers.join(', ')}`
    )
  }
  const blueprintCore = {
    version: confirmedPlan.schemaVersion === 2 ? 3 : 2,
    propertyId: input.propertyId,
    propertySnapshot,
    updatedAt: now,
    confirmedPlan,
    generationEvidence: input.evidenceSnapshot,
    topologyDiff: buildSiteForgeTopologyDiff(confirmedPlan, pages),
    approvedBrief: input.approvedBrief,
    approvedCreativeDirection: input.approvedCreativeDirection,
    brandSnapshot: confirmedPlan.brandSnapshot,
    onboardingSnapshot: confirmedPlan.onboardingSnapshot,
    brandContext,
    architecture,
    designSystem: enforcedDesignSystem,
    siteConfiguration: wordpressThemeArtifact.siteConfiguration,
    wordpressThemeArtifact,
    legal,
    analytics:
      confirmedPlan.schemaVersion === 2
        ? {
            consentMode: confirmedPlan.analyticsRecipe.consentMode,
            events: confirmedPlan.analyticsRecipe.outcomes.map(
              outcome => outcome.eventName
            ),
            outcomes: confirmedPlan.analyticsRecipe.outcomes,
          }
        : analytics,
    deterministicQualityReport,
    photoManifest: durablePhotoManifest,
    pages: finalizedPages,
    qualityReport,
    generationTime,
    agentLogs: [
      { agent: 'brand', action: 'loadPinnedContract', timestamp: now },
      { agent: 'architecture', action: 'plan', timestamp: now },
      { agent: 'design', action: 'createSystem', timestamp: now },
      { agent: 'photo', action: 'planAndExecute', timestamp: now },
      { agent: 'content', action: 'generateAll', timestamp: now },
      { agent: 'quality', action: 'validate', timestamp: now },
    ],
  }
  const blueprint =
    confirmedPlan.schemaVersion === 2
      ? siteBlueprintV3Schema.parse({
          ...blueprintCore,
          schemaVersion: 3,
          manifestPins: {
            planContentHash: input.evidenceSnapshot.plan.contentHash,
            verticalProfileContentHash:
              confirmedPlan.verticalProfile.contentHash,
            verticalPackContentHash:
              confirmedPlan.verticalPackManifest.contentHash,
            subjectHierarchyContentHash:
              confirmedPlan.subjectHierarchy.contentHash,
            offeringCatalogContentHash:
              confirmedPlan.offeringCatalog.contentHash,
            policySetContentHash: confirmedPlan.policySet.contentHash,
            discoveryContentHash: confirmedPlan.discovery.discoveryHash,
          },
        })
      : blueprintCore
  const { data: updatedWebsite, error } = await supabase
    .from('property_websites')
    .update({
      site_architecture: architecture as unknown as Json,
      pages_generated: finalizedPages as unknown as Json,
      assets_manifest: durablePhotoManifest as unknown as Json,
      brand_source: brandContext.source,
      brand_confidence: brandContext.confidence,
      generation_completed_at: now,
      generation_duration_seconds: Math.floor(generationTime / 1_000),
    })
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .eq('org_id', input.orgId)
    .select('id')
    .maybeSingle()
  if (error || !updatedWebsite) {
    throw new Error(
      `Failed to persist generated blueprint: ${
        error?.message || 'website row was not updated'
      }`
    )
  }
  // Advisory premium-creative score (solo-operator doctrine: informational
  // only, never blocks publication). Failures to score must never fail runs.
  let premiumCreative = null
  try {
    premiumCreative = evaluateSiteForgePremiumCreative({
      pages: finalizedPages,
      brandContext,
      evaluatedAt: now,
    })
    if (premiumCreative) {
      console.info('[siteforge_workflow] advisory premium creative score', {
        sharedJobId: input.sharedJobId,
        pageSlug: premiumCreative.pageSlug,
        normalizedScore: premiumCreative.normalizedScore,
        passed: premiumCreative.passed,
        findings: premiumCreative.findings.length,
      })
    }
  } catch (scoreError) {
    console.warn('[siteforge_workflow] advisory premium creative scoring failed', {
      sharedJobId: input.sharedJobId,
      error: scoreError instanceof Error ? scoreError.message : String(scoreError),
    })
  }
  const artifact = await publishSiteForgeArtifact({
    websiteId: input.websiteId,
    propertyId: input.propertyId,
    orgId: input.orgId,
    sharedJobId: input.sharedJobId,
    sourcePlanVersionId: input.planVersionId,
    blueprint: blueprint as unknown as Json,
    qualityReport: {
      agent: qualityReport,
      deterministic: deterministicQualityReport,
      premiumCreative,
    } as unknown as Json,
    qualityScore: qualityReport.score,
  })
  const expectedArtifactContentHash = hashSiteForgeContent(blueprint)
  if (artifact.contentHash !== expectedArtifactContentHash) {
    throw new FatalError(
      'Published artifact content hash does not cover the exact generated blueprint'
    )
  }

  const result = {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    artifactContentHash: artifact.contentHash,
    pages: finalizedPages.length,
    sections: finalizedPages.reduce((sum, page) => sum + page.sections.length, 0),
    qualityScore: qualityReport.score,
    generationTime,
  }
  console.info('[siteforge_workflow] artifact persistence completed', {
    sharedJobId: input.sharedJobId,
    ...result,
  })
  return result
}

export async function completeSiteForgeGeneration(
  input: SiteForgeGenerationWorkflowInput,
  output: {
    artifactId: string
    artifactVersion: number
    artifactContentHash: string
    pages: number
    sections: number
    qualityScore: number
    generationTime: number
  }
): Promise<void> {
  'use step'

  console.info('[siteforge_workflow] completing generation', {
    sharedJobId: input.sharedJobId,
  })
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const { data: sharedJob, error: sharedError } = await supabase
    .from('shared_jobs')
    .update({
      lifecycle_status: 'succeeded',
      status_reason: 'completed',
      stage: 'ready_for_preview',
      progress: 100,
      current_step: 'Generation complete',
      heartbeat_at: now,
      finished_at: now,
      lease_owner: null,
      lease_expires_at: null,
      output: output as unknown as Json,
      error_message: null,
      error_details: null,
      updated_at: now,
    })
    .eq('id', input.sharedJobId)
    .select('id')
    .maybeSingle()
  if (sharedError || !sharedJob) {
    throw new Error(
      `Failed to complete shared SiteForge job: ${
        sharedError?.message || 'job row was not updated'
      }`
    )
  }

  const { data: website, error: websiteError } = await supabase
    .from('property_websites')
    .update({
      generation_status: 'ready_for_preview',
      current_step: 'Generation complete',
      generation_progress: 100,
      error_message: null,
      updated_at: now,
    })
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .eq('org_id', input.orgId)
    .select('id')
    .maybeSingle()
  if (websiteError || !website) {
    throw new Error(
      `Failed to publish website readiness: ${
        websiteError?.message || 'website row was not updated'
      }`
    )
  }
}

export async function failSiteForgeGeneration(
  input: SiteForgeGenerationWorkflowInput,
  failure: SiteForgeGenerationFailure
): Promise<void> {
  'use step'

  console.error('[siteforge_workflow] generation failed', {
    sharedJobId: input.sharedJobId,
    message: failure.message,
  })
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const { data: currentJob } = await supabase
    .from('shared_jobs')
    .select('lifecycle_status')
    .eq('id', input.sharedJobId)
    .maybeSingle()

  if (currentJob?.lifecycle_status === 'cancelled') {
    console.info('[siteforge_workflow] preserving cancelled job state', {
      sharedJobId: input.sharedJobId,
    })
    return
  }

  const [sharedResult, websiteResult] = await Promise.all([
    supabase
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'workflow_failed',
        stage: 'failed',
        current_step: 'Generation failed',
        heartbeat_at: now,
        finished_at: now,
        lease_owner: null,
        lease_expires_at: null,
        error_message: failure.safeMessage,
        error_details: {
          code: failure.code,
          retryable: failure.retryable,
          failedCheckpoint: failure.failedCheckpoint,
          safeMessage: failure.safeMessage,
          diagnostics: { message: failure.message },
        } as Json,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .select('id')
      .maybeSingle(),
    supabase
      .from('property_websites')
      .update({
        generation_status: 'failed',
        error_message: failure.safeMessage,
        updated_at: now,
      })
      .eq('id', input.websiteId)
      .select('id')
      .maybeSingle(),
  ])
  if (
    sharedResult.error ||
    !sharedResult.data ||
    websiteResult.error ||
    !websiteResult.data
  ) {
    throw new Error(
      `Failed to terminalize SiteForge generation: ${
        sharedResult.error?.message ||
        websiteResult.error?.message ||
        'one or more rows were not updated'
      }`
    )
  }
}
