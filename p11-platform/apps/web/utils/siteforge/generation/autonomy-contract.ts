import {
  createSiteForgeRoleArtifact,
  SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION,
  type SiteForgeAutonomousRole,
  type SiteForgeRoleArtifactEnvelope,
} from '@/utils/siteforge/autonomy/artifact-envelope'
import {
  assertSiteForgeRoleUsageWithinBudget,
  resolveSiteForgeRoleModelPolicy,
} from '@/utils/siteforge/agents/model-policy'

type ArtifactExecution = SiteForgeRoleArtifactEnvelope['execution']
type ArtifactUsage = SiteForgeRoleArtifactEnvelope['usage']
type ArtifactValidation = SiteForgeRoleArtifactEnvelope['validation']

export type SiteForgeAutonomousGenerationResult = {
  artifact: SiteForgeRoleArtifactEnvelope
  policy: ReturnType<typeof resolveSiteForgeRoleModelPolicy>
}

/**
 * Minimal boundary between generation output and autonomous role artifacts.
 * It pins policy metadata and enforces the role budget before hashing.
 */
export function createSiteForgeAutonomousGenerationResult(input: {
  role: SiteForgeAutonomousRole
  artifactType: string
  parentHashes?: string[]
  evidenceIds?: string[]
  promptVersion: string
  outputSchemaVersion: string
  evaluatorVersion: string
  confidence: number
  conflicts?: ArtifactExecution['conflicts']
  usage: ArtifactUsage
  validation: ArtifactValidation
  payload: SiteForgeRoleArtifactEnvelope['payload']
}): SiteForgeAutonomousGenerationResult {
  const policy = resolveSiteForgeRoleModelPolicy(input.role)
  assertSiteForgeRoleUsageWithinBudget({
    policy,
    ...input.usage,
  })

  return {
    policy,
    artifact: createSiteForgeRoleArtifact({
      schemaVersion: SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION,
      role: input.role,
      artifactType: input.artifactType,
      parentHashes: input.parentHashes || [],
      evidenceIds: input.evidenceIds || [],
      execution: {
        modelPolicyVersion: policy.policyVersion,
        modelId: policy.modelId,
        provider: policy.provider,
        promptVersion: input.promptVersion,
        outputSchemaVersion: input.outputSchemaVersion,
        evaluatorVersion: input.evaluatorVersion,
        settings: policy.settings,
        confidence: input.confidence,
        conflicts: input.conflicts || [],
      },
      usage: input.usage,
      validation: input.validation,
      payload: input.payload,
    }),
  }
}
