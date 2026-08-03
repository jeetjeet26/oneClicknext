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
    const message =
      error instanceof Error
        ? error.message
        : 'Cloudways staging deployment failed'
    await failSiteForgeStagingDeployment(input, message)
    throw error
  }
}
