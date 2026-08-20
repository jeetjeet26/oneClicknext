'use client'

import { useState } from 'react'
import { Eye, EyeOff, AlertCircle, CheckCircle2, ExternalLink, Copy, Plus } from 'lucide-react'
import { ScoreRing } from '../score'

interface QueryCard {
  id: string
  text: string
  type: string
  presence: boolean
  llmRank: number | null
  sov: number | null
  score: number
  modelBreakdown?: {
    surfaces?: Partial<Record<string, { presence: boolean; rank: number | null }>>
  }
  trend?: 'up' | 'down' | 'stable'
}

interface QueryPerformanceCardsProps {
  queries: QueryCard[]
  onViewAnswer?: (queryId: string) => void
  onOptimizeQuery?: (queryId: string) => void
  onAddSimilar?: (queryText: string) => void
}

export function QueryPerformanceCards({ 
  queries, 
  onViewAnswer, 
  onOptimizeQuery,
  onAddSimilar 
}: QueryPerformanceCardsProps) {
  const [filter, setFilter] = useState<'all' | 'present' | 'absent'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'rank' | 'impact'>('impact')

  const filteredQueries = queries.filter(q => {
    if (filter === 'present') return q.presence
    if (filter === 'absent') return !q.presence
    return true
  })

  const sortedQueries = [...filteredQueries].sort((a, b) => {
    switch (sortBy) {
      case 'score':
        return (b.score || 0) - (a.score || 0)
      case 'rank':
        if (!a.llmRank) return 1
        if (!b.llmRank) return -1
        return a.llmRank - b.llmRank
      case 'impact':
      default:
        // Sort by: presence (yes first), then by rank (lower better)
        if (a.presence !== b.presence) return a.presence ? -1 : 1
        if (!a.llmRank) return 1
        if (!b.llmRank) return -1
        return a.llmRank - b.llmRank
    }
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Show:</span>
          {(['all', 'present', 'absent'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Sort by:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
          >
            <option value="impact">Impact</option>
            <option value="score">Score</option>
            <option value="rank">Rank</option>
          </select>
        </div>

        <span className="ml-auto text-sm text-gray-500">
          Showing {sortedQueries.length} of {queries.length} queries
        </span>
      </div>

      {/* Query Cards */}
      <div className="grid grid-cols-1 gap-4">
        {sortedQueries.map(query => (
          <QueryPerformanceCard
            key={query.id}
            query={query}
            onViewAnswer={onViewAnswer}
            onOptimizeQuery={onOptimizeQuery}
            onAddSimilar={onAddSimilar}
          />
        ))}
      </div>

      {sortedQueries.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No queries match the selected filter.
        </div>
      )}
    </div>
  )
}

function QueryPerformanceCard({ 
  query, 
  onViewAnswer, 
  onOptimizeQuery,
  onAddSimilar 
}: {
  query: QueryCard
  onViewAnswer?: (queryId: string) => void
  onOptimizeQuery?: (queryId: string) => void
  onAddSimilar?: (queryText: string) => void
}) {
  const hasIssue = !query.presence || (query.llmRank && query.llmRank > 3)
  const surfaceEntries = Object.entries(query.modelBreakdown?.surfaces || {}).filter(([, perf]) => perf)
  const showModelBreakdown = surfaceEntries.length > 1 && surfaceEntries.some(([, perf], _index, all) => {
    const first = all[0]?.[1]
    return first && perf && (first.presence !== perf.presence || first.rank !== perf.rank)
  })

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition-all hover:shadow-md ${
      hasIssue 
        ? 'border-amber-200 dark:border-amber-900'
        : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start gap-4">
        {/* Score Ring */}
        <div className="flex-shrink-0">
          <ScoreRing score={query.score || 0} size={60} />
        </div>

        {/* Query Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1">
              <h4 className="font-medium text-gray-900 dark:text-white mb-1">
                {query.text}
              </h4>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300">
                  {query.type}
                </span>
              </div>
            </div>
          </div>

          {/* Model Performance */}
          <div className="flex items-center gap-6 text-sm mb-3">
            <div className="flex items-center gap-2">
              {query.presence ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <EyeOff className="w-4 h-4 text-gray-400" />
              )}
              <span className={query.presence ? 'text-green-600 font-medium' : 'text-gray-500'}>
                {query.presence ? 'Present' : 'Absent'}
              </span>
            </div>

            {query.llmRank && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Rank:</span>
                <span className={`font-medium ${query.llmRank <= 3 ? 'text-green-600' : 'text-amber-600'}`}>
                  #{query.llmRank}
                </span>
              </div>
            )}

            {query.sov !== null && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">SOV:</span>
                <span className="font-medium">{(query.sov * 100).toFixed(0)}%</span>
              </div>
            )}

            {query.trend && (
              <div className="ml-auto">
                {query.trend === 'up' && <span className="text-green-500">↗️</span>}
                {query.trend === 'down' && <span className="text-red-500">↘️</span>}
                {query.trend === 'stable' && <span className="text-gray-400">→</span>}
              </div>
            )}
          </div>

          {/* Model Breakdown */}
          {showModelBreakdown && (
            <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-900">
              <div className="grid grid-cols-2 gap-4 text-xs">
                {surfaceEntries.map(([surface, perf]) => (
                  <div key={surface}>
                    <span className="font-medium text-blue-800 dark:text-blue-200">{surface}:</span>{' '}
                    {perf?.presence ? (
                      <span className="text-green-600">
                        ✓ Rank #{perf.rank}
                      </span>
                    ) : (
                      <span className="text-red-600">✗ Absent</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issue Alert */}
          {hasIssue && (
            <div className="mb-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                {!query.presence 
                  ? 'Property not mentioned - optimization needed'
                  : `Ranking #${query.llmRank} - could improve to top 3`
                }
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onViewAnswer && (
              <button
                onClick={() => onViewAnswer(query.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Eye className="w-3 h-3" />
                View Answer
              </button>
            )}
            
            {hasIssue && onOptimizeQuery && (
              <button
                onClick={() => onOptimizeQuery(query.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <ExternalLink className="w-3 h-3" />
                Optimize Query
              </button>
            )}

            {onAddSimilar && (
              <button
                onClick={() => onAddSimilar(query.text)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Plus className="w-3 h-3" />
                Add Similar
              </button>
            )}

            <button
              onClick={() => navigator.clipboard.writeText(query.text)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 ml-auto"
              title="Copy query text"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
