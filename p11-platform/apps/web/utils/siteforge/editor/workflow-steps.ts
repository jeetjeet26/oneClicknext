import { FatalError } from 'workflow'
import { z } from 'zod'
import type { GeneratedPage, SiteBlueprint } from '@/types/siteforge'
import type { Json, TablesUpdate } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import {
  normalizeLegacyBlockContent,
  strictGeneratedPageSchema,
} from '@/utils/siteforge/block-schemas'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  buildSiteForgeEditorSnapshot,
  SiteForgeEditorContextError,
  type SiteForgeEditorSnapshot,
} from '@/utils/siteforge/editor/context'
import {
  assertSiteForgeEditorAgentOutcome,
  runSiteForgeEditorAgent,
  validateSiteForgeEditorOperations,
  type SiteForgeEditorAgentResult,
} from '@/utils/siteforge/editor/agent'
import { isSiteForgeRuntimeExtensionsEnabled } from '@/utils/siteforge/editor/feature'
import { validateAndStoreThemeOverlay } from '@/utils/siteforge/editor/overlay'
import {
  deriveOverlayRenderedEffectContract,
  overlayRuntimeCompatibilitySchema,
} from '@/utils/siteforge/editor/overlay-contract'
import { immutableSnapshotChanged } from '@/utils/siteforge/editor/immutable-snapshot'
import { assertFactualSemanticEditGrounding } from '@/utils/siteforge/editor/factual-guard'
import {
  assertApprovedAssetReferenceClosure,
  buildApprovedAssetManifest,
} from '@/utils/siteforge/editor/asset-manifest'
import { updateEditorMessage } from '@/utils/siteforge/editor/repository'
import {
  evaluateDeterministicSiteForgeQuality,
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
} from '@/utils/siteforge/quality/deterministic-gates'
import { verifyKnowledgeBaseEvidenceIds } from '@/utils/siteforge/quality/knowledge-evidence'
import { evaluateSiteForgePremiumCreative } from '@/utils/siteforge/quality/premium-creative'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import {
  rebuildWordPressThemeArtifactFromDesignSystem,
  updateWordPressThemeArtifactConfiguration,
  validateWordPressThemeArtifact,
} from '@/utils/siteforge/wordpress/theme-artifact'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import { compileBrandPublicationPackage } from '@/utils/siteforge/brand-design-compiler'
import { siteForgePlanSchema } from '@/utils/siteforge/contracts'
import {
  assertSiteForgeEditorDiffInScope,
  assertSiteForgeEditorOperationsInScope,
  deriveSiteForgeEditorScopeForOperations,
  siteForgeEditorAffectedPaths,
  siteForgeOperationsTouchThemeConfiguration,
  type SiteForgeEditorScope,
} from '@/utils/siteforge/editor/scope'
import { deriveSiteForgeEditAcceptanceContract } from '@/utils/siteforge/editor/edit-acceptance'
import {
  pageManagerActionEvidenceId,
  planSiteForgePageManagerAction,
  type SiteForgePageManagerAction,
} from '@/utils/siteforge/editor/page-manager'
import { queueCanonicalPreviewAfterPublication } from '@/utils/siteforge/workflows/canonical-preview-queue'

export interface SiteForgeSemanticEditWorkflowInput {
  sharedJobId: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  websiteId: string
  propertyId: string
  orgId: string
  userId: string
  userIntent: string
  attachmentIds: string[]
  elementContext?: {
    pageSlug: string
    sectionId: string
    blockType?: string
  }
  editScope?: SiteForgeEditorScope
  pageManagerAction?: SiteForgePageManagerAction
  expectedArtifactId: string
  expectedContentHash: string
}

function persistedPageManagerEvidenceIds(blueprint: SiteBlueprint): string[] {
  return Array.from(
    new Set(
      blueprint.pages.flatMap(page =>
        page.sections.flatMap(section =>
          (section.evidenceIds || []).filter(evidenceId =>
            /^operator-page-intent:[a-f0-9]{64}$/.test(evidenceId)
          )
        )
      )
    )
  )
}

