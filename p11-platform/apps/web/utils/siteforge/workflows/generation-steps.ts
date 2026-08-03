import { FatalError } from 'workflow'
import { createServiceClient } from '@/utils/supabase/admin'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
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
import { finalizeSiteForgePages } from '@/utils/siteforge/generation/finalize-pages'
import { loadApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plan-repository'
import {
  buildWordPressThemeArtifact,
  type WordPressFontAsset,
} from '@/utils/siteforge/wordpress/theme-artifact'
import {
  createDefaultSiteForgeAnalyticsConfig,
  createSiteForgeLegalConfigFromSnapshot,
  evaluateDeterministicSiteForgeQuality,
} from '@/utils/siteforge/quality/deterministic-gates'
import type { GeneratedPage, GenerationPreferences } from '@/types/siteforge'
import type { Json, TablesUpdate } from '@/types/supabase'
import {
  siteForgePlanSchema,
  type SiteForgePlan,
} from '@/utils/siteforge/contracts'
import {
  brandForgeContractV1Schema,
} from '@/utils/brandforge/contracts'
import { hashBrandForgeContract } from '@/utils/brandforge/normalize'
import { brandContextFromContract } from '@/utils/siteforge/brand-contract-adapter'

export type SiteForgeGenerationWorkflowInput = {
  sharedJobId: string
  legacyJobId: string
  websiteId: string
  propertyId: string
  orgId: string
  planVersionId: string
  preferences: GenerationPreferences
  prompt: string
  startedAt: string
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

  const { error: legacyError } = await supabase
    .from('siteforge_jobs')
    .update({
      status: 'processing',
      started_at: progress === 5 ? now : undefined,
    })
    .eq('id', input.legacyJobId)
  if (legacyError) {
    throw new Error(`Failed to persist compatibility job stage: ${legacyError.message}`)
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
  return brandContextFromContract(contract)
}

export async function loadConfirmedSiteForgePlan(
  input: SiteForgeGenerationWorkflowInput
): Promise<SiteForgePlan> {
  'use step'

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('siteforge_plan_versions')
    .select(`
      plan,
      plan_id,
      revision,
      onboarding_snapshot_id,
      onboarding_snapshot_hash,
      brand_asset_id,
      brand_contract_version,
      brand_contract_hash
    `)
    .eq('id', input.planVersionId)
    .single()
  if (error || !data) {
    throw new FatalError(
      `Confirmed SiteForge plan revision is unavailable: ${error?.message || 'not found'}`
    )
  }
  const plan = siteForgePlanSchema.parse(data.plan)
  if (plan.propertyId !== input.propertyId) {
    throw new FatalError('Confirmed SiteForge plan belongs to another property')
  }
  if (
    !plan.onboardingSnapshot
    || !plan.brandSnapshot
    || plan.onboardingSnapshot.id !== data.onboarding_snapshot_id
    || plan.onboardingSnapshot.contentHash !== data.onboarding_snapshot_hash
    || plan.brandSnapshot.assetId !== data.brand_asset_id
    || plan.brandSnapshot.contractVersion !== data.brand_contract_version
    || plan.brandSnapshot.contractHash !== data.brand_contract_hash
  ) {
    throw new FatalError('Confirmed SiteForge plan is missing or mismatches pinned readiness truth')
  }
  return plan
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
  const architecture = architectureFromConfirmedPlan(confirmedPlan)
  const designSystem = await new DesignAgent(input.propertyId).createSystem(brandContext)
  return { architecture, designSystem }
}

export function architectureFromConfirmedPlan(
  confirmedPlan: {
    pages: ReadonlyArray<
      Omit<SiteForgePlan['pages'][number], 'sections'> & {
        sections: ReadonlyArray<SiteForgePlan['pages'][number]['sections'][number]>
      }
    >
    conversionStrategy: Pick<
      SiteForgePlan['conversionStrategy'],
      'primaryAction'
    >
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
      primaryCTA: confirmedPlan.conversionStrategy.primaryAction,
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
  return new PhotoAgent(input.propertyId).planStrategy(brandContext, architecture)
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
  return new ContentAgent(input.propertyId).generateAll(architecture, brandContext)
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
  return new PhotoAgent(input.propertyId).execute(strategy, pages, brandContext)
}

export async function validateSiteForgeOutput(
  input: SiteForgeGenerationWorkflowInput,
  _confirmedPlan: SiteForgePlan,
  pages: GeneratedPage[],
  designSystem: DesignSystem,
  photoManifest: PhotoManifest,
  brandContext: BrandContext
): Promise<QualityReport> {
  'use step'

  console.info('[siteforge_workflow] quality validation started', {
    sharedJobId: input.sharedJobId,
  })
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
  const generationTime = Math.max(
    0,
    Date.now() - new Date(input.startedAt).getTime()
  )
  const now = new Date().toISOString()
  const durablePhotoManifest = await persistSiteForgeAssets(
    input.websiteId,
    photoManifest
  )
  const floorPlanSnapshot = await loadApprovedFloorPlanSnapshot(input.propertyId)
  const finalizedPages = finalizeSiteForgePages(
    pages,
    durablePhotoManifest,
    floorPlanSnapshot
  )
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
    if (
      !asset
      || asset.asset_role !== 'font'
      || asset.approval_status !== 'approved'
      || !['owned', 'licensed', 'generated'].includes(asset.rights_status)
      || (asset.expires_at && new Date(asset.expires_at) <= new Date())
      || asset.format?.toLowerCase() !== 'woff2'
    ) {
      throw new FatalError(`Brand font asset ${role.assetId} is not an approved licensed WOFF2 file`)
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
  const wordpressThemeArtifact = buildWordPressThemeArtifact(
    designSystem,
    wordpressCapabilities,
    undefined,
    wordpressFontAssets,
  )
  if (!confirmedPlan.onboardingSnapshot) {
    throw new FatalError('Confirmed plan is missing its onboarding snapshot')
  }
  const supabase = createServiceClient()
  const { data: onboardingSnapshot, error: onboardingError } = await supabase
    .from('property_onboarding_snapshots')
    .select('snapshot_payload, content_hash')
    .eq('id', confirmedPlan.onboardingSnapshot.id)
    .eq('property_id', input.propertyId)
    .single()
  if (
    onboardingError
    || !onboardingSnapshot
    || onboardingSnapshot.content_hash !== confirmedPlan.onboardingSnapshot.contentHash
  ) {
    throw new FatalError('Pinned onboarding snapshot is unavailable or changed')
  }
  const propertySnapshot = onboardingSnapshot.snapshot_payload
  const legal = createSiteForgeLegalConfigFromSnapshot(propertySnapshot)
  const analytics = createDefaultSiteForgeAnalyticsConfig()
  const deterministicQualityReport = evaluateDeterministicSiteForgeQuality({
    pages: finalizedPages,
    confirmedPlan,
    photoManifest: durablePhotoManifest,
    themeArtifact: wordpressThemeArtifact,
    legal,
    analytics,
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
    throw new FatalError(
      `Deterministic quality gates failed: ${blockers.join(', ')}`
    )
  }
  const blueprint = {
    version: 2,
    propertyId: input.propertyId,
    propertySnapshot,
    updatedAt: now,
    confirmedPlan,
    brandSnapshot: confirmedPlan.brandSnapshot,
    onboardingSnapshot: confirmedPlan.onboardingSnapshot,
    brandContext,
    architecture,
    designSystem,
    siteConfiguration: wordpressThemeArtifact.siteConfiguration,
    wordpressThemeArtifact,
    legal,
    analytics,
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
    } as unknown as Json,
    qualityScore: qualityReport.score,
  })

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

  const { data: legacyJob, error: legacyError } = await supabase
    .from('siteforge_jobs')
    .update({
      status: 'complete',
      completed_at: now,
      output_data: output as unknown as Json,
    })
    .eq('id', input.legacyJobId)
    .select('id')
    .maybeSingle()
  if (legacyError || !legacyJob) {
    throw new Error(
      `Failed to complete compatibility job: ${
        legacyError?.message || 'job row was not updated'
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
  message: string
): Promise<void> {
  'use step'

  console.error('[siteforge_workflow] generation failed', {
    sharedJobId: input.sharedJobId,
    message,
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

  const [sharedResult, legacyResult, websiteResult] = await Promise.all([
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
        error_message: message,
        error_details: { message } as Json,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .select('id')
      .maybeSingle(),
    supabase
      .from('siteforge_jobs')
      .update({
        status: 'failed',
        completed_at: now,
        error_details: { message } as Json,
      })
      .eq('id', input.legacyJobId)
      .select('id')
      .maybeSingle(),
    supabase
      .from('property_websites')
      .update({
        generation_status: 'failed',
        error_message: message,
        updated_at: now,
      })
      .eq('id', input.websiteId)
      .select('id')
      .maybeSingle(),
  ])
  if (
    sharedResult.error ||
    !sharedResult.data ||
    legacyResult.error ||
    !legacyResult.data ||
    websiteResult.error ||
    !websiteResult.data
  ) {
    throw new Error(
      `Failed to terminalize SiteForge generation: ${
        sharedResult.error?.message ||
        legacyResult.error?.message ||
        websiteResult.error?.message ||
        'one or more rows were not updated'
      }`
    )
  }
}
