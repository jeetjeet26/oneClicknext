'use client'

import { useEffect, useState } from 'react'
import {
  Lightbulb,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Copy,
  CheckCircle2,
  Download,
  Filter,
  Sparkles,
} from 'lucide-react'
import type { ContentRecommendation, RecommendationSummary } from '@/utils/propertyaudit/recommendation-engine'

interface ContentRecommendationsProps {
  propertyId: string
  runId?: string
}

export function ContentRecommendations({ propertyId, runId }: ContentRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<ContentRecommendation[]>([])
  const [summary, setSummary] = useState<RecommendationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (propertyId) {
      fetchRecommendations()
    }
  }, [propertyId, runId])

  const fetchRecommendations = async () => {
    setLoading(true)
    try {
      const url = `/api/propertyaudit/recommendations?propertyId=${propertyId}${runId ? `&runId=${runId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()

      if (res.ok) {
        setRecommendations(data.recommendations || [])
        setSummary(data.summary || null)
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleExport = () => {
    const csvContent = [
      [
        'Priority',
        'Type',
        'Title',
        'Target URL',
        'Target Page Type',
        'Owner',
        'Access Level',
        'Keywords',
        'Impact Score',
        'Evidence',
        'Implementation Steps',
        'Acceptance Criteria',
      ].join(','),
      ...filteredRecommendations.map(r =>
        [
          r.priority,
          r.type,
          `"${r.title}"`,
          `"${r.targetUrl || ''}"`,
          `"${r.targetPageType || ''}"`,
          r.owner || '',
          r.accessLevel || '',
          `"${r.keywords.join('; ')}"`,
          r.impact.score,
          `"${(r.evidence || []).join('; ')}"`,
          `"${(r.implementationSteps || r.actionItems).join('; ')}"`,
          `"${(r.acceptanceCriteria || []).join('; ')}"`,
        ].join(',')
      ),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `propertyaudit-recommendations-${Date.now()}.csv`
    a.click()
  }

  const filteredRecommendations = recommendations.filter(r => {
    if (filter !== 'all' && r.priority !== filter) return false
    if (typeFilter !== 'all' && r.type !== typeFilter) return false
    return true
  })

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-900'
      case 'low':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-900'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'missing_keyword':
        return <AlertCircle className="w-5 h-5" />
      case 'content_gap':
        return <TrendingUp className="w-5 h-5" />
      case 'citation_opportunity':
        return <ExternalLink className="w-5 h-5" />
      case 'rank_improvement':
        return <Sparkles className="w-5 h-5" />
      case 'voice_search':
        return <Lightbulb className="w-5 h-5" />
      default:
        return <Lightbulb className="w-5 h-5" />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'missing_keyword':
        return 'Missing Keyword'
      case 'content_gap':
        return 'Content Gap'
      case 'citation_opportunity':
        return 'Citation Opportunity'
      case 'rank_improvement':
        return 'Rank Improvement'
      case 'voice_search':
        return 'Voice Search'
      default:
        return type
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  if (recommendations.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
        <Lightbulb className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No Recommendations Yet
        </h3>
        <p className="text-gray-500">
          Run a GEO audit first to generate content recommendations based on your performance data.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.totalRecommendations}
            </div>
            <div className="text-sm text-gray-500">Total Recommendations</div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-900 p-4">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {summary.highPriority}
            </div>
            <div className="text-sm text-red-600 dark:text-red-400">High Priority</div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-xl border border-yellow-200 dark:border-yellow-900 p-4">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {summary.mediumPriority}
            </div>
            <div className="text-sm text-yellow-600 dark:text-yellow-400">Medium Priority</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {summary.lowPriority}
            </div>
            <div className="text-sm text-blue-600 dark:text-blue-400">Low Priority</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Priority:
              </span>
              <div className="flex gap-2">
                {(['all', 'high', 'medium', 'low'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setFilter(p)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                      filter === p
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Type:</span>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Types</option>
                <option value="missing_keyword">Missing Keywords</option>
                <option value="content_gap">Content Gaps</option>
                <option value="citation_opportunity">Citations</option>
                <option value="rank_improvement">Rank Improvements</option>
                <option value="voice_search">Voice Search</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Recommendations List */}
      <div className="space-y-4">
        {filteredRecommendations.map(rec => (
          <div
            key={rec.id}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="text-indigo-500 mt-1">{getTypeIcon(rec.type)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(rec.priority)}`}
                    >
                      {rec.priority.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">{getTypeLabel(rec.type)}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {rec.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{rec.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                      Access: {rec.accessLevel || 'URLOnly'}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                      Owner: {rec.owner || 'seo'}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                      Status: {rec.status || 'todo'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <div className="text-2xl font-bold text-indigo-600">{rec.impact.score}</div>
                <div className="text-xs text-gray-500">Impact Score</div>
              </div>
            </div>

            {/* Keywords */}
            {rec.keywords.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-500">Keywords:</span>
                  {rec.keywords.map((keyword, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rec.targetPageType || rec.targetUrl ? (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">
                {rec.targetPageType && (
                  <div className="mb-1">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Target page type:</span>{' '}
                    <span className="text-gray-600 dark:text-gray-400">{rec.targetPageType}</span>
                  </div>
                )}
                {rec.targetUrl && (
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-200">Target URL:</span>{' '}
                    <span className="text-gray-600 dark:text-gray-400 break-all">{rec.targetUrl}</span>
                  </div>
                )}
              </div>
            ) : null}

            {/* Surface Breakdown */}
            {rec.surfaceBreakdown && Object.keys(rec.surfaceBreakdown).length > 0 ? (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900 rounded-lg">
                <div className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-2">
                  Surface Performance:
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {Object.entries(rec.surfaceBreakdown).map(([key, surface]) => (
                    <div key={key}>
                      <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">
                        {surface.label}
                      </div>
                      <div className="text-xs space-y-1">
                        <div className={surface.presence ? 'text-green-600' : 'text-red-600'}>
                          {surface.presence ? '✓' : '✗'} {surface.presence ? 'Present' : 'Absent'}
                        </div>
                        {surface.rank && <div>Rank: #{surface.rank}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : rec.modelBreakdown && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900 rounded-lg">
                <div className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-2">
                  Model Performance:
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {rec.modelBreakdown.openai && (
                    <div>
                      <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">
                        OpenAI
                      </div>
                      <div className="text-xs space-y-1">
                        <div className={rec.modelBreakdown.openai.presence ? 'text-green-600' : 'text-red-600'}>
                          {rec.modelBreakdown.openai.presence ? '✓' : '✗'} {rec.modelBreakdown.openai.presence ? 'Present' : 'Absent'}
                        </div>
                        {rec.modelBreakdown.openai.rank && (
                          <div>Rank: #{rec.modelBreakdown.openai.rank}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {rec.modelBreakdown.claude && (
                    <div>
                      <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">
                        Claude
                      </div>
                      <div className="text-xs space-y-1">
                        <div className={rec.modelBreakdown.claude.presence ? 'text-green-600' : 'text-red-600'}>
                          {rec.modelBreakdown.claude.presence ? '✓' : '✗'} {rec.modelBreakdown.claude.presence ? 'Present' : 'Absent'}
                        </div>
                        {rec.modelBreakdown.claude.rank && (
                          <div>Rank: #{rec.modelBreakdown.claude.rank}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {rec.modelBreakdown.affectedModels && rec.modelBreakdown.affectedModels.length > 0 && (
                  <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                    Affects: {rec.modelBreakdown.affectedModels.map(m => m.toUpperCase()).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Competitor Context */}
            {rec.competitorContext && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900 rounded-lg">
                <div className="text-xs font-medium text-amber-900 dark:text-amber-100 mb-1">
                  Competitor Benchmark:
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>{rec.competitorContext.competitorName}</strong> (
                  {rec.competitorContext.competitorDomain}) ranks at position #
                  {rec.competitorContext.avgRank.toFixed(1)}
                </div>
              </div>
            )}

            {/* Impact Reason */}
            <div className="mb-4">
              <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                <TrendingUp className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>{rec.impact.reason}</span>
              </div>
            </div>

            {rec.evidence?.length ? (
              <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Evidence:
                </div>
                <ul className="space-y-1">
                  {rec.evidence.map((item, idx) => (
                    <li key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rec.sourceQueryEvidence?.length ? (
              <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-900 rounded-lg">
                <div className="text-xs font-medium text-purple-900 dark:text-purple-100 mb-2">
                  GEO Query Evidence:
                </div>
                <ul className="space-y-1">
                  {rec.sourceQueryEvidence.map((item, idx) => (
                    <li key={idx} className="text-sm text-purple-800 dark:text-purple-200">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rec.missingSignals?.length ? (
              <div className="mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-500">Missing signals:</span>
                  {rec.missingSignals.map((signal, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Action Items */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                Implementation Steps:
              </div>
              <ul className="space-y-2">
                {(rec.implementationSteps || rec.actionItems).map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <span className="text-indigo-500 mt-0.5">•</span>
                    <span className="flex-1">{action}</span>
                    <button
                      onClick={() => handleCopy(action, `${rec.id}-${idx}`)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Copy action item"
                    >
                      {copiedId === `${rec.id}-${idx}` ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {rec.acceptanceCriteria?.length ? (
              <div>
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Acceptance Criteria:
                </div>
                <ul className="space-y-2">
                  {rec.acceptanceCriteria.map((criterion, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {filteredRecommendations.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500">No recommendations match the selected filters.</p>
        </div>
      )}
    </div>
  )
}
