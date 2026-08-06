import {
  assertStagingDeploymentActive,
  failSiteForgeStagingDeployment,
  runSiteForgeStagingDeployment,
  type SiteForgeStagingWorkflowInput,
} from '@/utils/siteforge/workflows/staging-steps'

export async function siteForgeStagingDeploymentWorkflow(
  input: SiteForgeStagingWorkflowInput
) {
  'use workflow'
  try {
    await assertStagingDeploymentActive(input)
    return await runSiteForgeStagingDeployment(input)
  } catch (error) {
    await failSiteForgeStagingDeployment(
      input,
      extractWorkflowErrorMessage(error) || 'Cloudways staging deployment failed'
    )
    throw error
  }
}

// The workflow runtime can surface step failures as serialized error objects
// or wrapper errors whose cause holds the real failure; walk the chain so the
// operator job card shows the actual message instead of a generic label.
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
