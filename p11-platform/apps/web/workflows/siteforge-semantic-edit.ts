import {
  assembleSemanticEditContext,
  assertSemanticEditActive,
  buildSemanticEditCorrectionIntent,
  completeSemanticEdit,
  failSemanticEdit,
  proposeSemanticEdit,
  updateSemanticEditStage,
  validateAndPublishSemanticEdit,
  verifyRenderedSemanticEdit,
  type SemanticEditRenderVerification,
  type SiteForgeSemanticEditWorkflowInput,
} from '@/utils/siteforge/editor/workflow-steps'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }
  return 'SiteForge semantic edit failed'
}

export async function siteForgeSemanticEditWorkflow(
  input: SiteForgeSemanticEditWorkflowInput
) {
  'use workflow'

  try {
    await assertSemanticEditActive(input)
    await updateSemanticEditStage(
      input,
      'assembling_context',
      5,
      'Loading immutable site, property evidence, assets, and render context'
    )
    const snapshot = await assembleSemanticEditContext(input)

    await assertSemanticEditActive(input)
    await updateSemanticEditStage(
      input,
      'planning_edit',
      30,
      'Routing and planning the authorized semantic edit'
    )
    const proposal = await proposeSemanticEdit(input, snapshot)

    await assertSemanticEditActive(input)
    await updateSemanticEditStage(
      input,
      'validating_capabilities',
      55,
      proposal.extensionRequest
        ? 'Recording an approval-required runtime extension'
        : 'Confirming semantic operations need no code fallback'
    )

    await assertSemanticEditActive(input)
    await updateSemanticEditStage(
      input,
      'validating',
      70,
      'Validating semantic operations and deterministic quality gates'
    )
    let output = await validateAndPublishSemanticEdit(input, snapshot, proposal)
    let finalProposal = proposal

    // Rendered self-verification: after the revision publishes, re-render the
    // affected pages on the canonical WordPress target and verify the visual
    // outcome against the accepted edit before replying "done". Mismatches get
    // at most two bounded correction passes, then the result is reported
    // honestly. Verification never blocks or unpublishes the revision.
    let verification: SemanticEditRenderVerification | undefined
    if (
      output.artifactId &&
      output.contentHash &&
      !output.awaitingClarification &&
      !output.awaitingExtensionApproval
    ) {
      await updateSemanticEditStage(
        input,
        'verifying_render',
        90,
        'Re-rendering the published revision to verify the visual outcome'
      )
      let published = {
        artifactId: output.artifactId,
        contentHash: output.contentHash,
      }
      verification = await verifyRenderedSemanticEdit(input, published)
      let correctionPasses = 0
      while (verification.status === 'failed' && correctionPasses < 2) {
        correctionPasses++
        await assertSemanticEditActive(input)
        await updateSemanticEditStage(
          input,
          'correcting_render',
          92,
          `Rendered outcome mismatch — bounded correction pass ${correctionPasses} of 2`
        )
        const correctionInput: SiteForgeSemanticEditWorkflowInput = {
          ...input,
          userIntent: buildSemanticEditCorrectionIntent(
            input.userIntent,
            verification
          ),
          pageManagerAction: undefined,
          attachmentIds: [],
          expectedArtifactId: published.artifactId,
          expectedContentHash: published.contentHash,
        }
        const correctionSnapshot =
          await assembleSemanticEditContext(correctionInput)
        const correctionProposal = await proposeSemanticEdit(
          correctionInput,
          correctionSnapshot
        )
        if (
          correctionProposal.clarification ||
          correctionProposal.extensionRequest ||
          correctionProposal.operations.length === 0
        ) {
          break
        }
        const correctionOutput = await validateAndPublishSemanticEdit(
          correctionInput,
          correctionSnapshot,
          correctionProposal
        )
        if (!correctionOutput.artifactId || !correctionOutput.contentHash) {
          break
        }
        output = correctionOutput
        finalProposal = correctionProposal
        published = {
          artifactId: correctionOutput.artifactId,
          contentHash: correctionOutput.contentHash,
        }
        verification = await verifyRenderedSemanticEdit(input, published)
      }
      verification = { ...verification, correctionPasses }
    }

    await updateSemanticEditStage(
      input,
      output.awaitingClarification
        ? 'awaiting_clarification'
        : output.awaitingExtensionApproval
          ? 'extension_approval_required'
          : 'publishing',
      95,
      output.awaitingClarification
        ? 'Preparing a clarification request'
        : output.awaitingExtensionApproval
          ? 'Creating a controlled runtime extension request'
          : 'Publishing exactly one immutable revision'
    )
    await completeSemanticEdit(input, finalProposal, output, verification)
    return output
  } catch (error) {
    await failSemanticEdit(input, errorMessage(error))
    throw error
  }
}
