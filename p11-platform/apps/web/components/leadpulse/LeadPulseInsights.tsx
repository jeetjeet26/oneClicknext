'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart3,
  TrendingUp,
  Flame,
  Sun,
  CloudSnow,
  XCircle,
  RefreshCw,
  Sparkles,
  Target,
  Activity,
} from 'lucide-react'

interface ScoreDistribution {
  bucket: string
  count: number
  percentage: number
  avgScore: number
}

interface ScoreInsights {
  totalLeads: number
  scoredLeads: number
  avgScore: number
  distribution: ScoreDistribution[]
  topFactors: {
    positive: { factor: string; count: number }[]
    negative: { factor: string; count: number }[]
  }
  recentTrend: {
    date: string
    avgScore: number
    hotLeads: number
  }[]
}

interface LeadPulseInsightsProps {
  propertyId?: string | null
}

const BUCKET_CONFIG = {
  hot: {
    icon: Flame,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    barColor: 'bg-gradient-to-r from-orange-400 to-red-500',
  },
  warm: {
    icon: Sun,
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    barColor: 'bg-gradient-to-r from-amber-400 to-yellow-500',
  },
  cold: {
    icon: CloudSnow,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    barColor: 'bg-gradient-to-r from-blue-400 to-cyan-500',
  },
  unqualified: {
    icon: XCircle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    barColor: 'bg-gray-400',
  },
}

export function LeadPulseInsights({ propertyId }: LeadPulseInsightsProps) {
  const [insights, setInsights] = useState<ScoreInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pending = useRef<AbortController | null>(null)
  const fetchInsights = useCallback(async () => {
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (propertyId) params.set('propertyId', propertyId)
      params.set('days', '30')

      const res = await fetch(`/api/leadpulse/insights?${params}`, {signal:controller.signal})
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to fetch insights')

      if (!controller.signal.aborted) setInsights(data.insights)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('Error fetching insights:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    void fetchInsights()
    return () => pending.current?.abort()
  }, [fetchInsights])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center justify-center">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="ml-2 text-gray-500">Loading insights...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 p-6">
        <p className="text-red-500 text-center">{error}</p>
        <button
          onClick={fetchInsights}
          className="mx-auto mt-4 flex items-center gap-2 text-sm text-indigo-600 hover:underline"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  if (!insights || insights.totalLeads === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
        <Sparkles className="w-12 h-12 mx-auto text-indigo-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No Leads Yet</h3>
        <p className="text-gray-500 mt-2">Start capturing leads to see scoring insights!</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Total Leads"
          value={insights.totalLeads}
          icon={Target}
          color="indigo"
        />
        <MetricCard
          title="Scored Leads"
          value={insights.scoredLeads}
          subtitle={`${Math.round((insights.scoredLeads / insights.totalLeads) * 100)}% scored`}
          icon={Activity}
          color="purple"
        />
        <MetricCard
          title="Average Score"
          value={insights.avgScore}
          subtitle="out of 100"
          icon={BarChart3}
          color="blue"
        />
        <MetricCard
          title="Hot Leads"
          value={insights.distribution.find(d => d.bucket === 'hot')?.count || 0}
          subtitle={`${insights.distribution.find(d => d.bucket === 'hot')?.percentage || 0}% of total`}
          icon={Flame}
          color="orange"
        />
      </div>

      {/* Distribution Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
          Score Distribution
        </h3>
        <div className="space-y-4">
          {insights.distribution.map((dist) => {
            const config = BUCKET_CONFIG[dist.bucket as keyof typeof BUCKET_CONFIG]
            const Icon = config.icon
            return (
              <div key={dist.bucket} className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${config.bgColor}`}>
                  <Icon className={`w-5 h-5 ${config.color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {dist.bucket}
                    </span>
                    <span className="text-sm text-gray-500">
                      {dist.count} leads ({dist.percentage}%)
                    </span>
                  </div>
                  <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${config.barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${dist.percentage}%` }}
                    />
                  </div>
                </div>
                <div className="w-16 text-right">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    Avg: {dist.avgScore}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top Factors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Positive Factors */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Top Score Boosters
          </h3>
          {insights.topFactors.positive.length === 0 ? (
            <p className="text-gray-500 text-sm">No positive factors yet</p>
          ) : (
            <ul className="space-y-3">
              {insights.topFactors.positive.map((factor, idx) => (
                <li key={idx} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {factor.factor}
                  </span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                    {factor.count} leads
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Negative Factors */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 rotate-180" />
            Score Reducers
          </h3>
          {insights.topFactors.negative.length === 0 ? (
            <p className="text-gray-500 text-sm">No negative factors recorded</p>
          ) : (
            <ul className="space-y-3">
              {insights.topFactors.negative.map((factor, idx) => (
                <li key={idx} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {factor.factor}
                  </span>
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                    {factor.count} leads
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Trend Chart */}
      {insights.recentTrend.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
            Saved score trend (last 14 days)
          </h3>
          <div className="h-40">
            <p className="mb-3 text-xs text-gray-500">One saved score per lead per UTC day. Only leads scored that day are included; this is not a conversion trend.</p>
            <SimpleTrendChart data={insights.recentTrend} />
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string
  value: number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  color: 'indigo' | 'purple' | 'blue' | 'orange'
}) {
  const colors = {
    indigo: 'text-indigo-600 bg-indigo-50',
    purple: 'text-purple-600 bg-purple-50',
    blue: 'text-blue-600 bg-blue-50',
    orange: 'text-orange-600 bg-orange-50',
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className={`w-5 h-5`} />
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SimpleTrendChart({ data }: { data: { date: string; avgScore: number; hotLeads: number }[] }) {
  if (data.length === 0) return null

  const maxScore = Math.max(...data.map(d => d.avgScore), 100)
  const height = 140

  return (
    <div className="flex items-end justify-between h-full gap-1">
      {data.map((point, idx) => {
        const barHeight = (point.avgScore / maxScore) * height
        return (
          <div key={idx} className="flex-1 flex flex-col items-center">
            <div
              className="w-full bg-gradient-to-t from-indigo-500 to-indigo-400 rounded-t transition-all duration-300 hover:from-indigo-600"
              style={{ height: `${barHeight}px` }}
              title={`${point.date}: Score ${point.avgScore}, ${point.hotLeads} hot leads`}
            />
            {idx % 2 === 0 && (
              <span className="text-[10px] text-gray-500 mt-1">
                {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default LeadPulseInsights



























