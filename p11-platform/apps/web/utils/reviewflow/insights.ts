/**
 * ReviewFlow operational insights.
 *
 * Turns classified reviews and reputation cases into issue clusters with
 * trend/recurrence signals and recommendation-only interventions. Pure
 * aggregate computation over property-scoped evidence — it never identifies
 * reviewers and never executes anything.
 */

import { TAXONOMY_VERSION, type IssueDomain } from '@/utils/reviewflow/taxonomy'

export const INSIGHTS_VERSION = 'reviewflow-insights-v1'

export interface ReviewForInsights {
  id: string
  rating: number | null
  sentiment: string | null
  review_text: string | null
  review_date: string | null
  created_at: string
  is_urgent: boolean
}

export interface AnalysisForInsights {
  review_id: string
  issue_domains: unknown
  severity: string | null
  journey_stage: string | null
}

export interface CaseForInsights {
  id: string
  review_id: string | null
  status: string
  priority: string | null
  issue_domains: unknown
  reopened_count: number | null
  created_at: string
  resolved_at: string | null
}

export interface EvidenceCitation {
  reviewId: string
  snippet: string
  reviewDate: string | null
  rating: number | null
}

export interface Intervention {
  interventionType:
    | 'internal_followup'
    | 'knowledge_correction'
    | 'brandforge_claim_review'
    | 'siteforge_patch'
    | 'lumaleasing_process_change'
    | 'testimonial_opportunity'
  target: string
  suggestedOwnerRole: 'property_manager' | 'maintenance_lead' | 'leasing_manager' | 'marketing'
  rationale: string
  measurement: {
    kpi: string
    windowDays: number
  }
}

export interface IssueCluster {
  issueDomain: IssueDomain | 'other'
  reviewCount: number
  negativeCount: number
  urgentCount: number
  avgRating: number | null
  openCases: number
  reopenedCases: number
  trend: 'worsening' | 'improving' | 'stable' | 'insufficient_data'
  evidence: EvidenceCitation[]
  recommendation: Intervention | null
}

export interface InsightsResult {
  insightsVersion: string
  taxonomyVersion: string
  windowDays: number
  totalReviews: number
  classifiedReviews: number
  sourceCoverageNote: string
  clusters: IssueCluster[]
  attributionLimits: string
}

