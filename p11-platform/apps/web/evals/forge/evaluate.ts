import {
  PREMIUM_CREATIVE_EVALUATOR_VERSION,
  PREMIUM_CREATIVE_RUBRIC_VERSION,
  normalizeUnitScore,
  type PremiumCreativeCandidate,
  type PremiumCreativeEvaluation,
  type PremiumCreativeFinding,
  type PremiumCreativeMetricId,
} from './contracts'
import {
  PREMIUM_CREATIVE_PASS_THRESHOLD,
  PREMIUM_CREATIVE_RUBRIC,
} from './rubric'
import { findRepeatedCopy } from './similarity'

const GENERIC_PHRASES = [
  'luxury living',
  'something for everyone',
  'resort-style amenities',
  'live your best life',
  'perfect place to call home',
  'conveniently located',
  'thoughtfully designed',
  'unparalleled lifestyle',
]

function ratio(passed: number, total: number): number {
  return normalizeUnitScore(total === 0 ? 0 : passed / total)
}

function finding(
  candidate: PremiumCreativeCandidate,
  metric: PremiumCreativeMetricId,
  code: string,
  score: number,
  threshold: number,
  message: string,
  locations: string[],
  evidence: PremiumCreativeFinding['evidence'],
  severity: PremiumCreativeFinding['severity'] = 'warning'
): PremiumCreativeFinding {
  return {
    id: `${PREMIUM_CREATIVE_EVALUATOR_VERSION}:${candidate.id}:${code}`,
    code,
    metric,
    severity,
    score: normalizeUnitScore(score),
    threshold,
    message,
    locations,
    evidence,
    source: 'deterministic',
  }
}

function countBrandTerms(candidate: PremiumCreativeCandidate): number {
  const copy = candidate.sections
    .map(section => `${section.headline} ${section.copy}`)
    .join(' ')
    .toLowerCase()
  return candidate.brandTerms.filter(term => copy.includes(term.toLowerCase()))
    .length
}