export async function assertSemanticEditActive(
  input: SiteForgeSemanticEditWorkflowInput
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const { data, error } = await client
    .from('shared_jobs')
    .select('lifecycle_status, cancel_requested')
    .eq('id', input.sharedJobId)
    .eq('domain', 'siteforge.semantic_edit')
    .single()
  if (error || !data) {
    throw new FatalError(
      `Semantic edit job not found: ${error?.message || input.sharedJobId}`
    )
  }
  if (data.cancel_requested || data.lifecycle_status === 'cancelled') {
    throw new FatalError('SiteForge semantic edit was cancelled')
  }
}

export async function updateSemanticEditStage(
  input: SiteForgeSemanticEditWorkflowInput,
  stage: string,
  progress: number,
  currentStep: string
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  const update: TablesUpdate<'shared_jobs'> = {
    lifecycle_status: 'running',
    status_reason: stage,
    stage,
    progress,
    current_step: currentStep,
    heartbeat_at: now,
    started_at: progress <= 5 ? now : undefined,
    updated_at: now,
  }
  const { error } = await client
    .from('shared_jobs')
    .update(update)
    .eq('id', input.sharedJobId)
  if (error)
    throw new Error(
      `Failed to persist semantic edit progress: ${error.message}`
    )

  await updateEditorMessage(
    input.assistantMessageId,
    {
      status: 'running',
      progress: [{ stage, progress, message: currentStep }] as unknown as Json,
    },
    client
  )
}

export async function assembleSemanticEditContext(
  input: SiteForgeSemanticEditWorkflowInput
): Promise<SiteForgeEditorSnapshot> {
  'use step'
  try {
    return await buildSiteForgeEditorSnapshot(
      {
        websiteId: input.websiteId,
        sessionId: input.sessionId,
        userMessageId: input.userMessageId,
        attachmentIds: input.attachmentIds,
        expectedArtifactId: input.expectedArtifactId,
        expectedContentHash: input.expectedContentHash,
      },
      createServiceClient()
    )
  } catch (error) {
    if (error instanceof SiteForgeEditorContextError) {
      throw new FatalError(`[${error.code}] ${error.message}`)
    }
    throw error
  }
}

export async function proposeSemanticEdit(
  input: SiteForgeSemanticEditWorkflowInput,
  snapshot: SiteForgeEditorSnapshot
): Promise<SiteForgeEditorAgentResult> {
  'use step'
  if (input.pageManagerAction) {
    const sourceBlueprint =
      snapshot.artifact.blueprint as unknown as SiteBlueprint
    const proposal = planSiteForgePageManagerAction({
      blueprint: sourceBlueprint,
      action: input.pageManagerAction,
    })
    validateSiteForgeEditorOperations({
      blueprint: snapshot.artifact.blueprint as unknown as SiteBlueprint,
      operations: proposal.operations,
      verifiedEvidenceIds: [
        ...persistedPageManagerEvidenceIds(sourceBlueprint),
        pageManagerActionEvidenceId(input.pageManagerAction),
      ],
      scope: { kind: 'site' },
    })
    return proposal
  }
  return runSiteForgeEditorAgent({
    snapshot,
    userIntent: input.elementContext
      ? [
          input.userIntent,
          '',
          'The operator selected this exact immutable-artifact element:',
          `- pageSlug: ${input.elementContext.pageSlug}`,
          `- sectionId: ${input.elementContext.sectionId}`,
          ...(input.elementContext.blockType
            ? [`- blockType: ${input.elementContext.blockType}`]
            : []),
          'Treat this identity as targeting context; inspect it before applying operations.',
        ].join('\n')
      : input.userIntent,
    scope: input.editScope,
    elementContext: input.elementContext,
  })
}

