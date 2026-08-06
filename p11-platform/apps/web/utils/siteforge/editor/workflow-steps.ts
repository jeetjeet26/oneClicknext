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
  type SiteForgeEditorAgentResult,
} from '@/utils/siteforge/editor/agent'
import { isSiteForgeRuntimeExtensionsEnabled } from '@/utils/siteforge/editor/feature'
import { validateAndStoreThemeOverlay } from '@/utils/siteforge/editor/overlay'
import { overlayRuntimeCompatibilitySchema } from '@/utils/siteforge/editor/overlay-contract'
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
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import {
  rebuildWordPressThemeArtifactFromDesignSystem,
  updateWordPressThemeArtifactConfiguration,
  validateWordPressThemeArtifact,
} from '@/utils/siteforge/wordpress/theme-artifact'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import { siteForgePlanSchema } from '@/utils/siteforge/contracts'

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
  elementContext?: {
    pageSlug: string
    sectionId: string
    blockType?: string
  }
  expectedArtifactId: string
  expectedContentHash: string
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
  const updatedBlueprint = proposal.operations.length
    ? applyBlueprintPatch(
        snapshot.artifact.blueprint as unknown as SiteBlueprint,
        proposal.operations
      )
    : structuredClone(snapshot.artifact.blueprint as unknown as SiteBlueprint)
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
  if (
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

  const themeArtifact = validateWordPressThemeArtifact(
    blueprintRecord.wordpressThemeArtifact
  )
  const confirmedPlan = blueprintRecord.confirmedPlan
    ? siteForgePlanSchema.parse(blueprintRecord.confirmedPlan)
    : undefined
  const verifiedKnowledgeBaseEvidenceIds =
    await verifyKnowledgeBaseEvidenceIds(client, input.propertyId, pages)
  assertFactualSemanticEditGrounding({
    originalBlueprint: snapshot.artifact.blueprint as unknown as SiteBlueprint,
    updatedBlueprint,
    confirmedPlan,
    verifiedEvidenceIds: verifiedKnowledgeBaseEvidenceIds,
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
    additionalTrustedEvidenceIds: verifiedKnowledgeBaseEvidenceIds,
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
  const qualityReport = {
    deterministic,
    semanticEditor: {
      model: proposal.model,
      toolSummary: proposal.toolSummary,
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
  const operationSetHash = hashSiteForgeContent(proposal.operations)

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
      ...(snapshot.artifact.baseThemePackageId &&
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
  }
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  await updateEditorMessage(
    input.assistantMessageId,
    {
      status: 'complete',
      content: proposal.clarification || proposal.response,
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
      output: output as unknown as Json,
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
