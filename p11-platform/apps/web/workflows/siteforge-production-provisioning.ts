import {
  assertProductionProvisioningActive,
  failProductionProvisioning,
  runProductionProvisioning,
  type SiteForgeProductionProvisioningInput,
} from '@/utils/siteforge/workflows/production-provisioning-steps'

export async function siteForgeProductionProvisioningWorkflow(
  input: SiteForgeProductionProvisioningInput
) {
  'use workflow'
  try {
    await assertProductionProvisioningActive(input)
    return await runProductionProvisioning(input)
  } catch (error) {
    await failProductionProvisioning(
      input,
      extractWorkflowErrorMessage(error) ||
        'Production WordPress provisioning failed'
    )
    throw error
  }
}

function extractWorkflowErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error || null
  if (!error || typeof error !== 'object') return null
  const record = error as { message?: unknown; cause?: unknown }
  const causeMessage = extractWorkflowErrorMessage(record.cause)
  if (causeMessage) return causeMessage
  return typeof record.message === 'string' && record.message
    ? record.message
    : null
}
