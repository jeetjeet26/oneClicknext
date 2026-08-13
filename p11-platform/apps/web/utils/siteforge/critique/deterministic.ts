import type {
  GeneratedPage,
  PageSection,
  SemanticBlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { SITEFORGE_BLOCK_CAPABILITIES } from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type {
  AestheticCritiqueFinding,
  DeterministicCritiqueCheck,
} from './contracts'
import type { BoundCritiqueEvidence } from './evidence'

export interface DeterministicRepairDraft {
  findingId: string
  summary: string
  operations: SemanticBlueprintPatchOperation[]
}

export interface DeterministicCritiqueResult {
  findings: AestheticCritiqueFinding[]
  checks: DeterministicCritiqueCheck[]
  repairDrafts: DeterministicRepairDraft[]
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function pageUrl(baseUrl: string, slug: string): string {
  return normalizedUrl(
    new URL(slug === 'home' ? '/' : `/${slug}/`, baseUrl).toString()
  )
}

function reference(
  evidence: BoundCritiqueEvidence,
  url: string,
  observation: string
): AestheticCritiqueFinding['evidence'][number] {
  const screenshot =
    evidence.screenshots.find(
      item =>
        normalizedUrl(item.descriptor.url) === normalizedUrl(url) &&
        item.descriptor.viewport === 'desktop'
    ) ??
    evidence.screenshots.find(
      item => normalizedUrl(item.descriptor.url) === normalizedUrl(url)
    )
  if (!screenshot) {
    throw new Error(`Bound screenshot reference is unavailable for ${url}`)
  }
  return {
    pageUrl: screenshot.descriptor.url,
    viewport: screenshot.descriptor.viewport,
    screenshotSha256: screenshot.descriptor.sha256,
    screenshotIdentityDigest: screenshot.descriptor.identityDigest,
    observation,
  }
}

function findingId(
  category: AestheticCritiqueFinding['category'],
  evidence: unknown
): string {
  return `det-${category}-${hashSiteForgeContent(evidence).slice(0, 16)}`
}

function signature(section: PageSection): string {
  return `${section.acfBlock}:${section.variant || 'default'}`
}

function stringsAtKeys(
  value: unknown,
  keyPattern: RegExp,
  parentKey = ''
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => stringsAtKeys(item, keyPattern, parentKey))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) => {
      const matched =
        typeof item === 'string' &&
        (keyPattern.test(key) || keyPattern.test(parentKey))
      return [
        ...(matched && item.trim() ? [item.trim()] : []),
        ...stringsAtKeys(item, keyPattern, key),
      ]
    }
  )
}

function imageUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(imageUrls)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) => {
      if (
        typeof item === 'string' &&
        /^https:\/\//i.test(item) &&
        /(image|photo|src|url)/i.test(key)
      ) {
        return [item]
      }
      return imageUrls(item)
    }
  )
}

function alternativeVariant(
  section: PageSection
): string | null {
  const variants = SITEFORGE_BLOCK_CAPABILITIES[section.acfBlock].variants
  return variants.find(variant => variant !== section.variant) ?? null
}

function variantRepair(
  pages: GeneratedPage[],
  pageSlug: string
): SemanticBlueprintPatchOperation[] {
  const page = pages.find(candidate => candidate.slug === pageSlug)
  const section = page?.sections.find(
    candidate => candidate.id && alternativeVariant(candidate)
  )
  const variant = section ? alternativeVariant(section) : null
  return section?.id && variant
    ? [
        {
          version: 2,
          op: 'section.update',
          sectionId: section.id,
          value: { variant },
          reasoning:
            'Vary the certified page composition while preserving content and evidence.',
        },
      ]
    : []
}

function maxConsecutiveSectionType(page: GeneratedPage): number {
  let maximum = 0
  let current = 0
  let prior = ''
  for (const section of page.sections) {
    if (section.acfBlock === prior) current += 1
    else current = 1
    prior = section.acfBlock
    maximum = Math.max(maximum, current)
  }
  return maximum
}

