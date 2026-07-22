'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Lightbulb,
  RefreshCw,
  AlertCircle,
} from 'lucide-react'

/**
 * Operational insights: aggregate issue clusters with trend/recurrence
 * signals and recommendation-only interventions. Everything shown here is
 * advisory — nothing executes without an operator acting elsewhere.
 */

interface EvidenceCitation {
  reviewId: string
  snippet: string
  reviewDate: string | null
  rating: number | null
}

interface Intervention {
  interventionType: string
  target: string
  suggestedOwnerRole: string
  rationale: string
  measurement: { kpi: string; windowDays: number }
}

interface IssueCluster {
  issueDomain: string
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

interface InsightsData {
  windowDays: number
  totalReviews: number
  classifiedReviews: number
  sourceCoverageNote: string
  clusters: IssueCluster[]
  attributionLimits: string
}

const INTERVENTION_LABELS: Record<string, string> = {
  internal_followup: 'Internal follow-up',
  knowledge_correction: 'Knowledge correction',
  brandforge_claim_review: 'BrandForge claim review',
  siteforge_patch: 'SiteForge content patch',
  lumaleasing_process_change: 'Leasing process change',
  testimonial_opportunity: 'Testimonial opportunity',
}

const OWNER_LABELS: Record<string, string> = {
  property_manager: 'Property manager',
  maintenance_lead: 'Maintenance lead',
  leasing_manager: 'Leasing manager',
  marketing: 'Marketing',
}

function formatDomain(domain: string): string {
  return domain.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function TrendBadge({ trend }: { trend: IssueCluster['trend'] }) {
  if (trend === 'worsening') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
        <TrendingUp className="w-3.5 h-3.5" /> Worsening
      </span>
    )
  }
  if (trend === 'improving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <TrendingDown className="w-3.5 h-3.5" /> Improving
      </span>
    )
  }
  if (trend === 'stable') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <Minus className="w-3.5 h-3.5" /> Stable
      </span>
    )
  }
  return <span className="text-xs text-slate-400">Not enough data</span>
}

export function InsightsPanel({ propertyId, refreshKey }: { propertyId: string; refreshKey?: number }) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(90)

  const fetchInsights = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/reviewflow/insights?propertyId=${propertyId}&days=${windowDays}`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load insights')
      }
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }, [propertyId, windowDays])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights, refreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
        <button
          onClick={fetchInsights}
          className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-300 hover:underline"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {data.classifiedReviews} of {data.totalReviews} reviews classified in the last{' '}
          {data.windowDays} days. {data.sourceCoverageNote}
        </p>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
        </select>
      </div>

      {data.clusters.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500">
          No classified issue clusters in this window yet. Sync or import reviews and run
          analysis to populate insights.
        </div>
      ) : (
        <div className="space-y-3">
          {data.clusters.map((cluster) => (
            <div
              key={cluster.issueDomain}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatDomain(cluster.issueDomain)}
                  </span>
                  <TrendBadge trend={cluster.trend} />
                </div>
                <div className="text-xs text-slate-500">
                  {cluster.reviewCount} review{cluster.reviewCount === 1 ? '' : 's'}
                  {cluster.negativeCount > 0 && ` · ${cluster.negativeCount} negative`}
                  {cluster.openCases > 0 && ` · ${cluster.openCases} open case${cluster.openCases === 1 ? '' : 's'}`}
                  {cluster.reopenedCases > 0 && ` · ${cluster.reopenedCases} reopened`}
                  {cluster.avgRating !== null && ` · avg ${cluster.avgRating}★`}
                </div>
              </div>

              {cluster.recommendation && (
                <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/40 p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Lightbulb className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                      {INTERVENTION_LABELS[cluster.recommendation.interventionType] ||
                        cluster.recommendation.interventionType}
                      {': '}
                      {cluster.recommendation.target}
                    </span>
                  </div>
                  <p className="text-xs text-indigo-800 dark:text-indigo-300 ml-6">
                    {cluster.recommendation.rationale} Suggested owner:{' '}
                    {OWNER_LABELS[cluster.recommendation.suggestedOwnerRole] ||
                      cluster.recommendation.suggestedOwnerRole}
                    . Measure {cluster.recommendation.measurement.kpi} over the next{' '}
                    {cluster.recommendation.measurement.windowDays} days.
                  </p>
                </div>
              )}

              {cluster.evidence.length > 0 && (
                <ul className="space-y-1">
                  {cluster.evidence.map((item) => (
                    <li key={item.reviewId} className="text-xs text-slate-500 truncate">
                      {item.rating !== null && <span className="mr-1">{item.rating}★</span>}
                      “{item.snippet}”
                      {item.reviewDate && (
                        <span className="ml-1 text-slate-400">
                          — {new Date(item.reviewDate).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">{data.attributionLimits}</p>
    </div>
  )
}
