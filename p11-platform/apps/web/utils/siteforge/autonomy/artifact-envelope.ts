import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION =
  'siteforge.role-artifact.v1' as const

export const SITEFORGE_AUTONOMOUS_ROLES = [
  'truth-curator.v1',
  'strategist.v1',
  'creative-director.v1',
  'design-system.v1',
  'content.v1',
  'asset-director.v1',
  'qa-council.v1',
  'repair-controller.v1',
  'release-operator.v1',
  'operations.v1',
] as const

export const siteForgeAutonomousRoleSchema = z.enum(
  SITEFORGE_AUTONOMOUS_ROLES
)

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const versionSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*\.v\d+$/i)
const nonNegativeFiniteNumber = z.number().finite().nonnegative()
const uniqueStrings = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Values must be unique',
      })
    }
  })

export const siteForgeArtifactConflictSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  evidenceIds: uniqueStrings(z.string().trim().min(1)).default([]),
})

export const siteForgeGenerationSettingsSchema = z
  .object({
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().finite().min(0).max(2).optional(),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict()

export const siteForgeArtifactExecutionSchema = z
  .object({
    modelPolicyVersion: versionSchema,
    modelId: z.string().trim().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/i),
    provider: z.string().trim().regex(/^[a-z0-9._-]+$/i),
    promptVersion: versionSchema,
    outputSchemaVersion: versionSchema,
    evaluatorVersion: versionSchema,
    settings: siteForgeGenerationSettingsSchema,
    confidence: z.number().finite().min(0).max(1),
    conflicts: z.array(siteForgeArtifactConflictSchema),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (!metadata.modelId.startsWith(`${metadata.provider}/`)) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Provider must match the Gateway model ID prefix',
      })
    }
  })

export const siteForgeArtifactUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: nonNegativeFiniteNumber,
    latencyMs: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['totalTokens'],
        message: 'Total tokens must equal input plus output tokens',
      })
    }
  })

export const siteForgeArtifactValidationSchema = z
  .object({
    valid: z.boolean(),
    status: z.enum(['passed', 'failed']),
    issues: z.array(
      z.object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
        path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      }).strict()
    ),
  })
  .strict()
  .superRefine((validation, context) => {
    if (validation.valid !== (validation.status === 'passed')) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Validation status must agree with valid',
      })
    }
    if (validation.valid && validation.issues.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'Passed validation cannot contain issues',
      })
    }
  })

export const siteForgeRoleArtifactBodySchema = z
  .object({
    schemaVersion: z.literal(SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION),
    role: siteForgeAutonomousRoleSchema,
    artifactType: versionSchema,
    parentHashes: uniqueStrings(sha256Schema),
    evidenceIds: uniqueStrings(z.string().trim().min(1)),
    execution: siteForgeArtifactExecutionSchema,
    usage: siteForgeArtifactUsageSchema,
    validation: siteForgeArtifactValidationSchema,
    payload: z.json(),
  })
  .strict()

export const siteForgeRoleArtifactEnvelopeSchema =
  siteForgeRoleArtifactBodySchema
    .extend({
      artifactHash: sha256Schema,
    })
    .strict()
    .superRefine((envelope, context) => {
      const { artifactHash, ...body } = envelope
      if (artifactHash !== hashSiteForgeContent(body)) {
        context.addIssue({
          code: 'custom',
          path: ['artifactHash'],
          message: 'Artifact hash does not match the canonical envelope body',
        })
      }
      if (envelope.parentHashes.includes(artifactHash)) {
        context.addIssue({
          code: 'custom',
          path: ['parentHashes'],
          message: 'An artifact cannot be its own parent',
        })
      }
    })

export type SiteForgeAutonomousRole = z.infer<
  typeof siteForgeAutonomousRoleSchema
>
export type SiteForgeRoleArtifactBody = z.infer<
  typeof siteForgeRoleArtifactBodySchema
>
export type SiteForgeRoleArtifactEnvelope = z.infer<
  typeof siteForgeRoleArtifactEnvelopeSchema
>

export function hashSiteForgeRoleArtifact(
  body: SiteForgeRoleArtifactBody
): string {
  return hashSiteForgeContent(siteForgeRoleArtifactBodySchema.parse(body))
}

export function createSiteForgeRoleArtifact(
  input: SiteForgeRoleArtifactBody
): SiteForgeRoleArtifactEnvelope {
  const body = siteForgeRoleArtifactBodySchema.parse(input)
  return siteForgeRoleArtifactEnvelopeSchema.parse({
    ...body,
    artifactHash: hashSiteForgeContent(body),
  })
}

export function parseSiteForgeRoleArtifact(
  input: unknown
): SiteForgeRoleArtifactEnvelope {
  return siteForgeRoleArtifactEnvelopeSchema.parse(input)
}
