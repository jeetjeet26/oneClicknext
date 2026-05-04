'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { 
  ChevronDown, 
  ChevronUp, 
  ChevronRight,
  Trash2, 
  Edit2, 
  ToggleLeft,
  ToggleRight,
  MoreHorizontal,
  ArrowUpDown,
  Download,
  Eye,
  EyeOff,
  Loader2,
  ExternalLink
} from 'lucide-react'
import { DeltaBadge, Sparkline } from '../charts'
import { getSurfaceLabel } from '@/utils/propertyaudit/types'
import { ScoreBreakdown } from '../score'

// Execution data types for expanded rows
interface ExecutionData {
  id: string
  runId: string
  surface: string
  modelName: string | null
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: string[]
  answerSummary: string | null
  orderedEntities: Array<{
    name: string
    domain: string
    position: number
    rationale?: string | null
  }>
  citations: Array<{
    url: string
    domain: string
    isBrandDomain: boolean
  }>
  createdAt: string
  analysisMethod: string | null
  naturalResponse: string | null
}

interface ExecutionAggregates {
  totalExecutions: number
  presenceRate: number
  medianLlmRank: number | null
  medianLinkRank: number | null
  medianSov: number | null
  surfaces: Record<string, number>
}

export interface QueryRow {
  id: string
  text: string
  type: 'branded' | 'category' | 'comparison' | 'local' | 'faq' | 'voice_search'
  geo: string | null
  weight: number
  isActive: boolean
  // Score data (from latest run)
  presence?: boolean
  presenceRate?: number // 0-1 for multi-run aggregation
  llmRank?: number | null
  linkRank?: number | null
  sov?: number | null
  score?: number
  breakdown?: {
    position: number
    link: number
    sov: number
    accuracy: number
  }
  // Delta from previous run
  deltas?: {
    scoreDelta: number | null
    presenceDelta: number
  }
  // Historical scores for sparkline
  history?: number[]
  // AI Overview visibility
  aiOverviewVisible?: boolean
  aiOverviewSource?: string | null
}

interface QueryTableProps {
  queries: QueryRow[]
  onDelete?: (id: string) => void
  onEdit?: (query: QueryRow) => void
  onToggleActive?: (id: string, isActive: boolean) => void
  onBulkDelete?: (ids: string[]) => void
  onExport?: () => void
}

type SortKey = 'text' | 'type' | 'presence' | 'llmRank' | 'score' | 'delta'
type SortDir = 'asc' | 'desc'
type GroupBy = 'none' | 'type' | 'presence'

const TYPE_COLORS: Record<string, string> = {
  branded: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  category: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  comparison: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  local: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  faq: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  voice_search: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
}

const formatTypeLabel = (type: string): string => {
  return type === 'voice_search' ? 'Voice Search' : type.charAt(0).toUpperCase() + type.slice(1)
}