export function evaluatePremiumCreative(
  candidate: PremiumCreativeCandidate
): PremiumCreativeEvaluation {
  const sections = candidate.sections
  const sequenceValid =
    sections.length >= 5 &&
    sections[0]?.kind === 'hero' &&
    sections.at(-1)?.kind === 'cta' &&
    sections.findIndex(section => section.kind === 'inventory') > 0 &&
    sections.findIndex(section => section.kind === 'inventory') <
      sections.findIndex(section => section.kind === 'cta')
  const kinds = new Set(sections.map(section => section.kind))
  const narrativeScore = normalizeUnitScore(
    0.55 * ratio(kinds.size, Math.min(6, sections.length)) +
      0.45 * Number(sequenceValid)
  )

  const primarySections = sections.filter(
    section => section.emphasis === 'primary'
  )
  const hierarchyScore = ratio(
    [
      primarySections.length === 1,
      sections[0]?.emphasis === 'primary',
      sections.at(-1)?.emphasis === 'secondary',
      sections.some(section => section.emphasis === 'supporting'),
    ].filter(Boolean).length,
    4
  )

  const repeatedAdjacentLayouts = sections.slice(1).filter(
    (section, index) => section.layout === sections[index].layout
  )
  const layoutVariety = ratio(
    new Set(sections.map(section => section.layout)).size,
    Math.min(4, sections.length)
  )
  const pacingScore = normalizeUnitScore(
    layoutVariety * 0.65 +
      ratio(
        sections.length - repeatedAdjacentLayouts.length,
        sections.length
      ) *
        0.35
  )

  const imageEligible = sections.filter(
    section => !['inventory', 'cta'].includes(section.kind)
  )
  const directedImages = imageEligible.filter(
    section =>
      (section.imageDirection?.trim().split(/\s+/).length || 0) >= 8 &&
      !/\b(generic|stock|nice image|property photo)\b/i.test(
        section.imageDirection || ''
      )
  )
  const imageScore = ratio(directedImages.length, imageEligible.length)

  const brandTermCount = countBrandTerms(candidate)
  const brandScore = normalizeUnitScore(
    Math.min(1, brandTermCount / Math.max(2, candidate.brandTerms.length))
  )

  const mobileSections = sections.filter(
    section => (section.mobileTreatment?.trim().length || 0) >= 12
  )
  const inventory = sections.find(section => section.kind === 'inventory')
    ?.inventory
  const mobileScore = ratio(
    mobileSections.length +
      Number(Boolean(inventory && inventory.mobileColumns <= 2)),
    sections.length + 1
  )
  const inventoryChecks = [
    Boolean(inventory),
    Boolean(inventory && inventory.filters.length >= 2),
    Boolean(inventory?.showsPricing),
    Boolean(inventory?.showsStatus),
    Boolean(inventory && inventory.cardCta.trim().length >= 4),
  ]
  const inventoryScore = ratio(inventoryChecks.filter(Boolean).length, 5)

  const signature = sections.find(section => section.kind === 'signature')
  const signatureScore = ratio(
    [
      Boolean(signature),
      Boolean(signature?.signatureInteraction?.trim()),
      Boolean(
        signature &&
          candidate.brandTerms.some(term =>
            `${signature.headline} ${signature.copy}`
              .toLowerCase()
              .includes(term.toLowerCase())
          )
      ),
    ].filter(Boolean).length,
    3
  )

  const genericLocations = sections.flatMap(section => {
    const text = `${section.headline} ${section.copy}`.toLowerCase()
    return GENERIC_PHRASES.some(phrase => text.includes(phrase))
      ? [section.id]
      : []
  })
  const genericScore = normalizeUnitScore(
    1 - ratio(genericLocations.length, sections.length)
  )
  const repetitions = findRepeatedCopy(sections)
  const maximumSimilarity = repetitions[0]?.similarity || 0
  const similarityScore = normalizeUnitScore(1 - maximumSimilarity)

  const scores: Record<PremiumCreativeMetricId, number> = {
    narrative_clarity: narrativeScore,
    hierarchy: hierarchyScore,
    composition_pacing: pacingScore,
    image_direction: imageScore,
    brand_distinctiveness: brandScore,
    mobile_quality: mobileScore,
    inventory_usability: inventoryScore,
    signature_experience: signatureScore,
    generic_language_rate: genericScore,
    repeated_copy_similarity: similarityScore,
  }

  const metrics = PREMIUM_CREATIVE_RUBRIC.map(entry => {
    const score = scores[entry.metric]
    const findings: PremiumCreativeFinding[] = []
    if (entry.metric === 'narrative_clarity' && !sequenceValid) {
      findings.push(
        finding(
          candidate,
          entry.metric,
          'SECTION_SEQUENCE_WEAK',
          score,
          entry.threshold,
          'Expected hero-to-inventory-to-CTA narrative sequence is missing.',
          sections.map(section => section.id),
          { sequence: sections.map(section => section.kind) },
          'blocker'
        )
      )
    }
    if (entry.metric === 'composition_pacing' && repeatedAdjacentLayouts.length) {
      findings.push(
        finding(
          candidate,
          entry.metric,
          'LAYOUT_RHYTHM_REPEATS',
          score,
          entry.threshold,
          'Adjacent sections repeat the same layout treatment.',
          repeatedAdjacentLayouts.map(section => section.id),
          { repeatedLayouts: repeatedAdjacentLayouts.map(section => section.layout) }
        )
      )
    }
    if (entry.metric === 'generic_language_rate' && genericLocations.length) {
      findings.push(
        finding(
          candidate,
          entry.metric,
          'GENERIC_LANGUAGE_HIGH',
          score,
          entry.threshold,
          'Generic category language dilutes the property narrative.',
          genericLocations,
          {
            genericSections: genericLocations.length,
            sectionCount: sections.length,
          },
          score < entry.threshold ? 'blocker' : 'warning'
        )
      )
    }
    if (entry.metric === 'repeated_copy_similarity' && repetitions.length) {
      findings.push(
        finding(
          candidate,
          entry.metric,
          'REPEATED_COPY_SIMILARITY',
          score,
          entry.threshold,
          'Two or more sections contain materially repeated copy.',
          [...new Set(repetitions.flatMap(match => [match.left, match.right]))],
          {
            maximumSimilarity,
            pairs: repetitions.map(
              match => `${match.left}:${match.right}:${match.similarity}`
            ),
          },
          score < entry.threshold ? 'blocker' : 'warning'
        )
      )
    }
    if (score < entry.threshold && findings.length === 0) {
      findings.push(
        finding(
          candidate,
          entry.metric,
          'METRIC_BELOW_PREMIUM_BAR',
          score,
          entry.threshold,
          `${entry.metric} is below the premium creative threshold.`,
          sections.map(section => section.id),
          { intent: entry.intent }
        )
      )
    }
    return { metric: entry.metric, score, weight: entry.weight, findings }
  })

  const normalizedScore = normalizeUnitScore(
    metrics.reduce((total, metric) => total + metric.score * metric.weight, 0)
  )
  const findings = metrics.flatMap(metric => metric.findings)

  return {
    schemaVersion: 1,
    evaluatorVersion: PREMIUM_CREATIVE_EVALUATOR_VERSION,
    rubricVersion: PREMIUM_CREATIVE_RUBRIC_VERSION,
    model: {
      provider: 'local',
      model: 'deterministic',
      version: 'heuristics-1',
    },
    candidateId: candidate.id,
    pairId: candidate.pairId,
    vertical: candidate.vertical,
    passed:
      normalizedScore >= PREMIUM_CREATIVE_PASS_THRESHOLD &&
      !findings.some(item => item.severity === 'blocker'),
    normalizedScore,
    passThreshold: PREMIUM_CREATIVE_PASS_THRESHOLD,
    metrics,
    findings,
  }
}
