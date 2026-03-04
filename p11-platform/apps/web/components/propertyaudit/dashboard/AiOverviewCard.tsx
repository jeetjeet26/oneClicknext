'use client'

import { Eye, EyeOff, TrendingUp, Info } from 'lucide-react'

interface AiOverviewSummary {
  totalTracked: number
  visibleCount: number
  visibilityPct: number
  byType: Array<{ type: string; visiblePct: number }>
}

interface AiOverviewCardProps {
  summary: AiOverviewSummary | null
  isLoading?: boolean
}

const TYPE_LABELS: Record<string, string> = {
  branded: 'Branded',
  category: 'Category',
  comparison: 'Comparison',
  local: 'Local',
  faq: 'FAQ',
  voice_search: 'Voice Search',
}

export function AiOverviewCard({ summary, isLoading }: AiOverviewCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    )
  }

  if (!summary || summary.totalTracked === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            AI Overview Visibility
          </h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No AI Overview data yet. Run an audit to start tracking.
        </p>
      </div>
    )
  }

  const getVisibilityColor = (pct: number) => {
    if (pct >= 70) return 'text-green-600 dark:text-green-400'
    if (pct >= 40) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getBarColor = (pct: number) => {
    if (pct >= 70) return 'bg-green-500'
    if (pct >= 40) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            AI Overview Visibility
          </h3>
        </div>
        <div className="group relative">
          <Info className="w-4 h-4 text-gray-400 cursor-help" />
          <div className="absolute right-0 top-6 hidden group-hover:block z-10 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg">
            AI Overviews are the featured snippets shown at the top of AI-powered search results. 
            Higher visibility means your property appears in more AI Overview answers.
          </div>
        </div>
      </div>

      {/* Main Stats */}
      <div className="flex items-center gap-6 mb-6">
        <div className="text-center">
          <div className={`text-3xl font-bold ${getVisibilityColor(summary.visibilityPct)}`}>
            {summary.visibilityPct}%
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Overall Visibility
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600 dark:text-gray-400">
              <Eye className="w-3 h-3 inline mr-1" />
              {summary.visibleCount} visible
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              <EyeOff className="w-3 h-3 inline mr-1" />
              {summary.totalTracked - summary.visibleCount} hidden
            </span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full ${getBarColor(summary.visibilityPct)} transition-all duration-500`}
              style={{ width: `${summary.visibilityPct}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {summary.totalTracked} queries tracked
          </div>
        </div>
      </div>

      {/* Breakdown by Type */}
      {summary.byType.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
            By Query Type
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {summary.byType.map((item) => (
              <div 
                key={item.type}
                className="flex items-center justify-between px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded"
              >
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {TYPE_LABELS[item.type] || item.type}
                </span>
                <span className={`text-xs font-medium ${getVisibilityColor(item.visiblePct)}`}>
                  {item.visiblePct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
