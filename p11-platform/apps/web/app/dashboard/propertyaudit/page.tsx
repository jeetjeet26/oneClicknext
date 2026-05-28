'use client'

import { useState, useEffect } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import {
  TrendChart,
  DumbbellChart,
  ScoreRing,
  QueryTable,
  QueryFilters,
  CreateQueryModal,
  SeedKeywordUploadModal,
  ExportMenu,
  RunDetails,
  RunStatusIndicator,
  CompetitorInsights,
  ContentRecommendations,
  AlertBanner,
  useGeoAlerts,
  QueryTypeRings,
  ModelComparisonCard,
  InsightsPanel,
  useGeoInsights,
  PositioningMatrix,
  QueryPerformanceCards,
  ReportBuilder,
  AiOverviewCard,
  RunAuditModal,
  type QueryRow,
} from '@/components/propertyaudit'
import {
  Search,
  RefreshCw,
  Settings,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Eye,
  Plus,
  Trash2,
  Sparkles,
  Globe,
  LayoutGrid,
  List,
  FileText,
  Upload,
} from 'lucide-react'
import { getSurfaceLabel, type Surface } from '@/utils/propertyaudit/types'
import type { PropertyAuditSeedKeyword } from '@/utils/propertyaudit/seed-keywords'

interface GeoScoreSummary {
  propertyId: string
  overallScore: number
  visibilityPct: number
  scoreBucket: 'excellent' | 'good' | 'fair' | 'poor'
  surfaces: Partial<Record<Surface, SurfaceScore | null>>
  surfaceSummaries: Array<{
    surface: Surface
    label: string
    score: number | null
    visibilityPct: number | null
  }>
  breakdown: {
    position: number
    link: number
    sov: number
    accuracy: number
  }
  lastRunAt: string | null
  trend: {
    direction: 'up' | 'down' | 'stable'
    changePercent: number
  } | null
}

interface SurfaceScore {
  overallScore: number
  visibilityPct: number
  avgLlmRank: number | null
  avgLinkRank: number | null
  avgSov: number | null
  runId: string
  runAt: string
}

interface GeoRun {
  id: string
  batchId: string | null
  surface: Surface
  status: 'queued' | 'running' | 'completed' | 'failed'
  queryCount: number
  progressPct: number
  currentQueryIndex: number
  statusLabel: string
  statusDetail: string
  isPossiblyStalled: boolean
  errorMessage: string | null
  startedAt: string
  usesWebSearch?: boolean
  score: {
    overallScore: number
    visibilityPct: number
  } | null
  diff: {
    scoreChange: number
    direction: 'up' | 'down' | 'stable'
  } | null
}

