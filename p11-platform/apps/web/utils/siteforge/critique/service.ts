import { z } from 'zod'
import type { SemanticBlueprintPatchOperation } from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { SITEFORGE_CLAUDE_MODEL } from '@/utils/siteforge/models'
import {
  SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION,
  SITEFORGE_CRITIQUE_MAX_FINDINGS,
  providerCritiqueOutputSchema,
  renderedAestheticCritiqueReportSchema,
  type AestheticCritiqueFinding,
  type AestheticCritiqueSeverity,
  type ProviderCritiqueOutput,
  type RenderedAestheticCritiqueReport,
} from './contracts'
import {
  evaluateDeterministicAestheticCritique,
} from './deterministic'
import type { BoundCritiqueEvidence } from './evidence'
import {
  buildSupervisedRepairProposals,
  type CritiqueRepairDraft,
} from './proposals'
import {
  runRenderedCritiqueProvider,
  type RenderedCritiqueProvider,
} from './provider'

const SEVERITY_RANK: Record<AestheticCritiqueSeverity, number> = {
  blocker: 4,
  major: 3,
  moderate: 2,
  minor: 1,
}

function screenshotReferenceKey(input: {
  pageUrl: string
  viewport: string
  screenshotSha256: string
  screenshotIdentityDigest: string
}): string {
  const url = new URL(input.pageUrl)
  url.hash = ''
  return [
    url.toString().replace(/\/$/, ''),
    input.viewport,
    input.screenshotSha256,
    input.screenshotIdentityDigest,
  ].join('|')
}

function acceptProviderFindings(
  output: ProviderCritiqueOutput,
  evidence: BoundCritiqueEvidence
): {
  findings: AestheticCritiqueFinding[]
  drafts: CritiqueRepairDraft[]
} {
  const screenshotKeys = new Set(
    evidence.screenshots.map(item =>
      screenshotReferenceKey({
        pageUrl: item.descriptor.url,
        viewport: item.descriptor.viewport,
        screenshotSha256: item.descriptor.sha256,
        screenshotIdentityDigest: item.descriptor.identityDigest,
      })
    )
  )
  const sectionIds = new Set(
    evidence.artifact.blueprint.pages.flatMap(page =>
      page.sections.flatMap(section => section.id || [])
    )
  )
  const findings: AestheticCritiqueFinding[] = []
  const drafts: CritiqueRepairDraft[] = []
  for (const candidate of output.findings) {
    if (
      candidate.evidence.some(
        reference => !screenshotKeys.has(screenshotReferenceKey(reference))
      ) ||
      candidate.affectedSectionIds.some(id => !sectionIds.has(id))
    ) {
      continue
    }
    const id = `provider-${candidate.category}-${hashSiteForgeContent({
      category: candidate.category,
      title: candidate.title,
      evidence: candidate.evidence,
    }).slice(0, 16)}`
    findings.push({
      id,
      source: 'provider',
      category: candidate.category,
      severity: candidate.severity,
      title: candidate.title,
      critique: candidate.critique,
      evidence: candidate.evidence,
      affectedSectionIds: candidate.affectedSectionIds,
      confidence: candidate.confidence,
    })
    drafts.push({
      findingIds: [id],
      summary: candidate.repairSummary,
      operations:
        candidate.suggestedOperations as SemanticBlueprintPatchOperation[],
    })
  }
  return { findings, drafts }
}

function highestSeverity(
  findings: AestheticCritiqueFinding[]
): AestheticCritiqueSeverity | null {
  return (
    [...findings].sort(
      (left, right) =>
        SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    )[0]?.severity ?? null
  )
}

export async function createRenderedAestheticCritique(input: {
  evidence: BoundCritiqueEvidence
  provider?: RenderedCritiqueProvider
  model?: string
  generatedAt?: string
}): Promise<RenderedAestheticCritiqueReport> {
  const deterministic = evaluateDeterministicAestheticCritique(input.evidence)
  const provider = input.provider ?? runRenderedCritiqueProvider
  let providerStatus: 'succeeded' | 'failed' = 'succeeded'
  let failureCode:
    | 'provider_unavailable'
    | 'invalid_provider_output'
    | null = null
  let providerFindings: AestheticCritiqueFinding[] = []
  let providerDrafts: CritiqueRepairDraft[] = []
  try {
    const accepted = acceptProviderFindings(
      providerCritiqueOutputSchema.parse(
        await provider({ evidence: input.evidence, model: input.model })
      ),
      input.evidence
    )
    providerFindings = accepted.findings
    providerDrafts = accepted.drafts
  } catch (error) {
    providerStatus = 'failed'
    failureCode =
      error instanceof z.ZodError
        ? 'invalid_provider_output'
        : 'provider_unavailable'
  }

  const findings = [
    ...deterministic.findings,
    ...providerFindings,
  ].slice(0, SITEFORGE_CRITIQUE_MAX_FINDINGS)
  const validFindingIds = new Set(findings.map(finding => finding.id))
  const pages = [
    ...new Set(
      input.evidence.screenshots.map(item => item.descriptor.url)
    ),
  ]
  const viewports = [
    ...new Set(
      input.evidence.screenshots.map(item => item.descriptor.viewport)
    ),
  ]
  const proposals = buildSupervisedRepairProposals({
    blueprint: input.evidence.artifact.blueprint,
    artifactId: input.evidence.artifact.id,
    contentHash: input.evidence.artifact.contentHash,
    evidenceDigest: input.evidence.evidenceDigest,
    drafts: [
      ...deterministic.repairDrafts.map(draft => ({
        findingIds: [draft.findingId],
        summary: draft.summary,
        operations: draft.operations,
      })),
      ...providerDrafts,
    ],
    validFindingIds,
    pages,
    viewports,
  })

  return renderedAestheticCritiqueReportSchema.parse({
    policyVersion: SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    binding: {
      artifactId: input.evidence.artifact.id,
      contentHash: input.evidence.artifact.contentHash,
      certificationEvidenceId: input.evidence.certificationEvidenceId,
      evidenceDigest: input.evidence.evidenceDigest,
      certificationReportHash: input.evidence.certificationReportHash,
      certificationBindingHash: input.evidence.certificationBindingHash,
      screenshotManifestDigest: input.evidence.screenshotManifestDigest,
      capturedAt: input.evidence.capturedAt,
    },
    provider: {
      status: providerStatus,
      model: input.model || SITEFORGE_CLAUDE_MODEL,
      failureCode,
    },
    highestSeverity: highestSeverity(findings),
    findings,
    proposals,
    deterministicChecks: deterministic.checks,
    policy: {
      proposalOnly: true,
      autoApply: false,
      applicationPath: 'siteforge_semantic_editor',
      maxProposals: 8,
      maxOperationsPerProposal: 3,
      maxTotalOperations: 12,
    },
  })
}
