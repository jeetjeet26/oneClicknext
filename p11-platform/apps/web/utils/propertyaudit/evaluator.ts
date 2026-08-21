/**
 * PropertyAudit Evaluator
 * Evaluates LLM responses and calculates GEO scores
 * 
 * Scoring Formula (LLM SERP Score):
 * - Position Component: 45% - LLM rank position (1st = 100%, 10th = 10%)
 * - Link Component: 25% - Citation link rank position
 * - SOV Component: 20% - Share of Voice (brand citations / total)
 * - Accuracy Component: 10% - Absence of warning flags
 */

import type { 
  AnswerBlock, 
  EvaluationContext, 
  EvaluatedAnswer, 
  ScoredAnswer, 
  ScoreBreakdown,
  AggregateScores 
} from './types'
import { finalizeAnswerBlock } from './entity-fallback'

// ============================================================================
// Domain Utilities
// ============================================================================

function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim()
  
  // Remove protocol if present
  normalized = normalized.replace(/^https?:\/\//, '')
  
  // Remove www prefix
  normalized = normalized.replace(/^www\./, '')
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '')
  
  // Remove paths
  normalized = normalized.split('/')[0]
  
  return normalized
}

function isBrandDomain(domain: string, brandDomains: string[]): boolean {
  const normalized = normalizeDomain(domain)
  return brandDomains.some(bd => {
    const normalizedBrand = normalizeDomain(bd)
    return normalized === normalizedBrand || normalized.endsWith('.' + normalizedBrand)
  })
}

// ============================================================================
// Evaluation Functions
// ============================================================================

function findBrandEntityRank(answer: AnswerBlock, context: EvaluationContext): number | null {
  for (const entity of answer.ordered_entities) {
    const entityDomain = normalizeDomain(entity.domain)
    const entityName = entity.name.toLowerCase()
    const brandNameLower = context.brandName.toLowerCase()
    
    // Check if entity domain matches brand domains
    if (context.brandDomains.length > 0 && isBrandDomain(entityDomain, context.brandDomains)) {
      return entity.position ?? null
    }
    
    // Check if entity name contains brand name (exact match)
    if (entityName.includes(brandNameLower)) {
      return entity.position ?? null
    }
    
    // Check for partial brand name match (e.g., "AMLI Aero" matches "AMLI Residential")
    // Split brand name into words and check if main identifier matches
    const brandWords = brandNameLower.split(/\s+/).filter(w => w.length > 3)
    if (brandWords.length > 0) {
      const mainBrand = brandWords[0] // e.g., "amli" from "AMLI Aero"
      if (entityName.includes(mainBrand) && mainBrand.length >= 4) {
        // Verify it's not a generic word like "apartments"
        const genericWords = ['apartments', 'apartment', 'properties', 'property', 'living', 'homes']
        if (!genericWords.includes(mainBrand)) {
          return entity.position ?? null
        }
      }
    }
  }
  return null
}

function findBrandLinkRank(answer: AnswerBlock, context: EvaluationContext): number | null {
  for (let index = 0; index < answer.citations.length; index++) {
    const citation = answer.citations[index]
    if (!citation) continue
    
    if (isBrandDomain(citation.domain, context.brandDomains)) {
      return index + 1
    }
  }
  return null
}

function computeSov(answer: AnswerBlock, context: EvaluationContext): number | null {
  if (answer.citations.length === 0) {
    return null
  }
  
  const brandCount = answer.citations.filter(citation =>
    isBrandDomain(citation.domain, context.brandDomains)
  ).length
  
  return brandCount / answer.citations.length
}

function computePresence(answer: AnswerBlock, context: EvaluationContext): boolean {
  // Check if brand appears in ordered entities
  const rank = findBrandEntityRank(answer, context)
  if (rank !== null) {
    return true
  }
  
  // Check if brand name appears in summary
  return answer.answer_summary.toLowerCase().includes(context.brandName.toLowerCase())
}

// ============================================================================
// Scoring Components
// ============================================================================

/**
 * Position Component (45% weight)
 * Higher rank = higher score
 * Rank 1 = 100%, Rank 10 = 10%
 */
