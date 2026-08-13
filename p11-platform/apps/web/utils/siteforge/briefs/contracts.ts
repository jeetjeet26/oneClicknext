import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const requiredText = z.string().trim().min(1)
const optionalUrl = z.string().trim().url().optional()

export const siteForgeBriefSchema = z.object({
  title: requiredText,
  summary: requiredText,
  objectives: z
    .array(
      z.object({
        statement: requiredText,
        priority: z.enum(['primary', 'secondary']),
        successSignal: requiredText,
      })
    )
    .min(1),
  audiences: z
    .array(
      z.object({
        segment: requiredText,
        needs: z.array(requiredText),
        objections: z.array(requiredText),
      })
    )
    .min(1),
  conversion: z.object({
    primaryAction: requiredText,
    secondaryActions: z.array(requiredText),
    funnelNotes: requiredText,
  }),
  scope: z.object({
    includedPages: z.array(requiredText).min(1),
    excludedItems: z.array(requiredText),
  }),
  stakeholders: z.array(
    z.object({
      name: requiredText,
      role: requiredText,
      email: z.string().trim().email().optional(),
      decisionRights: z.array(requiredText),
    })
  ),
  approvers: z.array(
    z.object({
      name: requiredText,
      role: requiredText,
      email: z.string().trim().email().optional(),
    })
  ),
  launchTarget: z.object({
    targetDate: z.string().date().nullable(),
    timezone: requiredText,
    flexibility: z.enum(['fixed', 'target', 'flexible']),
  }),
  legalConstraints: z.array(
    z.object({
      name: requiredText,
      requirement: requiredText,
      blocking: z.boolean(),
    })
  ),
  integrationConstraints: z.array(
    z.object({
      name: requiredText,
      requirement: requiredText,
      blocking: z.boolean(),
    })
  ),
  references: z.array(
    z.object({
      label: requiredText,
      url: optionalUrl,
      sourceId: z.string().trim().min(1).optional(),
      notes: z.string().trim().optional(),
    })
  ),
  kpis: z.array(
    z.object({
      name: requiredText,
      target: requiredText,
      measurement: requiredText,
      owner: z.string().trim().optional(),
    })
  ),
})

export const siteForgeBriefContradictionSchema = z.object({
  id: requiredText,
  field: requiredText,
  description: requiredText,
  sources: z.array(requiredText).min(2),
  resolutionNeeded: requiredText,
})

export const siteForgeBriefContradictionsSchema = z.array(
  siteForgeBriefContradictionSchema
)

export const siteForgeBriefStatusSchema = z.enum([
  'draft',
  'ready_for_review',
  'approved',
  'modified',
  'denied',
  'superseded',
])

export type SiteForgeBrief = z.infer<typeof siteForgeBriefSchema>
export type SiteForgeBriefContradiction = z.infer<
  typeof siteForgeBriefContradictionSchema
>
export type SiteForgeBriefStatus = z.infer<typeof siteForgeBriefStatusSchema>

export type SiteForgeBriefSourceIdentity = {
  onboardingSnapshotId: string
  onboardingSnapshotHash: string
  brandAssetId: string
  brandContractHash: string
}

export function hashSiteForgeBrief(input: {
  brief: SiteForgeBrief
  unresolvedContradictions: SiteForgeBriefContradiction[]
  sources: SiteForgeBriefSourceIdentity
}): string {
  return hashSiteForgeContent({
    schemaVersion: 1,
    brief: input.brief,
    unresolvedContradictions: input.unresolvedContradictions,
    sources: input.sources,
  })
}

export function assertSiteForgeBriefApprovable(input: {
  status: string
  unresolvedContradictions: unknown
  expectedContentHash: string
  actualContentHash: string
  pinnedSources: SiteForgeBriefSourceIdentity
  currentSources: SiteForgeBriefSourceIdentity
}): void {
  if (input.status !== 'ready_for_review') {
    throw new Error('Only a brief ready for review can be approved')
  }
  const contradictions = siteForgeBriefContradictionsSchema.parse(
    input.unresolvedContradictions
  )
  if (contradictions.length > 0) {
    throw new Error('Resolve all brief contradictions before approval')
  }
  if (input.expectedContentHash !== input.actualContentHash) {
    throw new Error('Brief content hash changed; reload before deciding')
  }
  if (
    input.pinnedSources.onboardingSnapshotId !==
      input.currentSources.onboardingSnapshotId ||
    input.pinnedSources.onboardingSnapshotHash !==
      input.currentSources.onboardingSnapshotHash ||
    input.pinnedSources.brandAssetId !== input.currentSources.brandAssetId ||
    input.pinnedSources.brandContractHash !==
      input.currentSources.brandContractHash
  ) {
    throw new Error(
      'Brief sources are stale; create a new version from current onboarding and BrandForge identities'
    )
  }
}
