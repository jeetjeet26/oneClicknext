import {
  certifySiteForgeProduction,
  failSiteForgeProductionCertification,
  markSiteForgeProductionProjectionReconciliationRequired,
  ProductionProjectionReconciliationError,
  type SiteForgeProductionCertificationInput,
} from '@/utils/siteforge/workflows/production-steps'

export async function siteForgeProductionCertificationWorkflow(
  input: SiteForgeProductionCertificationInput
) {
  'use workflow'
  console.info('[siteforge_production_certification] run started', {
    sharedJobId: input.sharedJobId,
    websiteId: input.websiteId,
    artifactId: input.artifactId,
  })
  try {
    return await certifySiteForgeProduction(input)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'SiteForge production certification failed'
    if (error instanceof ProductionProjectionReconciliationError) {
      await markSiteForgeProductionProjectionReconciliationRequired(
        input,
        message
      )
    } else {
      await failSiteForgeProductionCertification(input, message)
    }
    throw error
  }
}
