import {
  failBrandForgeWorkflow,
  loadBrandForgeCompetitiveSnapshot,
  convergeBrandForgeWorkflowContract,
  persistBrandForgeWorkflowContract,
} from '@/utils/brandforge/workflow-steps'
import type { BrandForgeWorkflowInput } from '@/utils/brandforge/contracts'

export async function brandForgeWorkflow(input: BrandForgeWorkflowInput) {
  'use workflow'

  console.info('[brandforge_workflow] run started', {
    brandAssetId: input.brandAssetId,
    propertyId: input.propertyId,
    mode: input.mode,
    vertical: input.vertical,
  })

  try {
    const snapshot = await loadBrandForgeCompetitiveSnapshot(input)
    const converged = await convergeBrandForgeWorkflowContract(input, snapshot)
    const result = await persistBrandForgeWorkflowContract({
      workflow: input,
      snapshot,
      ...converged,
    })
    console.info('[brandforge_workflow] run completed', result)
    return result
  } catch (error) {
    await failBrandForgeWorkflow(input, error)
    throw error
  }
}