type TrendPoint = {
  date: string
  score: number
  visibility: number
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function buildBatchTrendData(runs: GeoRun[]): TrendPoint[] {
  const batches = new Map<string, { startedAt: string; scores: number[]; visibility: number[] }>()

  runs
    .filter(run => run.status === 'completed' && run.score)
    .forEach(run => {
      const batchKey = run.batchId || run.id
      const entry = batches.get(batchKey) || { startedAt: run.startedAt, scores: [], visibility: [] }
      if (Date.parse(run.startedAt) < Date.parse(entry.startedAt)) {
        entry.startedAt = run.startedAt
      }
      entry.scores.push(run.score!.overallScore)
      entry.visibility.push(run.score!.visibilityPct)
      batches.set(batchKey, entry)
    })

  return Array.from(batches.values())
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .slice(-10)
    .map(batch => ({
      date: batch.startedAt,
      score: average(batch.scores),
      visibility: average(batch.visibility),
    }))
}

export default function PropertyAuditPage() {
  const { currentProperty } = usePropertyContext()
  const [score, setScore] = useState<GeoScoreSummary | null>(null)
  const [queries, setQueries] = useState<QueryRow[]>([])
  const [runs, setRuns] = useState<GeoRun[]>([])
  const [competitors, setCompetitors] = useState<Array<{ name: string; domain: string; mentionCount: number; avgRank: number }>>([])
  const [aiOverviewSummary, setAiOverviewSummary] = useState<{
    totalTracked: number
    visibleCount: number
    visibilityPct: number
    byType: Array<{ type: string; visiblePct: number }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false)
  const [runAuditError, setRunAuditError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'queries' | 'recommendations' | 'insights' | 'history'>('overview')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSeedUploadModal, setShowSeedUploadModal] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [queryView, setQueryView] = useState<'table' | 'cards'>('table')
  const [showReportBuilder, setShowReportBuilder] = useState(false)
  const [showRunAuditModal, setShowRunAuditModal] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [isResettingGeo, setIsResettingGeo] = useState(false)
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([])

  // Generate alerts and insights
  const alerts = useGeoAlerts(score, runs, competitors)
  const visibleAlerts = alerts.filter(alert => !dismissedAlertIds.includes(alert.id))
  const insights = useGeoInsights(score, queries, runs)

  useEffect(() => {
    if (currentProperty?.id) {
      // Clear existing data immediately when property changes
      setScore(null)
      setQueries([])
      setRuns([])
      setCompetitors([])
      setAiOverviewSummary(null)
      fetchData()
    }
  }, [currentProperty?.id])

  const fetchData = async () => {
    if (!currentProperty?.id) return

    setLoading(true)
    try {
      await Promise.all([
        fetchScore(),
        fetchQueries(),
        fetchRuns(),
        fetchCompetitors(),
        fetchAiOverviews()
      ])
    } finally {
      setLoading(false)
    }
  }

  const fetchScore = async () => {
    const res = await fetch(`/api/propertyaudit/score?propertyId=${currentProperty?.id}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
      }
    })
    const data = await res.json()
    console.log('[PropertyAudit] Fetched score for property:', currentProperty?.id, data)
    if (res.ok) {
      setScore(data.score || null)
    } else {
      setScore(null)
    }
  }

  const fetchQueries = async () => {
    const res = await fetch(`/api/propertyaudit/queries?propertyId=${currentProperty?.id}`, {
      cache: 'no-store'
    })
    const data = await res.json()
    if (res.ok) {
      setQueries(data.queries || [])
    }
  }

  const fetchRuns = async () => {
    const res = await fetch(`/api/propertyaudit/runs?propertyId=${currentProperty?.id}`, {
      cache: 'no-store'
    })
    const data = await res.json()
    if (res.ok) {
      setRuns(data.runs || [])
    }
  }

  const resetGeoScores = async () => {
    if (!currentProperty?.id) return
    if (!confirm('Reset ALL GEO scores and audit results for this property? This deletes run history, scores, answers, citations, and AI Overview observations. Query prompts will be kept. This cannot be undone.')) return

    setIsResettingGeo(true)
    try {
      const res = await fetch('/api/propertyaudit/runs/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Failed to purge runs:', data)
        return
      }
      setShowSettingsMenu(false)
      setSelectedRunId(null)
      await fetchData()
    } catch (err) {
      console.error('Error resetting GEO scores:', err)
    } finally {
      setIsResettingGeo(false)
    }
  }

  const fetchCompetitors = async () => {
    const res = await fetch(`/api/propertyaudit/insights?propertyId=${currentProperty?.id}&surface=both`)
    const data = await res.json()
    if (res.ok) {
      setCompetitors(data.competitors || [])
    }
  }

  const fetchAiOverviews = async () => {
    const res = await fetch(`/api/propertyaudit/ai-overviews?propertyId=${currentProperty?.id}`)
    const data = await res.json()
    if (res.ok && data.data) {
      // Build summary from raw data
      const overviews = data.data as Array<{ query_id: string; visible: boolean; source_url?: string }>
      const total = overviews.length
      const visible = overviews.filter(o => o.visible).length
      
      // Group by query type (we'll need to match with queries)
      const typeVisibility = new Map<string, { total: number; visible: number }>()
      overviews.forEach(overview => {
        const query = queries.find(q => q.id === overview.query_id)
        if (query) {
          const type = query.type
          const entry = typeVisibility.get(type) || { total: 0, visible: 0 }
          entry.total += 1
          if (overview.visible) entry.visible += 1
          typeVisibility.set(type, entry)
        }
      })
      
      setAiOverviewSummary({
        totalTracked: total,
        visibleCount: visible,
        visibilityPct: total > 0 ? Math.round((visible / total) * 100) : 0,
        byType: Array.from(typeVisibility.entries()).map(([type, entry]) => ({
          type,
          visiblePct: entry.total > 0 ? Math.round((entry.visible / entry.total) * 100) : 0
        }))
      })
    }
  }

  const generateQueryPanel = async (seedKeywords?: PropertyAuditSeedKeyword[]) => {
    if (!currentProperty?.id) return

    setIsGeneratingQueries(true)
    try {
      const res = await fetch('/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          generateFromProperty: true,
          ...(seedKeywords?.length ? { seedKeywords } : {})
        })
      })

      if (res.ok) {
        await fetchQueries()
      }
    } catch (err) {
      console.error('Error generating queries:', err)
    } finally {
      setIsGeneratingQueries(false)
    }
  }

  const generateSeededQueryPanel = async (seedKeywords: PropertyAuditSeedKeyword[]) => {
    await generateQueryPanel(seedKeywords)
  }

  const runAudit = async (config: { surfaces: Surface[]; executionCount: number }) => {
    if (!currentProperty?.id) return

    setIsRunning(true)
    setRunAuditError(null)
    try {
      const res = await fetch('/api/propertyaudit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          surfaces: config.surfaces,
          executionCount: config.executionCount
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start PropertyAudit run')
      }

      if (res.ok) {
        await fetchRuns()
      }
    } catch (err) {
      console.error('Error running audit:', err)
      setRunAuditError(err instanceof Error ? err.message : 'Failed to start PropertyAudit run')
      throw err
    } finally {
      setIsRunning(false)
    }
  }

  const handleCreateQuery = async (queryData: {
    text: string
    type: 'branded' | 'category' | 'comparison' | 'local' | 'faq' | 'voice_search'
    weight: number
    geo?: string
  }) => {
    const res = await fetch('/api/propertyaudit/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: currentProperty?.id,
        query: queryData
      })
    })

    if (res.ok) {
      await fetchQueries()
    }
  }

  const handleDeleteQuery = async (id: string) => {
    if (!confirm('Delete this query?')) return

    const res = await fetch(`/api/propertyaudit/queries/${id}`, {
      method: 'DELETE'
    })

    if (res.ok) {
      await fetchQueries()
    }
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/propertyaudit/queries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    })

    if (res.ok) {
      await fetchQueries()
    }
  }

  const handleBulkDelete = async (ids: string[]) => {
    if (!confirm(`Delete ${ids.length} queries?`)) return

    await Promise.all(
      ids.map(id => fetch(`/api/propertyaudit/queries/${id}`, { method: 'DELETE' }))
    )
    await fetchQueries()
  }

  const getScoreColor = (bucket: string) => {
    switch (bucket) {
      case 'excellent': return 'text-green-600'
      case 'good': return 'text-blue-600'
      case 'fair': return 'text-yellow-600'
      case 'poor': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const TrendIcon = ({ direction }: { direction: 'up' | 'down' | 'stable' }) => {
    if (direction === 'up') return <TrendingUp className="w-4 h-4 text-green-500" />
    if (direction === 'down') return <TrendingDown className="w-4 h-4 text-red-500" />
    return <Minus className="w-4 h-4 text-gray-400" />
  }

  // Build trend data by audit batch so same-day surfaces do not render as history.
  const trendData = buildBatchTrendData(runs)

  const latestCompletedRun = runs.find(r => r.status === 'completed') || null
  const latestCompletedBatchId = latestCompletedRun?.batchId || null

  // Build comparison data for dumbbell
  const comparisonData = queries
    .filter(q => q.score !== undefined)
    .slice(0, 10)
    .map(q => ({
      id: q.id,
      label: q.text,
      openai: 0, // Would need separate scores per surface
      claude: q.score!
    }))

  if (!currentProperty?.id) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Select a property to view GEO insights</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Search className="w-7 h-7 text-indigo-500" />
            <span>PropertyAudit</span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Generative Engine Optimization (GEO) - Track AI visibility
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowReportBuilder(true)}
            disabled={!runs.find(r => r.status === 'completed')}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FileText className="w-4 h-4" />
            Generate Report
          </button>
          <ExportMenu 
            runId={runs.find(r => r.status === 'completed')?.id || null}
          />
          <button
            onClick={() => setShowRunAuditModal(true)}
            disabled={isRunning || queries.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play className={`w-4 h-4 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? 'Running...' : 'Run Audit'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowSettingsMenu(value => !value)}
              className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              aria-label="PropertyAudit settings"
              aria-expanded={showSettingsMenu}
            >
              <Settings className="w-5 h-5" />
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">PropertyAudit Settings</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Reset generated GEO results while keeping the query panel.
                  </p>
                </div>
                <button
                  onClick={resetGeoScores}
                  disabled={isResettingGeo || runs.length === 0}
                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block font-medium">
                      {isResettingGeo ? 'Resetting GEO scores...' : 'Reset all GEO scores'}
                    </span>
                    <span className="block text-xs text-red-600/80 dark:text-red-300/80">
                      Deletes runs, scores, answers, citations, and AI Overview observations.
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Run Status Indicator */}
      {currentProperty?.id && (
        <RunStatusIndicator 
          propertyId={currentProperty.id}
          onRunCompleted={fetchData}
        />
      )}

      {runAuditError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {runAuditError}
        </div>
      )}

      {/* Alert Banners */}
      {visibleAlerts.length > 0 && (
        <AlertBanner 
          alerts={visibleAlerts}
          onDismiss={(id) => setDismissedAlertIds(prev => [...prev, id])}
        />
      )}

      {/* Score Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">GEO Score</span>
            {score?.trend && <TrendIcon direction={score.trend.direction} />}
          </div>
          {loading ? (
            <div className="h-12 bg-gray-200 rounded animate-pulse" />
          ) : score ? (
            <div className="flex items-center gap-3">
              <ScoreRing score={score.overallScore} size={60} />
              <div>
                <div className={`text-3xl font-bold ${getScoreColor(score.scoreBucket)}`}>
                  {Math.round(score.overallScore)}
                </div>
                {score.trend && score.trend.changePercent !== 0 && (
                  <span className={`text-xs ${score.trend.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                    {score.trend.direction === 'up' ? '+' : ''}{score.trend.changePercent.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No data yet</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Visibility</span>
            <Eye className="w-4 h-4 text-gray-400" />
          </div>
          {loading ? (
            <div className="h-12 bg-gray-200 rounded animate-pulse" />
          ) : score ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {Math.round(score.visibilityPct)}%
              </span>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No data yet</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">OpenAI</span>
            <Sparkles className="w-4 h-4 text-green-500" />
          </div>
          {loading ? (
            <div className="h-12 bg-gray-200 rounded animate-pulse" />
          ) : score?.surfaces.openai ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {Math.round(score.surfaces.openai.overallScore)}
              </span>
              <span className="text-sm text-gray-500">
                {Math.round(score.surfaces.openai.visibilityPct)}%
              </span>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No data yet</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Claude</span>
            <Globe className="w-4 h-4 text-purple-500" />
          </div>
          {loading ? (
            <div className="h-12 bg-gray-200 rounded animate-pulse" />
          ) : score?.surfaces.claude ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {Math.round(score.surfaces.claude.overallScore)}
              </span>
              <span className="text-sm text-gray-500">
                {Math.round(score.surfaces.claude.visibilityPct)}%
              </span>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No data yet</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6">
          {(['overview', 'queries', 'recommendations', 'insights', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-1 font-medium text-sm border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'queries' ? `Queries (${queries.length})` : tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {queries.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No Query Panel Yet
                </h3>
                <p className="text-gray-500 mb-4">
                  Generate a query panel from your property data to start tracking GEO visibility.
                </p>
                <button
                  onClick={() => generateQueryPanel()}
                  disabled={isGeneratingQueries}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isGeneratingQueries ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {isGeneratingQueries ? 'Generating...' : 'Generate Query Panel'}
                </button>
              </div>
            ) : (
              <>
                {/* Insights Panel */}
                {insights.length > 0 && (
                  <InsightsPanel
                    insights={insights}
                    onViewFullAnalysis={() => setActiveTab('recommendations')}
                  />
                )}

                {/* Model Comparison + Query Type Rings + AI Overview */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {/* Model Comparison */}
                  {(() => {
                    const primarySurface = score?.surfaceSummaries?.[0]
                    const secondarySurface = score?.surfaceSummaries?.[1]
                    return (
                  <ModelComparisonCard
                    primary={primarySurface ? score?.surfaces[primarySurface.surface] || null : null}
                    primaryLabel={primarySurface?.label || 'Primary Surface'}
                    secondary={secondarySurface ? score?.surfaces[secondarySurface.surface] || null : null}
                    secondaryLabel={secondarySurface?.label || 'Secondary Surface'}
                    onViewDetails={() => setActiveTab('insights')}
                  />
                    )
                  })()}

                  {/* Query Type Performance */}
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Performance by Query Type
                    </h3>
                    <QueryTypeRings queries={queries} />
                  </div>

                  {/* AI Overview Visibility */}
                  <AiOverviewCard 
                    summary={aiOverviewSummary}
                    isLoading={loading}
                  />
                </div>

                {/* Trend Chart */}
                {trendData.length > 1 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Score Trend
                    </h3>
                    <TrendChart points={trendData} height={200} />
                  </div>
                )}

                {/* Score Breakdown */}
                {score?.breakdown && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Score Breakdown
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Position
                            <span className="text-gray-400 ml-1">(45% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.position)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-indigo-500 rounded-full" 
                            style={{ width: `${score.breakdown.position}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Link Rank
                            <span className="text-gray-400 ml-1">(25% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.link)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full" 
                            style={{ width: `${score.breakdown.link}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Share of Voice
                            <span className="text-gray-400 ml-1">(20% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.sov)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-green-500 rounded-full" 
                            style={{ width: `${score.breakdown.sov}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Accuracy
                            <span className="text-gray-400 ml-1">(10% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.accuracy)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-yellow-500 rounded-full" 
                            style={{ width: `${score.breakdown.accuracy}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Queries Tab */}
        {activeTab === 'queries' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Query Panel
              </h3>
              <div className="flex items-center gap-2">
                {/* View Toggle */}
                <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg">
                  <button
                    onClick={() => setQueryView('table')}
                    className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 rounded-l-lg transition-colors ${
                      queryView === 'table'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <List className="w-3 h-3" />
                    Table
                  </button>
                  <button
                    onClick={() => setQueryView('cards')}
                    className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 rounded-r-lg transition-colors ${
                      queryView === 'cards'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    Cards
                  </button>
                </div>

                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4" />
                  Add Query
                </button>
                <button
                  onClick={() => setShowSeedUploadModal(true)}
                  disabled={isGeneratingQueries}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                >
                  <Upload className="w-4 h-4" />
                  Seed CSV
                </button>
                <button
                  onClick={() => generateQueryPanel()}
                  disabled={isGeneratingQueries}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <RefreshCw className={`w-4 h-4 ${isGeneratingQueries ? 'animate-spin' : ''}`} />
                  Regenerate
                </button>
              </div>
            </div>

            {queryView === 'table' ? (
              <>
                <QueryFilters queries={queries} />
                <QueryTable
                  queries={queries}
                  onDelete={handleDeleteQuery}
                  onToggleActive={handleToggleActive}
                  onBulkDelete={handleBulkDelete}
                />
              </>
            ) : (
              <QueryPerformanceCards
                queries={queries.map(q => ({
                  id: q.id,
                  text: q.text,
                  type: q.type,
                  presence: q.presence || false,
                  llmRank: q.llmRank || null,
                  sov: q.sov || null,
                  score: q.score || 0,
                }))}
                onViewAnswer={(id) => {
                  setQueryView('table')
                  const el = document.getElementById(`query-row-${id}`)
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
                onOptimizeQuery={(id) => setActiveTab('recommendations')}
                onAddSimilar={(text) => setShowCreateModal(true)}
              />
            )}
          </div>
        )}

        {/* Recommendations Tab */}
        {activeTab === 'recommendations' && currentProperty?.id && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Content Recommendations
                </h3>
                <p className="text-sm text-gray-500">
                  Actionable suggestions based on your GEO performance
                </p>
              </div>
            </div>
            <ContentRecommendations propertyId={currentProperty.id} />
          </div>
        )}

        {/* Insights Tab */}
        {activeTab === 'insights' && currentProperty?.id && (
          <div className="space-y-6">
            <PositioningMatrix 
              queries={queries}
              competitors={competitors}
            />
            <CompetitorInsights propertyId={currentProperty.id} />
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-end">
              <button
                onClick={resetGeoScores}
                disabled={isResettingGeo || runs.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {isResettingGeo ? 'Resetting GEO scores...' : 'Reset GEO scores'}
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500">
                No runs yet. Click &quot;Run Audit&quot; to start tracking.
              </div>
            ) : (
              <div className="grid gap-4">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {run.surface === 'openai' || run.surface === 'chatgpt' ? (
                          <Sparkles className="w-5 h-5 text-green-500" />
                        ) : (
                          <Globe className="w-5 h-5 text-purple-500" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 dark:text-white capitalize">
                              {getSurfaceLabel(run.surface)} Run
                            </p>
                            {run.usesWebSearch && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                <Globe className="w-3 h-3" />
                                Search
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {new Date(run.startedAt).toLocaleString()} • {run.queryCount} queries
                          </p>
                          {(run.status === 'queued' || run.status === 'running' || run.status === 'failed') && (
                            <p className="text-xs text-gray-500 mt-1">{run.statusDetail}</p>
                          )}
                          {(run.status === 'running' || run.status === 'queued') && (
                            <div className="mt-2 h-1.5 w-56 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${run.isPossiblyStalled ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                style={{ width: `${Math.max(0, Math.min(100, run.progressPct || 0))}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {run.score && (
                          <>
                            <div className="text-right">
                              <p className="text-lg font-bold text-gray-900 dark:text-white">
                                {Math.round(run.score.overallScore)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {Math.round(run.score.visibilityPct)}% visible
                              </p>
                            </div>
                            {run.diff && (
                              <TrendIcon direction={run.diff.direction} />
                            )}
                          </>
                        )}
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          run.status === 'completed' ? 'bg-green-100 text-green-700' :
                          run.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {run.status}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals/Drawers */}
      <CreateQueryModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateQuery}
        defaultGeo={currentProperty?.city}
        propertyName={currentProperty?.name}
      />

      <SeedKeywordUploadModal
        isOpen={showSeedUploadModal}
        onClose={() => setShowSeedUploadModal(false)}
        onGenerate={generateSeededQueryPanel}
        isGenerating={isGeneratingQueries}
        propertyName={currentProperty?.name}
      />

      <RunDetails
        runId={selectedRunId}
        isOpen={selectedRunId !== null}
        onClose={() => setSelectedRunId(null)}
      />

      <ReportBuilder
        isOpen={showReportBuilder}
        onClose={() => setShowReportBuilder(false)}
        propertyId={currentProperty?.id || ''}
        propertyName={currentProperty?.name || 'Property'}
        runId={latestCompletedRun?.id || null}
        batchId={latestCompletedBatchId}
        runSummary={latestCompletedRun ? {
          surface: latestCompletedRun.surface,
          startedAt: latestCompletedRun.startedAt,
        } : null}
      />

      <RunAuditModal
        isOpen={showRunAuditModal}
        onClose={() => setShowRunAuditModal(false)}
        onSubmit={runAudit}
        queryCount={queries.length}
        propertyId={currentProperty?.id || ''}
      />
    </div>
  )
}

