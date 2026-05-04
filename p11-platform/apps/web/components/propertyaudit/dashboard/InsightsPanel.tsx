'use client'

import { Lightbulb, ArrowRight, Download, Calendar } from 'lucide-react'
import { getSurfaceLabel } from '@/utils/propertyaudit/types'

export interface GeoInsight {
  id: string
  icon: string
  text: string
  priority: 'high' | 'medium' | 'low'
}

interface InsightsPanelProps {
  insights: GeoInsight[]
  onViewFullAnalysis?: () => void
  onExportReport?: () => void
  onScheduleReview?: () => void
}

export function InsightsPanel({ 
  insights, 
  onViewFullAnalysis,
  onExportReport,
  onScheduleReview
}: InsightsPanelProps) {
  if (insights.length === 0) {
    return null
  }

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 p-6">
      <div className="flex items-start gap-3 mb-4">
        <Lightbulb className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Key Insights This Period
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Auto-generated analysis of your GEO performance
          </p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {insights.map((insight, idx) => (
          <div
            key={insight.id}
            className="flex items-start gap-2 text-sm"
          >
            <span className="flex-shrink-0 mt-0.5 text-lg">
              {insight.icon}
            </span>
            <span className="text-gray-700 dark:text-gray-300">
              {insight.text}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-indigo-200 dark:border-indigo-800">
        {onViewFullAnalysis && (
          <button
            onClick={onViewFullAnalysis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            View Full Analysis
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        
        {onExportReport && (
          <button
            onClick={onExportReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <Download className="w-3 h-3" />
            Export Report
          </button>
        )}

        {onScheduleReview && (
          <button
            onClick={onScheduleReview}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <Calendar className="w-3 h-3" />
            Schedule Review
          </button>
        )}
      </div>
    </div>
  )
}

// Hook to generate insights from GEO data
export function useGeoInsights(score: any, queries: any[], runs: any[]): GeoInsight[] {
  const insights: GeoInsight[] = []

  if (!score) return insights

  // Insight 1: Overall performance assessment
  if (score.visibilityPct === 100) {
    insights.push({
      id: 'perfect-visibility',
      icon: '✓',
      text: `Perfect performance on ${queries.length} queries (100% visibility)`,
      priority: 'high',
    })
  } else if (score.visibilityPct >= 70) {
    insights.push({
      id: 'good-visibility',
      icon: '📊',
      text: `Strong visibility at ${Math.round(score.visibilityPct)}% across ${queries.length} queries`,
      priority: 'medium',
    })
  } else {
    insights.push({
      id: 'low-visibility',
      icon: '⚠️',
      text: `Visibility at ${Math.round(score.visibilityPct)}% - below 70% target`,
      priority: 'high',
    })
  }

  // Insight 2: Trend analysis
  if (score.trend) {
    if (score.trend.direction === 'up' && score.trend.changePercent > 3) {
      insights.push({
        id: 'improving-trend',
        icon: '📈',
        text: `Score improved +${score.trend.changePercent.toFixed(1)}% vs last period`,
        priority: 'high',
      })
    } else if (score.trend.direction === 'down' && score.trend.changePercent < -3) {
      insights.push({
        id: 'declining-trend',
        icon: '⚠️',
        text: `Score declined ${score.trend.changePercent.toFixed(1)}% - investigate cause`,
        priority: 'high',
      })
    }
  }

  // Insight 3: Surface comparison
  const comparableSurfaces = Array.isArray(score.surfaceSummaries)
    ? score.surfaceSummaries
        .filter((summary: any) => typeof summary?.score === 'number')
        .slice(0, 2)
    : []

  if (comparableSurfaces.length >= 2) {
    const [firstSurface, secondSurface] = comparableSurfaces
    const diff = Math.abs(firstSurface.score - secondSurface.score)
    if (diff > 10) {
      const better = firstSurface.score > secondSurface.score ? firstSurface : secondSurface
      const worse = better === firstSurface ? secondSurface : firstSurface
      
      insights.push({
        id: 'model-imbalance',
        icon: '🎯',
        text: `${getSurfaceLabel(better.surface)} outperforming ${getSurfaceLabel(worse.surface)} by ${diff.toFixed(0)} points`,
        priority: 'medium',
      })
    }
  }

  // Insight 4: Rank performance
  if (score.breakdown) {
    const availableRanks = Object.values(score.surfaces || {})
      .map((surface: any) => surface?.avgLlmRank)
      .filter((rank: unknown): rank is number => typeof rank === 'number')
    const avgRank = availableRanks.length > 0
      ? availableRanks.reduce((sum, rank) => sum + rank, 0) / availableRanks.length
      : null

    if (avgRank === null) {
      // No rank data yet; skip rank-specific insight until completed answers exist.
    } else if (avgRank === 1) {
      insights.push({
        id: 'perfect-rank',
        icon: '⭐',
        text: 'Averaging rank #1 across all queries - exceptional!',
        priority: 'high',
      })
    } else if (avgRank <= 3) {
      insights.push({
        id: 'top-3-rank',
        icon: '🏆',
        text: `Averaging rank #${avgRank.toFixed(1)} - strong performance`,
        priority: 'medium',
      })
    }
  }

  // Insight 5: Quick wins available (if any queries rank 4-7)
  const nearMissQueries = queries.filter(q => q.llmRank && q.llmRank >= 4 && q.llmRank <= 7)
  if (nearMissQueries.length > 0) {
    insights.push({
      id: 'quick-wins',
      icon: '🔥',
      text: `${nearMissQueries.length} quick wins available (queries ranking #4-7)`,
      priority: 'medium',
    })
  }

  // Limit to top 5 insights
  return insights.slice(0, 5)
}