export function computePositionComponent(rank: number | null): number {
  if (!rank || rank <= 0) {
    return 0
  }
  
  const maxRank = 10
  const bounded = Math.min(rank, maxRank)
  const score = ((maxRank - bounded + 1) / maxRank) * 100
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Link Component (25% weight)
 * Higher citation rank = higher score
 */
export function computeLinkComponent(rank: number | null): number {
  if (!rank || rank <= 0) {
    return 0
  }
  
  const maxRank = 10
  const bounded = Math.min(rank, maxRank)
  const score = ((maxRank - bounded + 1) / maxRank) * 100
  
  return Math.max(0, Math.min(100, score))
}

/**
 * SOV Component (20% weight)
 * Share of voice = brand citations / total citations
 */
export function computeSovComponent(sov: number | null): number {
  if (sov === null) {
    return 0
  }
  return Math.max(0, Math.min(100, sov * 100))
}

/**
 * Accuracy Component (10% weight)
 * Penalizes based on warning flags
 */
export function computeAccuracyComponent(flags: string[]): number {
  if (flags.length === 0) {
    return 100
  }
  
  if (flags.includes('possible_hallucination')) {
    return 0
  }
  
  if (flags.includes('no_sources')) {
    return 25
  }
  
  // Other flags get partial penalty
  return 60
}

// ============================================================================
// Main Evaluation Functions
// ============================================================================

/**
 * Evaluate an answer block to extract metrics
 */
export function evaluateAnswer(answer: AnswerBlock, context: EvaluationContext): EvaluatedAnswer {
  const hydrated = finalizeAnswerBlock(answer, {
    brandName: context.brandName,
    brandDomains: context.brandDomains,
    competitors: context.competitors,
    sourceText: context.sourceText,
    expectedCity: context.expectedCity,
    analysisEntities: context.analysisEntities,
  })
  const flags = [...(hydrated.notes.flags ?? [])]
  const llmRank = findBrandEntityRank(hydrated, context)
  const linkRank = findBrandLinkRank(hydrated, context)
  const sov = computeSov(hydrated, context)
  const presence = computePresence(hydrated, context)

  return {
    presence,
    llmRank,
    linkRank,
    sov,
    flags
  }
}

/**
 * Score an answer using the GEO scoring formula
 * LLM_SERP_SCORE = 45% Position + 25% Link + 20% SOV + 10% Accuracy
 */
export function scoreAnswer(answer: AnswerBlock, context: EvaluationContext): ScoredAnswer {
  const evaluation = evaluateAnswer(answer, context)
  
  const breakdown: ScoreBreakdown = {
    position: computePositionComponent(evaluation.llmRank),
    link: computeLinkComponent(evaluation.linkRank),
    sov: computeSovComponent(evaluation.sov),
    accuracy: computeAccuracyComponent(evaluation.flags)
  }

  // Apply weights: 45% Position + 25% Link + 20% SOV + 10% Accuracy
  const score =
    breakdown.position * 0.45 +
    breakdown.link * 0.25 +
    breakdown.sov * 0.2 +
    breakdown.accuracy * 0.1

  return {
    ...evaluation,
    score,
    breakdown
  }
}

export function scoreCollapsedMetrics(input: {
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags?: string[]
}): { score: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    position: computePositionComponent(input.llmRank),
    link: computeLinkComponent(input.linkRank),
    sov: computeSovComponent(input.sov),
    accuracy: computeAccuracyComponent(input.flags ?? []),
  }
  const score =
    breakdown.position * 0.45 +
    breakdown.link * 0.25 +
    breakdown.sov * 0.2 +
    breakdown.accuracy * 0.1
  return { score, breakdown }
}

export function reconcileCitationFlags(flags: string[], citationCount: number): string[] {
  const next = flags.filter(flag => flag !== 'no_sources')
  if (citationCount <= 0) {
    next.push('no_sources')
  }
  return next
}

export function mergeSearchSourcesIntoAnswer(
  answer: AnswerBlock,
  searchSources: Array<{ url?: string; domain?: string; entity_ref?: string | null }> = []
): AnswerBlock {
  const citations = [...(answer.citations || [])]
  const existingUrls = new Set(citations.map(citation => citation.url).filter(Boolean))

  for (const source of searchSources) {
    const url = source.url
    if (!url || existingUrls.has(url)) continue
    citations.push({
      url,
      domain: source.domain || '',
      entity_ref: source.entity_ref || '',
    })
    existingUrls.add(url)
  }

  return {
    ...answer,
    citations,
    notes: {
      ...answer.notes,
      flags: reconcileCitationFlags(answer.notes?.flags || [], citations.length) as AnswerBlock['notes']['flags'],
    },
  }
}

/**
 * Aggregate scores across multiple answers
 */
export function aggregateScores(results: ScoredAnswer[]): AggregateScores {
  if (results.length === 0) {
    return { 
      overallScore: 0, 
      visibilityPct: 0,
      avgLlmRank: null,
      avgLinkRank: null,
      avgSov: null
    }
  }

  const totalScore = results.reduce((sum, result) => sum + result.score, 0)
  const visibilityCount = results.filter(result => result.presence).length

  // Calculate averages for non-null values
  const llmRanks = results.filter(r => r.llmRank !== null).map(r => r.llmRank as number)
  const linkRanks = results.filter(r => r.linkRank !== null).map(r => r.linkRank as number)
  const sovs = results.filter(r => r.sov !== null).map(r => r.sov as number)

  return {
    overallScore: totalScore / results.length,
    visibilityPct: (visibilityCount / results.length) * 100,
    avgLlmRank: llmRanks.length > 0 
      ? llmRanks.reduce((a, b) => a + b, 0) / llmRanks.length 
      : null,
    avgLinkRank: linkRanks.length > 0 
      ? linkRanks.reduce((a, b) => a + b, 0) / linkRanks.length 
      : null,
    avgSov: sovs.length > 0 
      ? sovs.reduce((a, b) => a + b, 0) / sovs.length 
      : null
  }
}

// ============================================================================
// Score Buckets
// ============================================================================

export type ScoreBucket = 'excellent' | 'good' | 'fair' | 'poor'

export function getScoreBucket(score: number): ScoreBucket {
  if (score >= 75) return 'excellent'
  if (score >= 50) return 'good'
  if (score >= 25) return 'fair'
  return 'poor'
}

export function getScoreColor(bucket: ScoreBucket): string {
  switch (bucket) {
    case 'excellent':
      return 'text-green-600'
    case 'good':
      return 'text-blue-600'
    case 'fair':
      return 'text-yellow-600'
    case 'poor':
      return 'text-red-600'
  }
}

export function getScoreBgColor(bucket: ScoreBucket): string {
  switch (bucket) {
    case 'excellent':
      return 'bg-green-100'
    case 'good':
      return 'bg-blue-100'
    case 'fair':
      return 'bg-yellow-100'
    case 'poor':
      return 'bg-red-100'
  }
}