const INTERVENTION_MAP: Partial<Record<string, Omit<Intervention, 'rationale'>>> = {
  maintenance: {
    interventionType: 'internal_followup',
    target: 'Maintenance response process',
    suggestedOwnerRole: 'maintenance_lead',
    measurement: { kpi: 'maintenance complaint recurrence', windowDays: 30 },
  },
  management_staff: {
    interventionType: 'lumaleasing_process_change',
    target: 'Office staff communication scripts and escalation process',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'staff-related negative review rate', windowDays: 60 },
  },
  communication: {
    interventionType: 'lumaleasing_process_change',
    target: 'Resident communication cadence and channels',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'communication complaint recurrence', windowDays: 60 },
  },
  leasing_experience: {
    interventionType: 'lumaleasing_process_change',
    target: 'Tour and application follow-up scripts',
    suggestedOwnerRole: 'leasing_manager',
    measurement: { kpi: 'touring-stage negative review rate', windowDays: 60 },
  },
  amenities: {
    interventionType: 'brandforge_claim_review',
    target: 'Marketing claims about amenities vs. observed condition',
    suggestedOwnerRole: 'marketing',
    measurement: { kpi: 'amenity complaint recurrence', windowDays: 60 },
  },
  value_pricing: {
    interventionType: 'brandforge_claim_review',
    target: 'Pricing/value positioning claims',
    suggestedOwnerRole: 'marketing',
    measurement: { kpi: 'value-related sentiment', windowDays: 90 },
  },
  billing_fees: {
    interventionType: 'knowledge_correction',
    target: 'Fee schedule transparency in KB and site content',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'billing complaint recurrence', windowDays: 60 },
  },
  deposits: {
    interventionType: 'knowledge_correction',
    target: 'Deposit policy documentation and move-out checklist',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'deposit dispute recurrence', windowDays: 90 },
  },
  parking: {
    interventionType: 'knowledge_correction',
    target: 'Parking policy documentation and enforcement process',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'parking complaint recurrence', windowDays: 60 },
  },
  noise: {
    interventionType: 'internal_followup',
    target: 'Quiet-hours enforcement and noise complaint handling',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'noise complaint recurrence', windowDays: 60 },
  },
  pests: {
    interventionType: 'internal_followup',
    target: 'Pest control vendor cadence and unit inspections',
    suggestedOwnerRole: 'maintenance_lead',
    measurement: { kpi: 'pest complaint recurrence', windowDays: 30 },
  },
  habitability: {
    interventionType: 'internal_followup',
    target: 'Habitability remediation (highest priority)',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'habitability case reopen rate', windowDays: 30 },
  },
  cleanliness: {
    interventionType: 'internal_followup',
    target: 'Common-area cleaning schedule',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'cleanliness complaint recurrence', windowDays: 30 },
  },
  safety_security: {
    interventionType: 'internal_followup',
    target: 'Security measures and incident communication',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'safety complaint recurrence', windowDays: 30 },
  },
  pet_policy: {
    interventionType: 'knowledge_correction',
    target: 'Pet policy documentation',
    suggestedOwnerRole: 'leasing_manager',
    measurement: { kpi: 'pet policy complaint recurrence', windowDays: 90 },
  },
  neighbors_community: {
    interventionType: 'internal_followup',
    target: 'Community standards enforcement',
    suggestedOwnerRole: 'property_manager',
    measurement: { kpi: 'community complaint recurrence', windowDays: 90 },
  },
  praise_general: {
    interventionType: 'testimonial_opportunity',
    target: 'Positive review themes for SiteForge/BrandForge content',
    suggestedOwnerRole: 'marketing',
    measurement: { kpi: 'response coverage on positive reviews', windowDays: 30 },
  },
}

function normalizeIssueDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function computeIssueClusters(input: {
  reviews: ReviewForInsights[]
  analyses: AnalysisForInsights[]
  cases: CaseForInsights[]
  windowDays: number
  now?: Date
}): InsightsResult {
  const now = input.now ?? new Date()
  const windowStart = new Date(now.getTime() - input.windowDays * 24 * 60 * 60 * 1000)
  const midpoint = new Date((windowStart.getTime() + now.getTime()) / 2)

  const analysisByReview = new Map<string, AnalysisForInsights>()
  for (const analysis of input.analyses) {
    analysisByReview.set(analysis.review_id, analysis)
  }

  type ClusterAccumulator = {
    reviews: ReviewForInsights[]
    recentCount: number
    earlierCount: number
    openCases: number
    reopenedCases: number
  }
  const accumulators = new Map<string, ClusterAccumulator>()

  const clusterFor = (domain: string): ClusterAccumulator => {
    let acc = accumulators.get(domain)
    if (!acc) {
      acc = { reviews: [], recentCount: 0, earlierCount: 0, openCases: 0, reopenedCases: 0 }
      accumulators.set(domain, acc)
    }
    return acc
  }

  let classifiedReviews = 0
  for (const review of input.reviews) {
    const analysis = analysisByReview.get(review.id)
    const domains = normalizeIssueDomains(analysis?.issue_domains)
    if (domains.length === 0) continue
    classifiedReviews += 1

    const observedAt = new Date(review.review_date || review.created_at)
    for (const domain of domains) {
      const acc = clusterFor(domain)
      acc.reviews.push(review)
      if (observedAt >= midpoint) acc.recentCount += 1
      else acc.earlierCount += 1
    }
  }

  const openCaseStatuses = new Set(['open', 'triaged', 'awaiting_approval', 'ready_to_post', 'remediation'])
  for (const caseRow of input.cases) {
    const domains = normalizeIssueDomains(caseRow.issue_domains)
    for (const domain of domains) {
      const acc = clusterFor(domain)
      if (openCaseStatuses.has(caseRow.status)) acc.openCases += 1
      if ((caseRow.reopened_count ?? 0) > 0) acc.reopenedCases += 1
    }
  }

  const clusters: IssueCluster[] = []
  for (const [domain, acc] of accumulators) {
    if (acc.reviews.length === 0 && acc.openCases === 0) continue

    const negative = acc.reviews.filter((r) => r.sentiment === 'negative')
    const rated = acc.reviews.filter((r) => typeof r.rating === 'number')
    const avgRating =
      rated.length > 0
        ? Math.round((rated.reduce((sum, r) => sum + (r.rating as number), 0) / rated.length) * 10) / 10
        : null

    let trend: IssueCluster['trend'] = 'insufficient_data'
    if (acc.recentCount + acc.earlierCount >= 3) {
      if (acc.recentCount > acc.earlierCount) trend = 'worsening'
      else if (acc.recentCount < acc.earlierCount) trend = 'improving'
      else trend = 'stable'
    }

    // Evidence: freshest negative reviews first, capped.
    const evidenceSource = (negative.length > 0 ? negative : acc.reviews)
      .slice()
      .sort((a, b) =>
        (b.review_date || b.created_at).localeCompare(a.review_date || a.created_at)
      )
      .slice(0, 3)
    const evidence: EvidenceCitation[] = evidenceSource.map((review) => ({
      reviewId: review.id,
      snippet: (review.review_text || '').slice(0, 180),
      reviewDate: review.review_date,
      rating: review.rating,
    }))

    // Recommend only when the cluster shows a real signal: repeated negative
    // feedback, urgency, recurrence, or (for praise) enough volume to reuse.
    const isPraise = domain === 'praise_general'
    const hasSignal = isPraise
      ? acc.reviews.length >= 3
      : negative.length >= 2 ||
        acc.reviews.some((r) => r.is_urgent) ||
        acc.reopenedCases > 0

    let recommendation: Intervention | null = null
    const mapped = INTERVENTION_MAP[domain]
    if (hasSignal && mapped) {
      recommendation = {
        ...mapped,
        rationale: isPraise
          ? `${acc.reviews.length} positive reviews cite this theme in the last ${input.windowDays} days.`
          : `${negative.length} negative review(s), ${acc.openCases} open case(s), ` +
            `${acc.reopenedCases} reopened case(s) in the last ${input.windowDays} days; trend ${trend}.`,
      }
    }

    clusters.push({
      issueDomain: domain as IssueCluster['issueDomain'],
      reviewCount: acc.reviews.length,
      negativeCount: negative.length,
      urgentCount: acc.reviews.filter((r) => r.is_urgent).length,
      avgRating,
      openCases: acc.openCases,
      reopenedCases: acc.reopenedCases,
      trend,
      evidence,
      recommendation,
    })
  }

  // Most actionable first: recommended clusters, then by negative volume.
  clusters.sort((a, b) => {
    if (!!b.recommendation !== !!a.recommendation) return b.recommendation ? 1 : -1
    return b.negativeCount - a.negativeCount
  })

  return {
    insightsVersion: INSIGHTS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    windowDays: input.windowDays,
    totalReviews: input.reviews.length,
    classifiedReviews,
    sourceCoverageNote:
      classifiedReviews < input.reviews.length
        ? `${input.reviews.length - classifiedReviews} review(s) are not yet classified; clusters may undercount.`
        : 'All reviews in the window are classified.',
    clusters,
    attributionLimits:
      'Clusters are aggregate public-review evidence only. Reviewers are never matched to ' +
      'residents or leads, and recommendations are advisory — every intervention needs a named ' +
      'owner and its measurement window tracks correlation, not proven causation.',
  }
}