export function evaluateDeterministicAestheticCritique(
  evidence: BoundCritiqueEvidence
): DeterministicCritiqueResult {
  const blueprint = evidence.artifact.blueprint as SiteBlueprint
  const pages = blueprint.pages as GeneratedPage[]
  const findings: AestheticCritiqueFinding[] = []
  const checks: DeterministicCritiqueCheck[] = []
  const repairDrafts: DeterministicRepairDraft[] = []

  const signatures = pages.map(page => ({
    page,
    signature: page.sections.map(signature).join('|'),
  }))
  const repeatedSignatures = signatures.flatMap((left, index) =>
    signatures.slice(index + 1).flatMap(right =>
      left.signature === right.signature
        ? [[left.page.slug, right.page.slug] as const]
        : []
    )
  )
  checks.push({
    id: 'deterministic.repeated_page_composition',
    category: 'repetition',
    triggered: repeatedSignatures.length > 0,
    summary: repeatedSignatures.length
      ? 'Multiple pages use the exact same block and variant sequence.'
      : 'No exact duplicate page composition was detected.',
    evidence: { repeatedSignatures },
  })
  if (repeatedSignatures.length) {
    const [leftSlug, rightSlug] = repeatedSignatures[0]
    const id = findingId('repetition', repeatedSignatures)
    findings.push({
      id,
      source: 'deterministic',
      category: 'repetition',
      severity: repeatedSignatures.length > 1 ? 'major' : 'moderate',
      title: 'Page compositions repeat exactly',
      critique:
        'The same certified section and variant sequence is reused across distinct pages, reducing visual pacing and memorability.',
      evidence: [leftSlug, rightSlug].map(slug =>
        reference(
          evidence,
          pageUrl(evidence.targetUrl, slug),
          `${slug} uses the shared sequence ${signatures.find(item => item.page.slug === slug)?.signature}.`
        )
      ),
      affectedSectionIds: pages
        .filter(page => page.slug === leftSlug || page.slug === rightSlug)
        .flatMap(page => page.sections.flatMap(section => section.id || []))
        .slice(0, 12),
      confidence: 1,
    })
    const operations = variantRepair(pages, rightSlug)
    if (operations.length) {
      repairDrafts.push({
        findingId: id,
        summary: `Differentiate ${rightSlug} with an existing supported section variant.`,
        operations,
      })
    }
  }

  const densitySignals = pages.flatMap(page => {
    const consecutive = maxConsecutiveSectionType(page)
    return page.sections.length >= 9 || consecutive >= 3
      ? [
          {
            slug: page.slug,
            sectionCount: page.sections.length,
            maxConsecutiveSameBlock: consecutive,
          },
        ]
      : []
  })
  checks.push({
    id: 'deterministic.section_density',
    category: 'density',
    triggered: densitySignals.length > 0,
    summary: densitySignals.length
      ? 'One or more pages exceed deterministic section-density thresholds.'
      : 'Section counts and consecutive block runs are within critique thresholds.',
    evidence: { pages: densitySignals, maxSections: 8, maxConsecutive: 2 },
  })
  if (densitySignals.length) {
    const signal = densitySignals[0]
    const page = pages.find(candidate => candidate.slug === signal.slug)!
    const compact = page.sections.find(
      section =>
        section.id &&
        section.acfBlock === 'acf/feature-section' &&
        section.variant !== 'compact'
    )
    const id = findingId('density', densitySignals)
    findings.push({
      id,
      source: 'deterministic',
      category: 'density',
      severity: signal.sectionCount >= 12 ? 'major' : 'moderate',
      title: 'Page density needs visual relief',
      critique:
        'The certified page contains a high section count or a long run of the same block family, which can flatten scan rhythm.',
      evidence: [
        reference(
          evidence,
          pageUrl(evidence.targetUrl, signal.slug),
          `${signal.sectionCount} sections; longest repeated block run is ${signal.maxConsecutiveSameBlock}.`
        ),
      ],
      affectedSectionIds: page.sections.flatMap(section => section.id || []),
      confidence: 0.98,
    })
    if (compact?.id) {
      repairDrafts.push({
        findingId: id,
        summary: `Use the supported compact feature treatment on ${signal.slug}.`,
        operations: [
          {
            version: 2,
            op: 'section.update',
            sectionId: compact.id,
            value: { variant: 'compact' },
            reasoning:
              'Create visual relief without deleting content or changing factual claims.',
          },
        ],
      })
    }
  }

  const headerCta =
    blueprint.siteConfiguration?.header.cta.enabled === true
      ? [blueprint.siteConfiguration.header.cta.label]
      : []
  const ctaSignals = pages.flatMap(page => {
    const labels = [
      ...headerCta,
      ...page.sections.flatMap(section =>
        stringsAtKeys(section.content, /(cta|button|link)/i)
      ),
    ]
    const distinct = [...new Set(labels.map(label => label.toLowerCase()))]
    return labels.length >= 5 && distinct.length >= 3
      ? [{ slug: page.slug, labels, distinctLabels: distinct }]
      : []
  })
  checks.push({
    id: 'deterministic.cta_competition',
    category: 'cta_competition',
    triggered: ctaSignals.length > 0,
    summary: ctaSignals.length
      ? 'A page presents at least five CTA-like labels across three intents.'
      : 'No obvious CTA competition threshold was exceeded.',
    evidence: { pages: ctaSignals, maxTotal: 4, maxDistinct: 2 },
  })
  if (ctaSignals.length) {
    const signal = ctaSignals[0]
    const id = findingId('cta_competition', ctaSignals)
    findings.push({
      id,
      source: 'deterministic',
      category: 'cta_competition',
      severity: signal.distinctLabels.length >= 5 ? 'major' : 'moderate',
      title: 'Multiple calls to action compete',
      critique:
        'The certified page exposes several distinct CTA labels, weakening the primary conversion path.',
      evidence: [
        reference(
          evidence,
          pageUrl(evidence.targetUrl, signal.slug),
          `${signal.labels.length} CTA-like labels across ${signal.distinctLabels.length} distinct intents.`
        ),
      ],
      affectedSectionIds: pages
        .find(page => page.slug === signal.slug)!
        .sections.flatMap(section => section.id || []),
      confidence: 0.96,
    })
    if (blueprint.siteConfiguration?.header.cta.enabled) {
      repairDrafts.push({
        findingId: id,
        summary:
          'Remove the persistent header CTA from the competing CTA set for supervised review.',
        operations: [
          {
            version: 2,
            op: 'header.update',
            value: { cta: { enabled: false } },
            reasoning:
              'Reduce simultaneous conversion prompts while preserving page-level actions.',
          },
        ],
      })
    }
  }

  const headlineRhythms = pages.flatMap(page => {
    const headlines = page.sections.flatMap(section =>
      stringsAtKeys(section.content, /(headline|heading|title)/i)
    )
    const wordCounts = headlines.map(value => value.split(/\s+/).length)
    const repeatedCount =
      wordCounts.length >= 4 &&
      new Set(wordCounts).size <= Math.max(1, Math.floor(wordCounts.length / 3))
    return repeatedCount ? [{ slug: page.slug, headlines, wordCounts }] : []
  })
  checks.push({
    id: 'deterministic.copy_rhythm',
    category: 'copy_rhythm',
    triggered: headlineRhythms.length > 0,
    summary: headlineRhythms.length
      ? 'Headline lengths repeat with little variation on at least one page.'
      : 'No obvious repeated headline-length rhythm was detected.',
    evidence: { pages: headlineRhythms },
  })
  if (headlineRhythms.length) {
    const signal = headlineRhythms[0]
    findings.push({
      id: findingId('copy_rhythm', headlineRhythms),
      source: 'deterministic',
      category: 'copy_rhythm',
      severity: 'minor',
      title: 'Headline rhythm is mechanically uniform',
      critique:
        'Several headings use the same short cadence, making the page feel templated even when the content differs.',
      evidence: [
        reference(
          evidence,
          pageUrl(evidence.targetUrl, signal.slug),
          `Headline word counts: ${signal.wordCounts.join(', ')}.`
        ),
      ],
      affectedSectionIds: pages
        .find(page => page.slug === signal.slug)!
        .sections.flatMap(section => section.id || []),
      confidence: 0.9,
    })
  }

  const imageUsage = new Map<string, Set<string>>()
  for (const page of pages) {
    for (const url of page.sections.flatMap(section => imageUrls(section.content))) {
      const slugs = imageUsage.get(url) ?? new Set<string>()
      slugs.add(page.slug)
      imageUsage.set(url, slugs)
    }
  }
  const repeatedImages = [...imageUsage.entries()]
    .filter(([, slugs]) => slugs.size >= 3)
    .map(([url, slugs]) => ({ url, pages: [...slugs] }))
  checks.push({
    id: 'deterministic.repeated_imagery',
    category: 'imagery_cropping',
    triggered: repeatedImages.length > 0,
    summary: repeatedImages.length
      ? 'The same image URL is used across three or more pages.'
      : 'No image is repeated across three or more pages.',
    evidence: { repeatedImages },
  })
  if (repeatedImages.length) {
    const signal = repeatedImages[0]
    findings.push({
      id: findingId('imagery_cropping', repeatedImages),
      source: 'deterministic',
      category: 'imagery_cropping',
      severity: 'moderate',
      title: 'Repeated imagery reduces page identity',
      critique:
        'A single approved image appears across several certified pages; review crop, focal point, or approved asset selection before publication.',
      evidence: signal.pages.slice(0, 3).map(slug =>
        reference(
          evidence,
          pageUrl(evidence.targetUrl, slug),
          `The blueprint binds the same approved image to ${slug}.`
        )
      ),
      affectedSectionIds: pages
        .filter(page => signal.pages.includes(page.slug))
        .flatMap(page => page.sections.flatMap(section => section.id || []))
        .slice(0, 12),
      confidence: 1,
    })
  }

  return { findings, checks, repairDrafts }
}