export async function validateAndPublishSemanticEdit(
  input: SiteForgeSemanticEditWorkflowInput,
  snapshot: SiteForgeEditorSnapshot,
  proposal: SiteForgeEditorAgentResult
): Promise<{
  artifactId: string | null
  contentHash: string | null
  version: number | null
  awaitingClarification: boolean
  awaitingExtensionApproval: boolean
  extensionRequestId: string | null
}> {
  'use step'
  const client = createServiceClient()
  assertSiteForgeEditorAgentOutcome(proposal)
  if (proposal.clarification) {
    return {
      artifactId: null,
      contentHash: null,
      version: null,
      awaitingClarification: true,
      awaitingExtensionApproval: false,
      extensionRequestId: null,
    }
  }
  if (proposal.extensionRequest) {
    if (!isSiteForgeRuntimeExtensionsEnabled()) {
      throw new FatalError(
        '[runtime_extensions_disabled] SiteForge runtime extensions are disabled'
      )
    }
    if (
      snapshot.artifact.id !== input.expectedArtifactId ||
      snapshot.artifact.contentHash !== input.expectedContentHash
    ) {
      throw new FatalError(
        '[extension_source_mismatch] Runtime extension source artifact is not exact'
      )
    }
    const overlay = await validateAndStoreThemeOverlay({
      orgId: input.orgId,
      propertyId: input.propertyId,
      websiteId: input.websiteId,
      userId: input.userId,
      proposal: proposal.extensionRequest.overlay,
    })
    const runtimeCompatibility = overlayRuntimeCompatibilitySchema.parse({
      contractVersion: 1,
      overlayId: overlay.overlayId,
      contentHash: overlay.contentHash,
      sourceArtifactId: snapshot.artifact.id,
      sourceContentHash: snapshot.artifact.contentHash,
      packageSha256: overlay.packageSha256,
      signature: overlay.signature,
      storage: {
        bucket: 'siteforge-artifacts',
        path: overlay.storagePath,
      },
      validation: {
        validator: 'siteforge-static-sandbox-v1',
        reportSha256: overlay.validationReportSha256,
      },
      renderedEffectContract: deriveOverlayRenderedEffectContract(
        proposal.extensionRequest.overlay
      ),
    })
    const { data: extension, error: extensionError } = await client
      .from('siteforge_runtime_extension_requests')
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: snapshot.artifact.id,
        requested_by: input.userId,
        capability: proposal.extensionRequest.capability,
        reason: proposal.extensionRequest.reason,
        requested_behavior: proposal.extensionRequest.requestedBehavior,
        immutable_package_sha256: overlay.packageSha256,
        runtime_compatibility: JSON.stringify(runtimeCompatibility),
      })
      .select('id')
      .single()
    if (extensionError || !extension) {
      throw new Error(
        `Failed to persist SiteForge runtime extension request: ${
          extensionError?.message || 'missing request'
        }`
      )
    }
    return {
      artifactId: null,
      contentHash: null,
      version: null,
      awaitingClarification: false,
      awaitingExtensionApproval: true,
      extensionRequestId: extension.id,
    }
  }
  const editScope = deriveSiteForgeEditorScopeForOperations({
    blueprint: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    operations: proposal.operations,
    elementContext: input.elementContext,
  })
  assertSiteForgeEditorOperationsInScope({
    blueprint: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    operations: proposal.operations,
    scope: editScope,
  })
  const updatedBlueprint = proposal.operations.length
    ? applyBlueprintPatch(
        snapshot.artifact.blueprint as unknown as SiteBlueprint,
        proposal.operations
      )
    : structuredClone(snapshot.artifact.blueprint as unknown as SiteBlueprint)
  assertSiteForgeEditorDiffInScope({
    before: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    after: updatedBlueprint,
    scope: editScope,
  })
  const blueprintRecord = updatedBlueprint as unknown as Record<string, unknown>
  const originalBlueprint = snapshot.artifact.blueprint as unknown as Record<
    string,
    unknown
  >
  if (
    immutableSnapshotChanged(
      blueprintRecord,
      originalBlueprint,
      'brandSnapshot'
    ) ||
    immutableSnapshotChanged(
      blueprintRecord,
      originalBlueprint,
      'onboardingSnapshot'
    )
  ) {
    throw new FatalError(
      'Brand and onboarding snapshots are locked; create and approve a BrandForge revision before changing brand tokens or assets'
    )
  }
  const touchesThemeConfiguration =
    siteForgeOperationsTouchThemeConfiguration(proposal.operations)
  if (
    touchesThemeConfiguration &&
    blueprintRecord.wordpressThemeArtifact &&
    blueprintRecord.designSystem &&
    typeof blueprintRecord.designSystem === 'object' &&
    !Array.isArray(blueprintRecord.designSystem)
  ) {
    blueprintRecord.wordpressThemeArtifact =
      rebuildWordPressThemeArtifactFromDesignSystem(
        blueprintRecord.wordpressThemeArtifact,
        blueprintRecord.designSystem as unknown as DesignSystem,
        updatedBlueprint.siteConfiguration
      )
  }
  if (
    touchesThemeConfiguration &&
    updatedBlueprint.siteConfiguration &&
    blueprintRecord.wordpressThemeArtifact
  ) {
    blueprintRecord.wordpressThemeArtifact =
      updateWordPressThemeArtifactConfiguration(
        blueprintRecord.wordpressThemeArtifact,
        updatedBlueprint.siteConfiguration
      )
  }
  const pages = z
    .array(strictGeneratedPageSchema)
    .min(1)
    .parse(normalizeLegacyBlockContent(updatedBlueprint.pages))
  blueprintRecord.pages = pages
  const photoManifest = blueprintRecord.photoManifest
  if (
    !photoManifest ||
    typeof photoManifest !== 'object' ||
    Array.isArray(photoManifest) ||
    !Array.isArray((photoManifest as Record<string, unknown>).photos)
  ) {
    throw new FatalError('Edited artifact is missing a valid photo manifest')
  }

  const confirmedPlan = blueprintRecord.confirmedPlan
    ? siteForgePlanSchema.parse(blueprintRecord.confirmedPlan)
    : undefined
  if (
    confirmedPlan?.brandSnapshot?.contract &&
    blueprintRecord.wordpressThemeArtifact &&
    typeof blueprintRecord.wordpressThemeArtifact === 'object' &&
    !Array.isArray(blueprintRecord.wordpressThemeArtifact)
  ) {
    const themeRecord =
      blueprintRecord.wordpressThemeArtifact as Record<string, unknown>
    themeRecord.brandPublication = compileBrandPublicationPackage(
      confirmedPlan.brandSnapshot.contract
    )
    const themeCore = { ...themeRecord }
    delete themeCore.contentHash
    themeRecord.contentHash = hashSiteForgeContent(themeCore)
  }
  const themeArtifact = validateWordPressThemeArtifact(
    blueprintRecord.wordpressThemeArtifact
  )
  const verifiedKnowledgeBaseEvidenceIds =
    await verifyKnowledgeBaseEvidenceIds(client, input.propertyId, pages)
  const pageManagerEvidenceIds = input.pageManagerAction
    ? [
        ...persistedPageManagerEvidenceIds(
          snapshot.artifact.blueprint as unknown as SiteBlueprint
        ),
        pageManagerActionEvidenceId(input.pageManagerAction),
      ]
    : []
  const verifiedEvidenceIds = [
    ...verifiedKnowledgeBaseEvidenceIds,
    ...pageManagerEvidenceIds,
  ]
  assertFactualSemanticEditGrounding({
    originalBlueprint: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    updatedBlueprint,
    confirmedPlan,
    verifiedEvidenceIds,
  })
  const legacyPhotoManifest =
    originalBlueprint.photoManifest &&
    typeof originalBlueprint.photoManifest === 'object' &&
    !Array.isArray(originalBlueprint.photoManifest) &&
    Array.isArray(
      (originalBlueprint.photoManifest as Record<string, unknown>).photos
    )
      ? (originalBlueprint.photoManifest as unknown as PhotoManifest)
      : undefined
  const deterministic = evaluateDeterministicSiteForgeQuality({
    pages: pages as unknown as GeneratedPage[],
    confirmedPlan,
    confirmedPlanTopologyPolicy: 'report-divergence',
    photoManifest: photoManifest as PhotoManifest,
    legacyAssetBaseline: legacyPhotoManifest,
    themeArtifact,
    legal: siteForgeLegalConfigSchema.parse(blueprintRecord.legal),
    analytics: siteForgeAnalyticsConfigSchema.parse(blueprintRecord.analytics),
    additionalTrustedEvidenceIds: verifiedEvidenceIds,
  })
  if (!deterministic.passed) {
    const failures = deterministic.checks
      .filter((check) => check.severity === 'blocker' && !check.passed)
      .map((check) => {
        const locations = check.locations.length
          ? ` (${check.locations.join(', ')})`
          : ''
        return `${check.id}${locations}`
      })
      .join('; ')
    throw new FatalError(
      `Edited artifact failed deterministic quality gates: ${failures}`
    )
  }

  blueprintRecord.deterministicQualityReport = deterministic
  blueprintRecord.updatedAt = new Date().toISOString()
  const contentHash = hashSiteForgeContent(blueprintRecord)
  const operationSetHash = hashSiteForgeContent(proposal.operations)
  const acceptanceContract = deriveSiteForgeEditAcceptanceContract({
    before: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    after: blueprintRecord as unknown as SiteBlueprint,
    operations: proposal.operations,
    parentArtifact: {
      artifactId: snapshot.artifact.id,
      contentHash: snapshot.artifact.contentHash,
    },
    editedArtifact: {
      artifactId: null,
      contentHash,
    },
  })
  // Advisory premium-creative score for the edited artifact (informational
  // only; scoring failures never fail the edit).
  let premiumCreative = null
  try {
    premiumCreative = evaluateSiteForgePremiumCreative({
      pages: pages as unknown as GeneratedPage[],
      brandContext: blueprintRecord.brandContext,
    })
  } catch (scoreError) {
    console.warn('[siteforge_editor] advisory premium creative scoring failed', {
      sharedJobId: input.sharedJobId,
      error: scoreError instanceof Error ? scoreError.message : String(scoreError),
    })
  }
  const qualityReport = {
    deterministic,
    premiumCreative,
    semanticEditor: {
      model: proposal.model,
      toolSummary: proposal.toolSummary,
      scope: editScope,
      affectedPaths: siteForgeEditorAffectedPaths(proposal.operations),
      acceptanceContract,
    },
  }
  assertApprovedAssetReferenceClosure({
    approvedAssets: snapshot.approvedAssets,
    updatedBlueprint: blueprintRecord as unknown as Json,
    originalBlueprint: snapshot.artifact.blueprint,
  })
  const { assetManifest, assetManifestHash } = buildApprovedAssetManifest(
    snapshot.approvedAssets,
    blueprintRecord as unknown as Json
  )
  const { data: websiteTarget, error: websiteTargetError } = await client
    .from('property_websites')
    .select('canonical_preview_target_id')
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (websiteTargetError) {
    throw new Error(
      `Failed to resolve semantic edit runtime target: ${websiteTargetError.message}`
    )
  }
  const runtimeRollout = websiteTarget?.canonical_preview_target_id
    ? await client
        .from('siteforge_runtime_target_rollouts')
        .select(
          'requested_contract_version, runtime_package_sha256, status'
        )
        .eq('target_id', websiteTarget.canonical_preview_target_id)
        .eq('website_id', input.websiteId)
        .eq('status', 'enabled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null }
  if (runtimeRollout.error) {
    throw new Error(
      `Failed to resolve semantic edit runtime rollout: ${runtimeRollout.error.message}`
    )
  }
  const latestBaseTheme = await client
    .from('siteforge_runtime_packages')
    .select('id, package_sha256')
    .eq('package_type', 'base_theme')
    .eq('publication_status', 'published')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestBaseTheme.error) {
    throw new Error(
      `Failed to resolve current base theme package: ${latestBaseTheme.error.message}`
    )
  }

  const { data: publicationClaim, error: publicationClaimError } = await client
    .from('shared_jobs')
    .update({
      status_reason: 'publication_claimed',
      stage: 'publishing',
      current_step: 'Publishing immutable SiteForge revision',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.sharedJobId)
    .eq('domain', 'siteforge.semantic_edit')
    .eq('cancel_requested', false)
    // NULL-safe "not yet claimed" guard. PostgREST rejects an or=(...) filter
    // combined with an UPDATE ... RETURNING representation (42703), so this
    // must stay a simple IS DISTINCT FROM filter.
    .filter('status_reason', 'isdistinct', 'publication_claimed')
    .in('lifecycle_status', ['running', 'retrying'])
    .select('id')
    .maybeSingle()
  if (publicationClaimError) {
    throw new Error(
      `Failed to claim semantic edit publication: ${publicationClaimError.message}`
    )
  }
  if (!publicationClaim) {
    throw new FatalError(
      '[publication_not_claimed] Semantic edit was cancelled or changed before publication'
    )
  }

  const { data: revision, error } = await client.rpc(
    'publish_siteforge_artifact_revision',
    {
      p_website_id: input.websiteId,
      p_expected_artifact_id: input.expectedArtifactId,
      p_blueprint: blueprintRecord as unknown as Json,
      p_content_hash: contentHash,
      p_change_type: 'edit',
      p_changes_summary: proposal.response.slice(0, 2_000),
      p_edit_intent: input.userIntent,
      p_patches_applied: proposal.operations as unknown as Json,
      p_quality_report: qualityReport as unknown as Json,
      p_quality_score: 100,
      p_created_by: input.userId,
      ...((latestBaseTheme.data?.id &&
      latestBaseTheme.data.package_sha256)
        ? {
            p_base_theme_package_id: latestBaseTheme.data.id,
            p_base_theme_package_sha256:
              latestBaseTheme.data.package_sha256,
          }
        : snapshot.artifact.baseThemePackageId &&
            snapshot.artifact.baseThemePackageSha256
          ? {
              p_base_theme_package_id: snapshot.artifact.baseThemePackageId,
              p_base_theme_package_sha256:
                snapshot.artifact.baseThemePackageSha256,
            }
          : {}),
      p_asset_manifest: assetManifest,
      p_asset_manifest_hash: assetManifestHash,
      p_operation_set: proposal.operations as unknown as Json,
      p_operation_set_hash: operationSetHash,
      ...(runtimeRollout.data?.requested_contract_version === 3 &&
      runtimeRollout.data.runtime_package_sha256
        ? {
            p_runtime_contract_version: 3,
            p_runtime_package_sha256:
              runtimeRollout.data.runtime_package_sha256,
          }
        : {}),
    }
  )
  if (error || !revision) {
    if (error?.message.includes('version conflict')) {
      throw new FatalError('SiteForge artifact version conflict')
    }
    throw new Error(
      `Failed to publish semantic edit: ${error?.message || 'missing revision'}`
    )
  }

  return {
    artifactId: revision.id,
    contentHash: revision.content_hash,
    version: revision.version,
    awaitingClarification: false,
    awaitingExtensionApproval: false,
    extensionRequestId: null,
  }
}

