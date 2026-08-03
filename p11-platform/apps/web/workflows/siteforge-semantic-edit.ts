import {
  assembleSemanticEditContext,
  assertSemanticEditActive,
  completeSemanticEdit,
  failSemanticEdit,
  proposeSemanticEdit,
  updateSemanticEditStage,
  validateAndPublishSemanticEdit,
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
      'Planning a holistic semantic edit with Fable 5'
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
    const output = await validateAndPublishSemanticEdit(
      input,
      snapshot,
      proposal
    )

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
    await completeSemanticEdit(input, proposal, output)
    return output
  } catch (error) {
    await failSemanticEdit(input, errorMessage(error))
    throw error
  }
}
