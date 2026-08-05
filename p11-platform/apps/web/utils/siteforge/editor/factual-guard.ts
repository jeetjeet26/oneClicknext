import type { GeneratedPage, SiteBlueprint } from '@/types/siteforge'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { SITEFORGE_PLACEHOLDER_EVIDENCE_ID } from '@/utils/siteforge/generation/evidence-safe-content'

const SOURCE_MANAGED_BLOCKS = new Set([
  'acf/plans-availability',
  'acf/poi',
])

function normalizedText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase().replace(/\s+/g, ' ')
  if (Array.isArray(value)) return value.map(normalizedText).join(' ')
  if (value && typeof value === 'object') {
    return Object.values(value).map(normalizedText).join(' ')
  }
  return typeof value === 'number' ? String(value) : ''
}

export function assertFactualSemanticEditGrounding(input: {
  originalBlueprint: SiteBlueprint
  updatedBlueprint: SiteBlueprint
  confirmedPlan?: SiteForgePlan
}): void {
  const originalSections = new Map(
    (input.originalBlueprint.pages as GeneratedPage[]).flatMap(page =>
      page.sections
        .filter(section => Boolean(section.id))
        .map(section => [section.id as string, section] as const)
    )
  )
  const knownFacts = input.confirmedPlan?.knownFacts || []

  for (const page of input.updatedBlueprint.pages as GeneratedPage[]) {
    for (const section of page.sections) {
      const original = section.id
        ? originalSections.get(section.id)
        : undefined
      if (
        original &&
        hashSiteForgeContent(original.content) ===
          hashSiteForgeContent(section.content)
      ) {
        continue
      }
      if (SOURCE_MANAGED_BLOCKS.has(section.acfBlock)) {
        throw new Error(
          `Section ${page.slug}.${section.id || section.type} contains source-managed factual data; update its approved provider/import source instead of semantic copy`
        )
      }
      const evidenceIds = (section.evidenceIds || []).filter(
        evidenceId => evidenceId !== SITEFORGE_PLACEHOLDER_EVIDENCE_ID
      )
      if (!evidenceIds.length) continue
      if (evidenceIds.every(evidenceId => evidenceId.startsWith('legal:'))) {
        continue
      }
      const supportingFacts = knownFacts.filter(fact =>
        fact.evidenceIds.some(evidenceId => evidenceIds.includes(evidenceId))
      )
      const content = normalizedText(section.content)
      if (
        !supportingFacts.length ||
        !supportingFacts.some(fact =>
          content.includes(normalizedText(fact.claim).trim())
        )
      ) {
        throw new Error(
          `Changed factual section ${page.slug}.${section.id || section.type} does not retain an exact claim from its pinned evidence`
        )
      }
    }
  }
}