export function QueryTable({
  queries,
  onDelete,
  onEdit,
  onToggleActive,
  onBulkDelete,
  onExport
}: QueryTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['all']))
  const [showActions, setShowActions] = useState<string | null>(null)
  
  // Execution expansion state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [executionData, setExecutionData] = useState<Map<string, { executions: ExecutionData[]; aggregates: ExecutionAggregates; loading: boolean; error: string | null }>>(new Map())

  // Fetch executions for a query
  const fetchExecutions = useCallback(async (queryId: string) => {
    // Set loading state
    setExecutionData(prev => {
      const next = new Map(prev)
      next.set(queryId, { executions: [], aggregates: { totalExecutions: 0, presenceRate: 0, medianLlmRank: null, medianLinkRank: null, medianSov: null, surfaces: {} }, loading: true, error: null })
      return next
    })

    try {
      const response = await fetch(`/api/propertyaudit/queries/${queryId}/executions`)
      if (!response.ok) {
        throw new Error('Failed to fetch executions')
      }
      const data = await response.json()
      
      setExecutionData(prev => {
        const next = new Map(prev)
        next.set(queryId, { 
          executions: data.executions || [], 
          aggregates: data.aggregates || { totalExecutions: 0, presenceRate: 0, medianLlmRank: null, medianLinkRank: null, medianSov: null, surfaces: {} },
          loading: false, 
          error: null 
        })
        return next
      })
    } catch (err) {
      setExecutionData(prev => {
        const next = new Map(prev)
        next.set(queryId, { 
          executions: [], 
          aggregates: { totalExecutions: 0, presenceRate: 0, medianLlmRank: null, medianLinkRank: null, medianSov: null, surfaces: {} },
          loading: false, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        })
        return next
      })
    }
  }, [])

  // Toggle row expansion
  const toggleRowExpansion = useCallback((queryId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(queryId)) {
        next.delete(queryId)
      } else {
        next.add(queryId)
        // Fetch data if not already loaded
        if (!executionData.has(queryId)) {
          fetchExecutions(queryId)
        }
      }
      return next
    })
  }, [executionData, fetchExecutions])

  // Sorting
  const sortedQueries = useMemo(() => {
    if (!sort) return queries
    return [...queries].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      switch (sort.key) {
        case 'text':
          return a.text.localeCompare(b.text) * dir
        case 'type':
          return a.type.localeCompare(b.type) * dir
        case 'presence':
          return ((a.presence ? 1 : 0) - (b.presence ? 1 : 0)) * dir
        case 'llmRank':
          const av = a.llmRank ?? Infinity
          const bv = b.llmRank ?? Infinity
          return (av - bv) * dir
        case 'score':
          return ((a.score ?? 0) - (b.score ?? 0)) * dir
        case 'delta':
          return ((a.deltas?.scoreDelta ?? 0) - (b.deltas?.scoreDelta ?? 0)) * dir
        default:
          return 0
      }
    })
  }, [queries, sort])

  // Grouping
  const groupedQueries = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'All Queries', items: sortedQueries }]
    }

    const groups = new Map<string, QueryRow[]>()
    sortedQueries.forEach((q) => {
      let key: string
      if (groupBy === 'type') {
        key = q.type
      } else if (groupBy === 'presence') {
        key = q.presence ? 'present' : 'absent'
      } else {
        key = 'all'
      }
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(q)
    })

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: groupBy === 'type' 
        ? key.charAt(0).toUpperCase() + key.slice(1)
        : key === 'present' ? 'With Presence' : 'No Presence',
      items
    }))
  }, [sortedQueries, groupBy])

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' }
      if (prev.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === queries.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(queries.map(q => q.id)))
    }
  }

  const handleBulkDelete = () => {
    if (selectedIds.size > 0 && onBulkDelete) {
      onBulkDelete(Array.from(selectedIds))
      setSelectedIds(new Set())
    }
  }

  const exportCSV = () => {
    const rows = sortedQueries.map((q) => ({
      Query: q.text,
      Type: q.type,
      Active: q.isActive ? 'Yes' : 'No',
      Presence: q.presence ? 'Yes' : 'No',
      'Presence Rate': q.presenceRate !== undefined ? `${Math.round(q.presenceRate * 100)}%` : '',
      'AI Overview': q.aiOverviewVisible !== undefined ? (q.aiOverviewVisible ? 'Visible' : 'Hidden') : '',
      'LLM Rank': q.llmRank ?? '',
      Score: q.score?.toFixed(1) ?? '',
      'Score Delta': q.deltas?.scoreDelta?.toFixed(1) ?? ''
    }))
    const header = Object.keys(rows[0] ?? {}).join(',')
    const csv = [header, ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'queries_export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (!sort || sort.key !== columnKey) {
      return <ArrowUpDown className="w-3 h-3 opacity-40" />
    }
    return sort.dir === 'asc' 
      ? <ChevronUp className="w-3 h-3" /> 
      : <ChevronDown className="w-3 h-3" />
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs"
          >
            <option value="none">No grouping</option>
            <option value="type">Group by Type</option>
            <option value="presence">Group by Presence</option>
          </select>

          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
            >
              <Trash2 className="w-3 h-3" />
              Delete ({selectedIds.size})
            </button>
          )}
        </div>

        <button
          onClick={onExport || exportCSV}
          className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download className="w-3 h-3" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.size === queries.length && queries.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-3 py-3">
                <button 
                  onClick={() => toggleSort('text')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase"
                >
                  Query <SortIcon columnKey="text" />
                </button>
              </th>
              <th className="px-3 py-3">
                <button 
                  onClick={() => toggleSort('type')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase"
                >
                  Type <SortIcon columnKey="type" />
                </button>
              </th>
              <th className="px-3 py-3 text-right">
                <button 
                  onClick={() => toggleSort('presence')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase ml-auto"
                >
                  Presence <SortIcon columnKey="presence" />
                </button>
              </th>
              <th className="px-3 py-3 text-center">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                  AI Overview
                </span>
              </th>
              <th className="px-3 py-3 text-right">
                <button 
                  onClick={() => toggleSort('llmRank')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase ml-auto"
                >
                  LLM Rank <SortIcon columnKey="llmRank" />
                </button>
              </th>
              <th className="px-3 py-3 text-right">
                <button 
                  onClick={() => toggleSort('score')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase ml-auto"
                >
                  Score <SortIcon columnKey="score" />
                </button>
              </th>
              <th className="px-3 py-3 text-right">
                <button 
                  onClick={() => toggleSort('delta')}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase ml-auto"
                >
                  Δ <SortIcon columnKey="delta" />
                </button>
              </th>
              <th className="w-12 px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {groupedQueries.map((group) => (
              <React.Fragment key={group.key}>
                {groupBy !== 'none' && (
                  <tr 
                    className="bg-gray-50/50 dark:bg-gray-800/50"
                  >
                    <td colSpan={9} className="px-3 py-2">
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"
                      >
                        {expandedGroups.has(group.key) 
                          ? <ChevronDown className="w-4 h-4" />
                          : <ChevronRight className="w-4 h-4" />
                        }
                        {group.label} ({group.items.length})
                      </button>
                    </td>
                  </tr>
                )}
                {(groupBy === 'none' || expandedGroups.has(group.key)) && group.items.map((query) => (
                  <React.Fragment key={query.id}>
                    <tr 
                      id={`query-row-${query.id}`}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${!query.isActive ? 'opacity-50' : ''} cursor-pointer`}
                      onClick={() => toggleRowExpansion(query.id)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(query.id)}
                          onChange={() => toggleSelect(query.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`transition-transform ${expandedRows.has(query.id) ? 'rotate-90' : ''}`}>
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          </span>
                          <div className="max-w-md">
                            <p className="font-medium text-gray-900 dark:text-white truncate">
                              {query.text}
                            </p>
                            {query.geo && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{query.geo}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[query.type]}`}>
                          {formatTypeLabel(query.type)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`inline-flex items-center gap-1 ${query.presence ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                            <span className={`h-2 w-2 rounded-full ${query.presence ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                            {query.presence ? 'Yes' : 'No'}
                          </span>
                          {query.presenceRate !== undefined && query.presenceRate < 1 && (
                            <span className="text-xs text-gray-500">
                              {Math.round(query.presenceRate * 100)}% rate
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {query.aiOverviewVisible !== undefined ? (
                          <span 
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                              query.aiOverviewVisible 
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' 
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}
                            title={query.aiOverviewSource || undefined}
                          >
                            {query.aiOverviewVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            {query.aiOverviewVisible ? 'Visible' : 'Hidden'}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-medium ${query.llmRank && query.llmRank <= 3 ? 'text-green-600' : 'text-gray-900 dark:text-white'}`}>
                          {query.llmRank ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {query.score !== undefined && query.breakdown ? (
                          <ScoreBreakdown score={query.score} breakdown={query.breakdown} compact />
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <DeltaBadge value={query.deltas?.scoreDelta} showZero />
                          {query.history && query.history.length > 1 && (
                            <Sparkline 
                              values={query.history} 
                              width={40} 
                              height={16}
                              strokeColor={
                                (query.deltas?.scoreDelta ?? 0) > 0 
                                  ? '#22c55e' 
                                  : (query.deltas?.scoreDelta ?? 0) < 0 
                                    ? '#ef4444' 
                                    : '#6b7280'
                              }
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <button
                            onClick={() => setShowActions(showActions === query.id ? null : query.id)}
                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <MoreHorizontal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                          </button>
                          {showActions === query.id && (
                            <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                              {onEdit && (
                                <button
                                  onClick={() => { onEdit(query); setShowActions(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                  <Edit2 className="w-3.5 h-3.5" /> Edit
                                </button>
                              )}
                              {onToggleActive && (
                                <button
                                  onClick={() => { onToggleActive(query.id, !query.isActive); setShowActions(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                  {query.isActive 
                                    ? <><ToggleLeft className="w-3.5 h-3.5" /> Deactivate</>
                                    : <><ToggleRight className="w-3.5 h-3.5" /> Activate</>
                                  }
                                </button>
                              )}
                              {onDelete && (
                                <button
                                  onClick={() => { onDelete(query.id); setShowActions(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded execution details */}
                    {expandedRows.has(query.id) && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50 dark:bg-gray-800/30 px-6 py-4">
                          <ExecutionDetails 
                            queryId={query.id}
                            data={executionData.get(query.id)}
                            onRefresh={() => fetchExecutions(query.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {queries.length === 0 && (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No queries found. Generate a query panel to get started.
          </div>
        )}
      </div>
    </div>
  )
}

// ExecutionDetails component for expanded rows
function ExecutionDetails({ 
  queryId, 
  data,
  onRefresh
}: { 
  queryId: string
  data?: { executions: ExecutionData[]; aggregates: ExecutionAggregates; loading: boolean; error: string | null }
  onRefresh: () => void
}) {
  if (!data || data.loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400 mr-2" />
        <span className="text-sm text-gray-500">Loading execution data...</span>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-500 mb-2">Failed to load execution data</p>
        <button 
          onClick={onRefresh}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          Try again
        </button>
      </div>
    )
  }

  if (data.executions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        No execution data available. Run an audit to generate data.
      </div>
    )
  }

  const { executions, aggregates } = data

  return (
    <div className="space-y-4">
      {/* Aggregates summary */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Total Executions:</span>
          <span className="font-semibold text-gray-900 dark:text-white">{aggregates.totalExecutions}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Presence Rate:</span>
          <span className={`font-semibold ${aggregates.presenceRate >= 0.5 ? 'text-green-600' : 'text-orange-500'}`}>
            {Math.round(aggregates.presenceRate * 100)}%
          </span>
        </div>
        {aggregates.medianLlmRank !== null && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Median Rank:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{aggregates.medianLlmRank}</span>
          </div>
        )}
        {aggregates.medianSov !== null && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Median SOV:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{Math.round(aggregates.medianSov * 100)}%</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Surfaces:</span>
          <span className="text-gray-700 dark:text-gray-300">
            {Object.entries(aggregates.surfaces).map(([surface, count]) => `${surface}: ${count}`).join(', ')}
          </span>
        </div>
      </div>

      {/* Execution table */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">#</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Surface</th>
              <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300">Presence</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">LLM Rank</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Link Rank</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">SOV</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Flags</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {executions.map((exec, idx) => (
              <tr key={exec.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-3 py-2 text-gray-500">#{idx + 1}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                    exec.surface === 'openai' || exec.surface === 'chatgpt'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  }`}>
                    {getSurfaceLabel(exec.surface)}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-flex items-center gap-1 ${exec.presence ? 'text-green-600' : 'text-gray-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${exec.presence ? 'bg-green-500' : 'bg-gray-300'}`} />
                    {exec.presence ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={exec.llmRank && exec.llmRank <= 3 ? 'text-green-600 font-medium' : ''}>
                    {exec.llmRank ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{exec.linkRank ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {exec.sov !== null ? `${Math.round(exec.sov * 100)}%` : '—'}
                </td>
                <td className="px-3 py-2">
                  {exec.flags.length > 0 ? (
                    <span className="text-orange-600 dark:text-orange-400">
                      {exec.flags.join(', ')}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {new Date(exec.createdAt).toLocaleString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top entities from latest execution */}
      {executions[0]?.orderedEntities && executions[0].orderedEntities.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Top Entities (Latest Execution):</p>
          <div className="flex flex-wrap gap-2">
            {executions[0].orderedEntities.slice(0, 5).map((entity, idx) => (
              <span 
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs"
                title={entity.rationale || undefined}
              >
                <span className="font-medium text-gray-900 dark:text-white">#{entity.position}</span>
                <span className="text-gray-600 dark:text-gray-300">{entity.name}</span>
                {entity.domain && (
                  <a 
                    href={`https://${entity.domain}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-500 hover:text-blue-600"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

