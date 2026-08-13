import type {
  GeneratedPage,
  SemanticBlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION,
  SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL,
  SITEFORGE_CRITIQUE_MAX_PROPOSALS,
  SITEFORGE_CRITIQUE_MAX_TOTAL_OPERATIONS,
  supervisedRepairProposalSchema,
  type SupervisedRepairProposal,
} from './contracts'

const ALLOWED_REPAIR_OPERATIONS = new Set([
  'section.update',
  'section.move',
  'design.update',
  'header.update',
  'motion.update',
])

export interface CritiqueRepairDraft {
  findingIds: string[]
  summary: string
  operations: SemanticBlueprintPatchOperation[]
}

function collectUrls(value: unknown): Set<string> {
  const values = new Set<string>()
  const visit = (item: unknown) => {
    if (typeof item === 'string' && /^https:\/\//i.test(item)) {
      values.add(item)
    } else if (Array.isArray(item)) {
      item.forEach(visit)
    } else if (item && typeof item === 'object') {
      Object.values(item).forEach(visit)
    }
  }
  visit(value)
  return values
}

function numericTokens(value: unknown): Set<string> {
  return new Set(JSON.stringify(value).match(/\b\d+(?:[.,]\d+)*\b/g) || [])
}

function sectionById(
  blueprint: SiteBlueprint,
  sectionId: string
): { page: GeneratedPage; section: GeneratedPage['sections'][number] } | null {
  for (const page of blueprint.pages as GeneratedPage[]) {
    const section = page.sections.find(candidate => candidate.id === sectionId)
    if (section) return { page, section }
  }
  return null
}

function assertBoundedOperation(
  blueprint: SiteBlueprint,
  operation: SemanticBlueprintPatchOperation,
  approvedUrls: Set<string>
): void {
  if (!ALLOWED_REPAIR_OPERATIONS.has(operation.op)) {
    throw new Error(`Critique repair operation is not allowed: ${operation.op}`)
  }
  if (operation.op === 'section.update') {
    const target = sectionById(blueprint, operation.sectionId)
    if (!target) {
      throw new Error(
        `Critique repair references an unknown section: ${operation.sectionId}`
      )
    }
    if (
      operation.value.evidenceIds !== undefined ||
      operation.value.acfBlock !== undefined ||
      operation.value.type !== undefined
    ) {
      throw new Error(
        'Critique repairs cannot alter evidence identity or block semantics'
      )
    }
    if (operation.value.content !== undefined) {
      const nextContent = operation.value.content
      const originalContent = target.section.content
      if (
        JSON.stringify(nextContent).length > 6_000 ||
        Object.keys(nextContent).some(
          key => !Object.prototype.hasOwnProperty.call(originalContent, key)
        )
      ) {
        throw new Error(
          'Critique copy repair must stay within existing section fields and byte bounds'
        )
      }
      const originalNumbers = numericTokens(originalContent)
      if (
        [...numericTokens(nextContent)].some(
          token => !originalNumbers.has(token)
        )
      ) {
        throw new Error('Critique copy repair cannot introduce numeric claims')
      }
    }
  }
  if (operation.op === 'section.move') {
    const target = sectionById(blueprint, operation.sectionId)
    if (
      !target ||
      (operation.pageSlug !== undefined &&
        operation.pageSlug !== target.page.slug) ||
      operation.toOrder > target.page.sections.length
    ) {
      throw new Error(
        'Critique section moves must remain within the existing page bounds'
      )
    }
  }
  if (
    operation.op === 'design.update' &&
    (operation.value.colors !== undefined ||
      operation.value.typography !== undefined)
  ) {
    throw new Error(
      'Critique repairs cannot replace approved brand colors or typography'
    )
  }
  if (
    operation.op === 'header.update' &&
    operation.value.cta &&
    (operation.value.cta.label !== undefined ||
      operation.value.cta.href !== undefined)
  ) {
    throw new Error(
      'Critique repairs can reduce CTA competition but cannot invent CTA copy or destinations'
    )
  }
  for (const url of collectUrls(operation)) {
    if (!approvedUrls.has(url)) {
      throw new Error('Critique repair cannot introduce an unbound URL')
    }
  }
}

export function buildSupervisedRepairProposals(input: {
  blueprint: SiteBlueprint
  artifactId: string
  contentHash: string
  evidenceDigest: string
  drafts: CritiqueRepairDraft[]
  validFindingIds: ReadonlySet<string>
  pages: string[]
  viewports: Array<'desktop' | 'tablet' | 'mobile'>
}): SupervisedRepairProposal[] {
  const approvedUrls = collectUrls(input.blueprint)
  const proposals: SupervisedRepairProposal[] = []
  let totalOperations = 0
  for (const draft of input.drafts) {
    if (
      proposals.length >= SITEFORGE_CRITIQUE_MAX_PROPOSALS ||
      draft.operations.length === 0 ||
      draft.operations.length > SITEFORGE_CRITIQUE_MAX_OPERATIONS_PER_PROPOSAL ||
      draft.findingIds.some(id => !input.validFindingIds.has(id)) ||
      totalOperations + draft.operations.length >
        SITEFORGE_CRITIQUE_MAX_TOTAL_OPERATIONS
    ) {
      continue
    }
    try {
      draft.operations.forEach(operation =>
        assertBoundedOperation(input.blueprint, operation, approvedUrls)
      )
      applyBlueprintPatch(input.blueprint, draft.operations)
    } catch {
      continue
    }
    const id = `repair-${hashSiteForgeContent({
      findingIds: draft.findingIds,
      operations: draft.operations,
    }).slice(0, 20)}`
    proposals.push(
      supervisedRepairProposalSchema.parse({
        id,
        findingIds: [...new Set(draft.findingIds)],
        summary: draft.summary,
        operations: draft.operations,
        approval: {
          required: true,
          status: 'pending',
          scope: 'semantic_operations',
          policyVersion: SITEFORGE_AESTHETIC_CRITIQUE_POLICY_VERSION,
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          evidenceDigest: input.evidenceDigest,
          eligibleRoles: ['manager', 'admin'],
        },
        factualGuards: {
          strategy: 'siteforge_editor_factual_guard',
          preserveEvidenceIds: true,
          approvedAssetsOnly: true,
          sourceManagedBlocksImmutable: true,
          rejectNewFacts: true,
        },
        rerunTargets: {
          canonicalPreview: true,
          browserCertification: true,
          pages: input.pages,
          viewports: input.viewports,
        },
        directMutation: false,
      })
    )
    totalOperations += draft.operations.length
  }
  return proposals
}
