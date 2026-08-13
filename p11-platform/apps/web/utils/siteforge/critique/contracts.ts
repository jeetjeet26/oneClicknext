import { z } from 'zod'
import { semanticBlueprintPatchOperationSchema } from '@/types/siteforge'

export const SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION =
  'siteforge-rendered-aesthetic-critique-v1' as const
export const SITEFORGE_CRITIQUE_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000
export const SITEFORGE_CRITIQUE_MAX_FINDINGS = 24
export const SITEFORGE_CRITIQUE_MAX_PROPOSALS = 8
export const SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL = 3
export const SITEFORGE_CRITIQUE_MAX_TOTAL_OPERATIONS = 12

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const aestheticCritiqueCategorySchema = z.enum([
  'hierarchy',
  'repetition',
  'density',
  'brand_distinctiveness',
  'cta_competition',
  'imagery_cropping',
  'copy_rhythm',
  'page_differentiation',
])

export const aestheticCritiqueSeveritySchema = z.enum([
  'blocker',
  'major',
  'moderate',
  'minor',
])

export const critiqueScreenshotReferenceSchema = z
  .object({
    pageUrl: z.string().url(),
    viewport: z.enum(['desktop', 'tablet', 'mobile']),
    screenshotSha256: sha256Schema,
    screenshotIdentityDigest: sha256Schema,
    observation: z.string().trim().min(1).max(1_000),
  })
  .strict()

export const aestheticCritiqueFindingSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    source: z.enum(['provider', 'deterministic']),
    category: aestheticCritiqueCategorySchema,
    severity: aestheticCritiqueSeveritySchema,
    title: z.string().trim().min(1).max(200),
    critique: z.string().trim().min(1).max(2_000),
    evidence: z.array(critiqueScreenshotReferenceSchema).min(1).max(6),
    affectedSectionIds: z.array(z.string().trim().min(1).max(200)).max(12),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export const deterministicCritiqueCheckSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    category: aestheticCritiqueCategorySchema,
    triggered: z.boolean(),
    summary: z.string().trim().min(1).max(500),
    evidence: z.record(z.string(), z.unknown()),
  })
  .strict()

export const supervisedRepairProposalSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    findingIds: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
    summary: z.string().trim().min(1).max(1_000),
    operations: z
      .array(semanticBlueprintPatchOperationSchema)
      .min(1)
      .max(SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL),
    approval: z
      .object({
        required: z.literal(true),
        status: z.literal('pending'),
        scope: z.literal('semantic_operations'),
        policyVersion: z.literal(
          SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION
        ),
        artifactId: z.string().uuid(),
        contentHash: sha256Schema,
        evidenceDigest: sha256Schema,
        eligibleRoles: z.array(z.enum(['manager', 'admin'])).min(1),
      })
      .strict(),
    factualGuards: z
      .object({
        strategy: z.literal('siteforge_editor_factual_guard'),
        preserveEvidenceIds: z.literal(true),
        approvedAssetsOnly: z.literal(true),
        sourceManagedBlocksImmutable: z.literal(true),
        rejectNewFacts: z.literal(true),
      })
      .strict(),
    rerunTargets: z
      .object({
        canonicalPreview: z.literal(true),
        browserCertification: z.literal(true),
        pages: z.array(z.string().url()).min(1).max(20),
        viewports: z
          .array(z.enum(['desktop', 'tablet', 'mobile']))
          .min(1)
          .max(3),
      })
      .strict(),
    directMutation: z.literal(false),
  })
  .strict()

export const providerCritiqueFindingSchema = aestheticCritiqueFindingSchema
  .omit({ id: true, source: true })
  .extend({
    suggestedOperations: z
      .array(semanticBlueprintPatchOperationSchema)
      .min(1)
      .max(SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL),
    repairSummary: z.string().trim().min(1).max(1_000),
  })
  .strict()

export const providerCritiqueOutputSchema = z
  .object({
    findings: z
      .array(providerCritiqueFindingSchema)
      .max(SITEFORGE_CRITIQUE_MAX_FINDINGS),
  })
  .strict()

export const renderedAestheticCritiqueReportSchema = z
  .object({
    policyVersion: z.literal(SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION),
    generatedAt: z.string().datetime(),
    binding: z
      .object({
        artifactId: z.string().uuid(),
        contentHash: sha256Schema,
        certificationEvidenceId: z.string().uuid(),
        evidenceDigest: sha256Schema,
        certificationReportHash: sha256Schema,
        certificationBindingHash: sha256Schema,
        screenshotManifestDigest: sha256Schema,
        capturedAt: z.string().datetime(),
      })
      .strict(),
    provider: z
      .object({
        status: z.enum(['succeeded', 'failed']),
        model: z.string().min(1),
        failureCode: z
          .enum(['provider_unavailable', 'invalid_provider_output'])
          .nullable(),
      })
      .strict(),
    highestSeverity: aestheticCritiqueSeveritySchema.nullable(),
    findings: z
      .array(aestheticCritiqueFindingSchema)
      .max(SITEFORGE_CRITIQUE_MAX_FINDINGS),
    proposals: z
      .array(supervisedRepairProposalSchema)
      .max(SITEFORGE_CRITIQUE_MAX_PROPOSALS),
    deterministicChecks: z.array(deterministicCritiqueCheckSchema),
    policy: z
      .object({
        proposalOnly: z.literal(true),
        autoApply: z.literal(false),
        applicationPath: z.literal('siteforge_semantic_editor'),
        maxProposals: z.literal(SITEFORGE_CRITIQUE_MAX_PROPOSALS),
        maxOperationsPerProposal: z.literal(
          SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL
        ),
        maxTotalOperations: z.literal(
          SITEFORGE_CRITIQUE_MAX_TOTAL_OPERATIONS
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, context) => {
    const findingIds = new Set(report.findings.map(finding => finding.id))
    const operationCount = report.proposals.reduce(
      (total, proposal) => total + proposal.operations.length,
      0
    )
    if (operationCount > SITEFORGE_CRITIQUE_MAX_TOTAL_OPERATIONS) {
      context.addIssue({
        code: 'custom',
        path: ['proposals'],
        message: 'Critique repair proposals exceed the total operation bound',
      })
    }
    for (const [index, proposal] of report.proposals.entries()) {
      if (proposal.findingIds.some(id => !findingIds.has(id))) {
        context.addIssue({
          code: 'custom',
          path: ['proposals', index, 'findingIds'],
          message: 'Repair proposals must reference findings in this report',
        })
      }
      if (
        proposal.approval.artifactId !== report.binding.artifactId ||
        proposal.approval.contentHash !== report.binding.contentHash ||
        proposal.approval.evidenceDigest !== report.binding.evidenceDigest
      ) {
        context.addIssue({
          code: 'custom',
          path: ['proposals', index, 'approval'],
          message: 'Repair approval metadata must match the critique binding',
        })
      }
    }
  })

export type AestheticCritiqueCategory = z.infer<
  typeof aestheticCritiqueCategorySchema
>
export type AestheticCritiqueSeverity = z.infer<
  typeof aestheticCritiqueSeveritySchema
>
export type AestheticCritiqueFinding = z.infer<
  typeof aestheticCritiqueFindingSchema
>
export type DeterministicCritiqueCheck = z.infer<
  typeof deterministicCritiqueCheckSchema
>
export type ProviderCritiqueOutput = z.infer<
  typeof providerCritiqueOutputSchema
>
export type RenderedAestheticCritiqueReport = z.infer<
  typeof renderedAestheticCritiqueReportSchema
>
export type SupervisedRepairProposal = z.infer<
  typeof supervisedRepairProposalSchema
>