export type SemanticEditRenderVerification = {
  status: 'verified' | 'failed' | 'skipped'
  reason: string
  previewUrl: string | null
  correctionPasses: number
  failures: Array<{
    code: string
    pageSlug: string
    selector: string
    viewport: string
    expected: string
    actual: string
    repairHint: string
  }>
}

// Failure codes the edited render alone can prove or disprove. Parent-phase
// codes are excluded because the canonical preview target hosts only the
// edited artifact; full parent-versus-edited certification still runs in the
// launch pipeline.
const EDITED_PHASE_FAILURE_CODES = new Set([
  'required_viewport_missing',
  'selector_unmatched',
  'expected_text_missing',
  'expected_text_still_present',
  'attribute_mismatch',
  'removed_selector_still_present',
  'computed_style_mismatch',
  'interaction_mismatch',
])

function extractEditedPhaseFailures(
  report: unknown
): SemanticEditRenderVerification['failures'] | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return null
  }
  const browser = (report as Record<string, unknown>).browser
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) {
    return null
  }
  const checks = (browser as Record<string, unknown>).checks
  if (!Array.isArray(checks)) return null
  const acceptance = checks.find(
    check =>
      check &&
      typeof check === 'object' &&
      !Array.isArray(check) &&
      (check as Record<string, unknown>).code === 'edit.rendered_effect'
  ) as Record<string, unknown> | undefined
  if (!acceptance) return null
  const evidence = acceptance.evidence
  const rawFailures =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>).failures
      : null
  if (!Array.isArray(rawFailures)) return []
  return rawFailures.flatMap(failure => {
    if (!failure || typeof failure !== 'object' || Array.isArray(failure)) {
      return []
    }
    const record = failure as Record<string, unknown>
    if (
      typeof record.code !== 'string' ||
      !EDITED_PHASE_FAILURE_CODES.has(record.code)
    ) {
      return []
    }
    return [
      {
        code: record.code,
        pageSlug: typeof record.pageSlug === 'string' ? record.pageSlug : '',
        selector: typeof record.selector === 'string' ? record.selector : '',
        viewport: typeof record.viewport === 'string' ? record.viewport : '',
        expected: typeof record.expected === 'string' ? record.expected : '',
        actual: typeof record.actual === 'string' ? record.actual : '',
        repairHint:
          typeof record.repairHint === 'string' ? record.repairHint : '',
      },
    ]
  })
}

