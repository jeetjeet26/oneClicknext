import {
  analyzeSiteForgeBrand,
  assertSiteForgeJobActive,
  completeSiteForgeGeneration,
  executeSiteForgePhotos,
  failSiteForgeGeneration,
  generateSiteForgeContent,
  loadConfirmedSiteForgePlan,
  persistSiteForgeGenerationArtifact,
  planSiteForgeArchitectureAndDesign,
  planSiteForgePhotos,
  updateSiteForgeGenerationStage,
  validateSiteForgeOutput,
  type SiteForgeGenerationWorkflowInput,
} from '@/utils/siteforge/workflows/generation-steps'

function workflowErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }
  return 'SiteForge generation failed'
}

export async function siteForgeGenerationWorkflow(
  input: SiteForgeGenerationWorkflowInput
) {
  'use workflow'

  console.info('[siteforge_workflow] run started', {
    sharedJobId: input.sharedJobId,
    websiteId: input.websiteId,
  })

  try {
    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'assembling_context',
      5,
      'Loading confirmed plan and trusted property context'
    )
    const confirmedPlan = await loadConfirmedSiteForgePlan(input)

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'analyzing_brand',
      10,
      'Loading the pinned approved brand contract'
    )
    const brandContext = await analyzeSiteForgeBrand(input)

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'planning_architecture',
      30,
      'Planning architecture and design system'
    )
    const { architecture, designSystem } =
      await planSiteForgeArchitectureAndDesign(input, brandContext, confirmedPlan)

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'planning_photos',
      45,
      'Planning approved asset usage'
    )
    const photoStrategy = await planSiteForgePhotos(
      input,
      brandContext,
      architecture
    )

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'generating_content',
      60,
      'Generating evidence-grounded content'
    )
    const pages = await generateSiteForgeContent(
      input,
      architecture,
      brandContext
    )

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'executing_photos',
      75,
      'Resolving and preparing website assets'
    )
    const photoManifest = await executeSiteForgePhotos(
      input,
      photoStrategy,
      pages,
      brandContext
    )

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'validating_quality',
      90,
      'Running fail-closed quality validation'
    )
    const qualityReport = await validateSiteForgeOutput(
      input,
      confirmedPlan,
      pages,
      designSystem,
      photoManifest,
      brandContext
    )

    await assertSiteForgeJobActive(input)
    await updateSiteForgeGenerationStage(
      input,
      'publishing_artifact',
      95,
      'Publishing immutable generation artifact'
    )
    const output = await persistSiteForgeGenerationArtifact(
      input,
      confirmedPlan,
      brandContext,
      architecture,
      designSystem,
      photoManifest,
      pages,
      qualityReport
    )
    await completeSiteForgeGeneration(input, output)

    console.info('[siteforge_workflow] run completed', {
      sharedJobId: input.sharedJobId,
    })
    return {
      sharedJobId: input.sharedJobId,
      websiteId: input.websiteId,
      ...output,
    }
  } catch (error) {
    const message = workflowErrorMessage(error)
    await failSiteForgeGeneration(input, message)
    throw error
  }
}
