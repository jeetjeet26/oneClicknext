import {
  assertSiteForgeDeploymentActive,
  failSiteForgeDeployment,
  runSiteForgeDeployment,
  updateSiteForgeDeploymentStage,
  type SiteForgeDeploymentWorkflowInput,
} from '@/utils/siteforge/workflows/deployment-steps'

export async function siteForgeDeploymentWorkflow(
  input: SiteForgeDeploymentWorkflowInput
) {
  'use workflow'

  console.info('[siteforge_deployment_workflow] run started', {
    sharedJobId: input.sharedJobId,
    websiteId: input.websiteId,
  })

  try {
    await assertSiteForgeDeploymentActive(input)
    await updateSiteForgeDeploymentStage(
      input,
      'preparing',
      5,
      'Preparing durable WordPress deployment'
    )

    await assertSiteForgeDeploymentActive(input)
    await updateSiteForgeDeploymentStage(
      input,
      'deploying',
      15,
      input.localSimulation
        ? 'Running deterministic local deployment simulation'
        : 'Deploying website to WordPress'
    )
    const output = await runSiteForgeDeployment(input)

    console.info('[siteforge_deployment_workflow] run completed', {
      sharedJobId: input.sharedJobId,
    })
    return {
      sharedJobId: input.sharedJobId,
      websiteId: input.websiteId,
      ...output,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'SiteForge deployment failed'
    await failSiteForgeDeployment(input, message)
    throw error
  }
}