export function buildSemanticEditCorrectionIntent(
  originalIntent: string,
  verification: SemanticEditRenderVerification
): string {
  const failureLines = verification.failures.slice(0, 12).map(failure =>
    [
      `- [${failure.code}] page "${failure.pageSlug}" selector "${failure.selector}" at ${failure.viewport}:`,
      `  expected ${failure.expected || '(none)'}, rendered ${failure.actual || '(nothing)'}.`,
      `  Repair hint: ${failure.repairHint}`,
    ].join('\n')
  )
  return [
    'Rendered verification of your previous edit found visual mismatches on the published WordPress render.',
    'The original operator request was:',
    `"${originalIntent}"`,
    '',
    'The rendered page did not match the accepted edit in these exact places:',
    ...failureLines,
    '',
    'Correct ONLY these mismatches so the rendered outcome matches the original request. Do not touch anything else.',
  ].join('\n')
}

export async function verifyRenderedSemanticEdit(
  input: SiteForgeSemanticEditWorkflowInput,
  published: { artifactId: string; contentHash: string }
): Promise<SemanticEditRenderVerification> {
  'use step'
  const skipped = (reason: string): SemanticEditRenderVerification => ({
    status: 'skipped',
    reason,
    previewUrl: null,
    correctionPasses: 0,
    failures: [],
  })
  if (process.env.SITEFORGE_EDIT_RENDER_VERIFICATION === 'false') {
    return skipped('Rendered verification is disabled by environment kill switch')
  }
  const client = createServiceClient()
  const queued = await queueCanonicalPreviewAfterPublication({
    service: client,
    orgId: input.orgId,
    propertyId: input.propertyId,
    websiteId: input.websiteId,
    artifactId: published.artifactId,
    contentHash: published.contentHash,
    runBrowserQa: true,
  })
  if (!queued.jobId || ['pending', 'failed'].includes(queued.status)) {
    return skipped(
      queued.reason || 'Canonical preview target is not ready for verification'
    )
  }
  const deadline = Date.now() + 10 * 60_000
  let lifecycle = queued.status as string
  while (
    !['succeeded', 'failed', 'cancelled'].includes(lifecycle) &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 10_000))
    const { data: job } = await client
      .from('shared_jobs')
      .select('lifecycle_status')
      .eq('id', queued.jobId)
      .maybeSingle()
    lifecycle = job?.lifecycle_status || lifecycle
  }
  if (lifecycle !== 'succeeded') {
    return skipped(
      lifecycle === 'failed' || lifecycle === 'cancelled'
        ? `Canonical preview render ${lifecycle}; the revision is published but visually unverified`
        : 'Canonical preview render timed out; the revision is published but visually unverified'
    )
  }
  const { data: website } = await client
    .from('property_websites')
    .select('canonical_preview_url')
    .eq('id', input.websiteId)
    .maybeSingle()
  const previewUrl = website?.canonical_preview_url || null
  const { data: evidence } = await client
    .from('siteforge_certification_evidence')
    .select('report, created_at')
    .eq('website_id', input.websiteId)
    .eq('artifact_id', published.artifactId)
    .eq('environment', 'preview')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const failures = extractEditedPhaseFailures(evidence?.report)
  if (failures === null) {
    return {
      ...skipped(
        'The rendered preview completed but produced no edit-acceptance evidence'
      ),
      previewUrl,
    }
  }
  if (failures.length === 0) {
    return {
      status: 'verified',
      reason:
        'The published revision was re-rendered and the edited pages match the accepted edit at every named viewport',
      previewUrl,
      correctionPasses: 0,
      failures: [],
    }
  }
  return {
    status: 'failed',
    reason: `The rendered pages do not match the accepted edit in ${failures.length} place(s)`,
    previewUrl,
    correctionPasses: 0,
    failures,
  }
}

