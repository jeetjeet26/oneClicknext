import {
  normalizeUnitScore,
  type PremiumCreativeCandidate,
  type PremiumCreativeEvaluation,
  type PremiumCreativeSection,
  type PremiumCreativeVertical,
} from '@/evals/forge/contracts'
import { evaluatePremiumCreative } from '@/evals/forge/evaluate'
import type { GeneratedPage, PageSection } from '@/types/siteforge'

// Advisory premium-creative scoring for real generated sites. This adapter
// projects the deployable page shape onto the eval rubric's candidate shape
// so the same deterministic evaluator that qualifies fixtures can score live
// output. The score is informational only and never gates generation, edits,
// or launch (solo-operator doctrine).

export type SiteForgePremiumCreativeReport = {
  schemaVersion: 1
  advisory: true
  evaluatedAt: string
  pageSlug: string
  normalizedScore: number
  passThreshold: number
  passed: boolean
  metrics: PremiumCreativeEvaluation['metrics']
  findings: PremiumCreativeEvaluation['findings']
  evaluatorVersion: string
  rubricVersion: string
}

const ASSET_REFERENCE = /^(?:https?:\/\/|\/|assets\/)/i

function stringLeaves(value: unknown, depth = 0): string[] {
  if (depth > 6) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed && !ASSET_REFERENCE.test(trimmed) ? [trimmed] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => stringLeaves(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(item => stringLeaves(item, depth + 1))
  }
  return []
}

function classifySectionKind(
  section: PageSection
): PremiumCreativeSection['kind'] {
  const identity = `${section.type} ${section.acfBlock}`.toLowerCase()
  if (/hero/.test(identity)) return 'hero'
  if (/floor|inventory|pricing|availability|residence|unit|plan/.test(identity)) {
    return 'inventory'
  }
  if (/amenit/.test(identity)) return 'amenities'
  if (/neighborhood|location|map|poi|area|nearby/.test(identity)) {
    return 'neighborhood'
  }
  if (/signature/.test(identity)) return 'signature'
  if (/cta|contact|tour|form|lead|schedule|apply/.test(identity)) return 'cta'
  return 'story'
}

function extractHeadline(section: PageSection, leaves: string[]): string {
  const content = section.content as Record<string, unknown>
  for (const key of ['headline', 'title', 'heading', 'header']) {
    const value = content[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return leaves.find(leaf => leaf.length <= 120) || ''
}

function extractImageDirection(section: PageSection): string | undefined {
  const direction = stringLeaves(section.photoRequirement).join(' ')
  return direction || undefined
}

function extractMobileTreatment(section: PageSection): string | undefined {
  const mobile = section.presentation?.breakpointOverrides?.mobile
  if (!mobile) return undefined
  const description = Object.entries(mobile)
    .map(([field, value]) => `${field}: ${JSON.stringify(value)}`)
    .join(', ')
  return description ? `Mobile override — ${description}` : undefined
}

function extractInventoryDetails(
  leaves: string[],
  content: Record<string, unknown>
): PremiumCreativeSection['inventory'] {
  const filters = Array.isArray(content.filters)
    ? content.filters.filter(
        (item): item is string => typeof item === 'string' && Boolean(item.trim())
      )
    : []
  const joined = leaves.join(' ')
  const ctaLeaf = ['ctaLabel', 'cta_label', 'buttonLabel', 'cta']
    .map(key => content[key])
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  return {
    filters,
    showsPricing: /\$\s?\d|per month|\/mo\b|\brent\b|\bpric/i.test(joined),
    showsStatus: /\bavailab|\bstatus\b|\bsold\b|\bleased\b|\bwaitlist/i.test(joined),
    cardCta: ctaLeaf?.trim() || '',
    mobileColumns: 2,
  }
}

function extractSignatureInteraction(leaves: string[]): string | undefined {
  return leaves.find(leaf =>
    /hover|scroll|animation|parallax|interactive|reveal|transition/i.test(leaf)
  )
}

function toPremiumCreativeSection(
  section: PageSection,
  index: number,
  total: number
): PremiumCreativeSection {
  const kind = classifySectionKind(section)
  const leaves = stringLeaves(section.content)
  const headline = extractHeadline(section, leaves)
  const copy = leaves
    .filter(leaf => leaf !== headline)
    .join(' ')
    .slice(0, 4_000)
  return {
    id: section.id || `${section.type}-${index}`,
    kind,
    headline,
    copy,
    layout: section.variant || section.acfBlock,
    emphasis:
      kind === 'hero' && index === 0
        ? 'primary'
        : kind === 'cta' && index === total - 1
          ? 'secondary'
          : 'supporting',
    imageDirection: extractImageDirection(section),
    mobileTreatment: extractMobileTreatment(section),
    ...(kind === 'inventory'
      ? {
          inventory: extractInventoryDetails(
            leaves,
            section.content as Record<string, unknown>
          ),
        }
      : {}),
    ...(kind === 'signature'
      ? { signatureInteraction: extractSignatureInteraction(leaves) }
      : {}),
  }
}

export function extractBrandTerms(brandContext: unknown): string[] {
  if (!brandContext || typeof brandContext !== 'object') return []
  const record = brandContext as Record<string, unknown>
  const candidates: unknown[] = [
    (record.contentStrategy as Record<string, unknown> | undefined)
      ?.vocabularyUse,
    (record.brandPersonality as Record<string, unknown> | undefined)?.traits,
    (record.positioning as Record<string, unknown> | undefined)
      ?.differentiators,
    (record.visualIdentity as Record<string, unknown> | undefined)
      ?.moodKeywords,
  ]
  const terms = candidates
    .flatMap(value => (Array.isArray(value) ? value : []))
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length >= 3
    )
    .map(value => value.trim())
  return [...new Set(terms)].slice(0, 12)
}

export function selectPrimaryNarrativePage(
  pages: GeneratedPage[]
): GeneratedPage | null {
  if (pages.length === 0) return null
  return (
    pages.find(page => ['home', 'index', '', '/'].includes(page.slug)) ||
    pages[0]
  )
}

export function evaluateSiteForgePremiumCreative(input: {
  pages: GeneratedPage[]
  brandContext?: unknown
  brandName?: string
  vertical?: PremiumCreativeVertical
  evaluatedAt?: string
}): SiteForgePremiumCreativeReport | null {
  const page = selectPrimaryNarrativePage(input.pages)
  if (!page || page.sections.length === 0) return null
  const sections = [...page.sections]
    .sort((left, right) => left.order - right.order)
    .map((section, index, all) =>
      toPremiumCreativeSection(section, index, all.length)
    )
  const candidate: PremiumCreativeCandidate = {
    id: `live:${page.slug || 'home'}`,
    pairId: `live:${page.slug || 'home'}`,
    quality: 'premium',
    vertical: input.vertical || 'multifamily',
    brandName: input.brandName || 'Property brand',
    brandTerms: extractBrandTerms(input.brandContext),
    sections,
  }
  const evaluation = evaluatePremiumCreative(candidate)
  return {
    schemaVersion: 1,
    advisory: true,
    evaluatedAt: input.evaluatedAt || new Date().toISOString(),
    pageSlug: page.slug,
    normalizedScore: normalizeUnitScore(evaluation.normalizedScore),
    passThreshold: evaluation.passThreshold,
    passed: evaluation.passed,
    metrics: evaluation.metrics,
    findings: evaluation.findings,
    evaluatorVersion: evaluation.evaluatorVersion,
    rubricVersion: evaluation.rubricVersion,
  }
}
