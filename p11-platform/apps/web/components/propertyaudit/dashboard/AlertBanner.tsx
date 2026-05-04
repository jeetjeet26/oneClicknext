'use client'

import { AlertTriangle, TrendingDown, Trophy, X } from 'lucide-react'
import { useState } from 'react'
import { getSurfaceLabel } from '@/utils/propertyaudit/types'

export type AlertType = 'critical' | 'warning' | 'success' | 'competitive'

export interface Alert {
  id: string
  type: AlertType
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface AlertBannerProps {
  alerts: Alert[]
  onDismiss?: (alertId: string) => void
}

export function AlertBanner({ alerts, onDismiss }: AlertBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const handleDismiss = (alertId: string) => {
    setDismissedIds(prev => new Set(prev).add(alertId))
    onDismiss?.(alertId)
  }

  const visibleAlerts = alerts.filter(alert => !dismissedIds.has(alert.id))

  if (visibleAlerts.length === 0) return null

  return (
    <div className="space-y-3">
      {visibleAlerts.map(alert => {
        const styles = getAlertStyles(alert.type)
        const Icon = getAlertIcon(alert.type)

        return (
          <div
            key={alert.id}
            className={`rounded-lg border p-4 ${styles.container}`}
          >
            <div className="flex items-start gap-3">
              <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${styles.icon}`} />
              
              <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-semibold ${styles.title}`}>
                  {alert.title}
                </h3>
                <p className={`text-sm mt-1 ${styles.message}`}>
                  {alert.message}
                </p>
                
                {alert.actionLabel && alert.onAction && (
                  <button
                    onClick={alert.onAction}
                    className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${styles.button}`}
                  >
                    {alert.actionLabel} →
                  </button>
                )}
              </div>

              {onDismiss && (
                <button
                  onClick={() => handleDismiss(alert.id)}
                  className={`p-1 rounded hover:bg-white/50 dark:hover:bg-black/20 transition-colors ${styles.closeButton}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getAlertStyles(type: AlertType) {
  switch (type) {
    case 'critical':
      return {
        container: 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800',
        icon: 'text-red-600 dark:text-red-400',
        title: 'text-red-900 dark:text-red-100',
        message: 'text-red-800 dark:text-red-200',
        button: 'bg-red-600 text-white hover:bg-red-700',
        closeButton: 'text-red-600 dark:text-red-400',
      }
    case 'warning':
      return {
        container: 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800',
        icon: 'text-amber-600 dark:text-amber-400',
        title: 'text-amber-900 dark:text-amber-100',
        message: 'text-amber-800 dark:text-amber-200',
        button: 'bg-amber-600 text-white hover:bg-amber-700',
        closeButton: 'text-amber-600 dark:text-amber-400',
      }
    case 'success':
      return {
        container: 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800',
        icon: 'text-green-600 dark:text-green-400',
        title: 'text-green-900 dark:text-green-100',
        message: 'text-green-800 dark:text-green-200',
        button: 'bg-green-600 text-white hover:bg-green-700',
        closeButton: 'text-green-600 dark:text-green-400',
      }
    case 'competitive':
      return {
        container: 'bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-800',
        icon: 'text-purple-600 dark:text-purple-400',
        title: 'text-purple-900 dark:text-purple-100',
        message: 'text-purple-800 dark:text-purple-200',
        button: 'bg-purple-600 text-white hover:bg-purple-700',
        closeButton: 'text-purple-600 dark:text-purple-400',
      }
  }
}

function getAlertIcon(type: AlertType) {
  switch (type) {
    case 'critical':
    case 'warning':
      return AlertTriangle
    case 'success':
      return Trophy
    case 'competitive':
      return TrendingDown
  }
}

// Hook to generate alerts from GEO data
export function useGeoAlerts(score: any, runs: any[], competitors: any[]): Alert[] {
  const alerts: Alert[] = []

  if (!score) return alerts

  // Critical: Score declining significantly
  if (score.trend && score.trend.direction === 'down' && score.trend.changePercent < -10) {
    alerts.push({
      id: 'score-decline',
      type: 'critical',
      title: 'Significant Score Decline',
      message: `Your GEO score dropped ${Math.abs(score.trend.changePercent).toFixed(1)}% this period. Immediate action recommended.`,
      actionLabel: 'View Recommendations',
    })
  }

  // Warning: Low visibility
  if (score.visibilityPct < 50) {
    alerts.push({
      id: 'low-visibility',
      type: 'warning',
      title: 'Low Visibility Detected',
      message: `Only ${Math.round(score.visibilityPct)}% of queries show your property. Target is 70%+.`,
      actionLabel: 'View Missing Queries',
    })
  }

  // Warning: Surface imbalance
  const comparableSurfaces = Array.isArray(score.surfaceSummaries)
    ? score.surfaceSummaries
        .filter((summary: any) => typeof summary?.score === 'number')
        .slice(0, 2)
    : []

  if (comparableSurfaces.length >= 2) {
    const [firstSurface, secondSurface] = comparableSurfaces
    const diff = Math.abs(firstSurface.score - secondSurface.score)
    if (diff > 15) {
      const better = firstSurface.score > secondSurface.score ? firstSurface : secondSurface
      const worse = better === firstSurface ? secondSurface : firstSurface
      
      alerts.push({
        id: 'model-imbalance',
        type: 'warning',
        title: 'Surface Performance Imbalance',
        message: `${getSurfaceLabel(better.surface)} is outperforming ${getSurfaceLabel(worse.surface)} by ${diff.toFixed(0)} points. Balance your optimization efforts.`,
        actionLabel: 'View Surface Comparison',
      })
    }
  }

  // Success: Perfect performance
  if (score.visibilityPct === 100 && score.overallScore >= 75) {
    alerts.push({
      id: 'perfect-performance',
      type: 'success',
      title: 'Excellent GEO Performance!',
      message: `You're ranking on all ${runs[0]?.queryCount || 'tracked'} queries with an overall score of ${Math.round(score.overallScore)}. Keep it up!`,
      actionLabel: 'View Strategy',
    })
  }

  // Competitive: Competitor activity
  if (competitors && competitors.length > 0) {
    const topCompetitor = competitors[0]
    if (topCompetitor.mentionCount > 15) {
      alerts.push({
        id: 'competitor-active',
        type: 'competitive',
        title: 'High Competitor Activity',
        message: `${topCompetitor.name} is mentioned in ${topCompetitor.mentionCount} queries. Monitor their strategy closely.`,
        actionLabel: 'View Competitive Analysis',
      })
    }
  }

  return alerts
}