function verificationSummary(
  verification: SemanticEditRenderVerification
): string {
  if (verification.status === 'verified') {
    return verification.correctionPasses > 0
      ? `\n\nRendered verification: passed after ${verification.correctionPasses} bounded correction pass(es); the published render now matches the request.`
      : '\n\nRendered verification: the published WordPress render matches the accepted edit.'
  }
  if (verification.status === 'failed') {
    const detail = verification.failures
      .slice(0, 4)
      .map(
        failure =>
          `${failure.pageSlug} (${failure.viewport}): expected ${failure.expected || 'the accepted change'}, rendered ${failure.actual || 'something else'}`
      )
      .join('; ')
    return `\n\nRendered verification: the render still does not fully match after ${verification.correctionPasses} bounded correction pass(es). Unresolved: ${detail}. The revision is published; undo is available if this is not acceptable.`
  }
  return `\n\nRendered verification: skipped (${verification.reason}).`
}

export async function completeSemanticEdit(
  input: SiteForgeSemanticEditWorkflowInput,
  proposal: SiteForgeEditorAgentResult,
  output: {
    artifactId: string | null
    contentHash: string | null
    version: number | null
    awaitingClarification: boolean
    awaitingExtensionApproval: boolean
    extensionRequestId: string | null
  },
  verification?: SemanticEditRenderVerification
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  await updateEditorMessage(
    input.assistantMessageId,
    {
      status: 'complete',
      content:
        (proposal.clarification || proposal.response) +
        (verification && !proposal.clarification
          ? verificationSummary(verification)
          : ''),
      resultingArtifactId: output.artifactId,
      toolSummary: proposal.toolSummary as unknown as Json,
      progress: [
        {
          stage: output.awaitingClarification
            ? 'awaiting_clarification'
            : output.awaitingExtensionApproval
              ? 'extension_approval_required'
              : 'published',
          progress: 100,
        },
      ] as unknown as Json,
      expectedStatuses: ['queued', 'running'],
    },
    client
  )

  const { error: jobError } = await client
    .from('shared_jobs')
    .update({
      lifecycle_status: 'succeeded',
      status_reason: output.awaitingClarification
        ? 'awaiting_clarification'
        : output.awaitingExtensionApproval
          ? 'extension_approval_required'
          : 'revision_published',
      stage: output.awaitingClarification
        ? 'awaiting_clarification'
        : output.awaitingExtensionApproval
          ? 'extension_approval_required'
          : 'published',
      progress: 100,
      current_step: output.awaitingClarification
        ? 'Waiting for user clarification'
        : output.awaitingExtensionApproval
          ? 'Runtime extension requires manager approval'
          : 'Immutable edit revision published',
      output: { ...output, verification: verification || null } as unknown as Json,
      finished_at: now,
      updated_at: now,
    })
    .eq('id', input.sharedJobId)
    .in('lifecycle_status', ['running', 'retrying'])
  if (jobError)
    throw new Error(`Failed to complete semantic edit job: ${jobError.message}`)

  if (output.artifactId) {
    await client
      .from('siteforge_edit_sessions')
      .update({
        active_artifact_id: output.artifactId,
        last_activity_at: now,
      })
      .eq('id', input.sessionId)
  }
}

export async function failSemanticEdit(
  input: SiteForgeSemanticEditWorkflowInput,
  errorMessage: string
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  const publicDetail = errorMessage.startsWith(
    'Edited artifact failed deterministic quality gates:'
  )
    ? ` ${errorMessage}`
    : ''
  await Promise.all([
    updateEditorMessage(
      input.assistantMessageId,
      {
        status: 'failed',
        failureCode: errorMessage.includes('conflict')
          ? 'artifact_conflict'
          : 'semantic_edit_failed',
        failureMessage: errorMessage,
        content: `The edit could not be completed or confirmed. Reload the editor before retrying so the current immutable revision can be verified.${publicDetail}`,
        expectedStatuses: ['queued', 'running'],
      },
      client
    ),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'semantic_edit_failed',
        stage: 'failed',
        current_step: 'Semantic edit failed',
        error_message: errorMessage,
        error_details: { message: errorMessage } as Json,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .in('lifecycle_status', ['queued', 'running', 'retrying']),
  ])
}
