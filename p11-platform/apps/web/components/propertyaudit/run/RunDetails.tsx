'use client'

import { useState, useEffect } from 'react'
import { X, Sparkles, Globe, CheckCircle2, AlertCircle, Clock, ChevronRight, Trash2 } from 'lucide-react'
import { ScoreRing, ScoreBreakdown } from '../score'
import { AnswerPreview } from '../answer'

interface RunDetailsProps {
  runId: string | null
  isOpen: boolean
  onClose: () => void
}

interface Answer {
  id: string
  queryText: string
  queryType: string
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: string[]
  answerSummary: string
  naturalResponse?: string | null
  analysisMethod?: string | null
  orderedEntities: Array<{
    name: string
    domain: string
    rationale: string
    position: number
  }>
  citations: Array<{
    url: string
    domain: string
    isBrandDomain: boolean
  }>
  rawResponse?: any
}

interface RunData {
  run: {
    id: string
    surface: 'openai' | 'claude'
    modelName: string
    status: string
    queryCount: number
    progressPct: number
    currentQueryIndex: number
    statusDetail: string
    isPossiblyStalled: boolean
    startedAt: string
    finishedAt: string | null
    usesWebSearch: boolean
    errorMessage: string | null
  }
  score: {
    overallScore: number
    visibilityPct: number
    avgLlmRank: number | null
    avgLinkRank: number | null
    avgSov: number | null
    breakdown: {
      position: number
      link: number
      sov: number
      accuracy: number
    }
  } | null
  answers: Answer[]
  stats: {
    totalQueries: number
    withPresence: number
    avgLlmRank: number | null
    avgLinkRank: number | null
    avgSov: number | null
    flaggedCount: number
  }
}

export function RunDetails({ runId, isOpen, onClose }: RunDetailsProps) {
  const [data, setData] = useState<RunData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'present' | 'absent'>('all')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (isOpen && runId) {
      fetchRunDetails()
    }
  }, [isOpen, runId])

  const fetchRunDetails = async () => {
    if (!runId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/propertyaudit/runs/${runId}`)
      const result = await res.json()
      if (res.ok) {
        setData(result)
      }
    } catch (error) {
      console.error('Error fetching run details:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteThisRun = async () => {
    if (!runId) return
    if (!confirm('Delete this run and all of its answers? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/propertyaudit/runs/${runId}`, { method: 'DELETE' })
      if (res.ok) {
        onClose()
      } else {
        const data = await res.json().catch(() => ({}))
        console.error('Failed to delete run:', data)
      }
    } catch (err) {
      console.error('Error deleting run:', err)
    } finally {
      setDeleting(false)
    }
  }

  if (!isOpen) return null

  const filteredAnswers = data?.answers.filter(a => {
    if (filterType === 'present') return a.presence
    if (filterType === 'absent') return !a.presence
    return true
  }) || []

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50">
        <div className="h-full w-full max-w-5xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {data?.run.surface === 'openai' ? (
                    <Sparkles className="w-6 h-6 text-green-500" />
                  ) : (
                    <Globe className="w-6 h-6 text-purple-500" />
                  )}
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
                    {data?.run.surface} Run Details
                  </h2>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <span>{data?.run.modelName}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {data?.run.startedAt && new Date(data.run.startedAt).toLocaleString()}
                  </span>
                  <span>•</span>
                  <span>{data?.run.queryCount} queries</span>
                </div>
                {data?.run &&
                  (data.run.status === 'queued' ||
                    data.run.status === 'running' ||
                    data.run.status === 'failed') && (
                    <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                      <p className="text-xs text-gray-600 dark:text-gray-300">{data.run.statusDetail}</p>
                      {(data.run.status === 'queued' || data.run.status === 'running') && (
                        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${data.run.isPossiblyStalled ? 'bg-amber-500' : 'bg-indigo-500'}`}
                            style={{ width: `${Math.max(0, Math.min(100, data.run.progressPct || 0))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
              </div>
              <div className="ml-4 flex items-center gap-2">
                <button
                  onClick={deleteThisRun}
                  disabled={deleting || loading}
                  className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 disabled:opacity-50"
                  title="Delete this run"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="Close"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mx-auto mb-4" />
              <p className="text-gray-500">Loading run details...</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Score Summary */}
              {data?.score && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 flex flex-col items-center">
                    <ScoreRing score={data.score.overallScore} size={80} />
                    <span className="text-xs text-gray-500 mt-2">Overall Score</span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                    <span className="text-xs text-gray-500">Visibility</span>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {Math.round(data.score.visibilityPct)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {data.stats.withPresence} of {data.stats.totalQueries} queries
                    </p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                    <span className="text-xs text-gray-500">Avg LLM Rank</span>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {data.score.avgLlmRank?.toFixed(1) ?? '—'}
                    </p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                    <span className="text-xs text-gray-500">Avg SOV</span>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {data.score.avgSov !== null ? `${(data.score.avgSov * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </div>
              )}

              {/* Score Breakdown */}
              {data?.score && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <ScoreBreakdown 
                    score={data.score.overallScore} 
                    breakdown={data.score.breakdown} 
                  />
                </div>
              )}

              {/* Answers List */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Query Results ({filteredAnswers.length})
                  </h3>
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                    {(['all', 'present', 'absent'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setFilterType(filter)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                          filterType === filter
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {filter === 'all' ? 'All' : filter === 'present' ? 'With Presence' : 'No Presence'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {filteredAnswers.map((answer) => (
                    <button
                      key={answer.id}
                      onClick={() => setSelectedAnswer(answer)}
                      className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {answer.presence ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="font-medium text-gray-900 dark:text-white">
                              {answer.queryText}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="capitalize">{answer.queryType}</span>
                            {answer.llmRank && <span>Rank: {answer.llmRank}</span>}
                            {answer.sov !== null && <span>SOV: {(answer.sov * 100).toFixed(0)}%</span>}
                            <span>{answer.orderedEntities.length} entities</span>
                            <span>{answer.citations.length} citations</span>
                          </div>
                          {answer.flags.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {answer.flags.map((flag) => (
                                <span
                                  key={flag}
                                  className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700"
                                >
                                  {flag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Answer Preview Drawer */}
      {selectedAnswer && (
        <AnswerPreview
          isOpen={true}
          onClose={() => setSelectedAnswer(null)}
          answers={[{
            ...selectedAnswer,
            surface: data?.run.surface || 'openai',
            rawResponse: selectedAnswer.rawResponse
          }]}
        />
      )}
    </>
  )
}









