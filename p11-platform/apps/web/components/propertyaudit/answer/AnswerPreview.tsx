'use client'

import { useState } from 'react'
import { X, ExternalLink, AlertCircle, CheckCircle2, Sparkles, Globe } from 'lucide-react'
import { getSurfaceLabel, type Surface } from '@/utils/propertyaudit/types'

interface AnswerEntity {
  name: string
  domain: string
  rationale: string
  position: number
}

interface AnswerCitation {
  url: string
  domain: string
  isBrandDomain: boolean
  entityRef?: string
}

interface Answer {
  id: string
  queryText: string
  queryType: string
  surface: Surface
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: string[]
  answerSummary: string
  naturalResponse?: string | null
  analysisMethod?: string | null
  orderedEntities: AnswerEntity[]
  citations: AnswerCitation[]
  rawResponse?: any
}

interface AnswerPreviewProps {
  isOpen: boolean
  onClose: () => void
  answers: Answer[] // Array to support comparison view
  showComparison?: boolean
}

export function AnswerPreview({ 
  isOpen, 
  onClose, 
  answers,
  showComparison = false 
}: AnswerPreviewProps) {
  const [selectedSurface, setSelectedSurface] = useState<Surface | 'both'>(
    showComparison && answers.length > 1 ? 'both' : answers[0]?.surface || 'chatgpt'
  )

  if (!isOpen || answers.length === 0) return null

  const uniqueSurfaces = Array.from(new Set(answers.map(answer => answer.surface)))

  const displayAnswers = selectedSurface === 'both' 
    ? answers
    : answers.filter(answer => answer.surface === selectedSurface)

  const FLAG_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    no_sources: { 
      label: 'No Sources', 
      color: 'bg-gray-100 text-gray-700', 
      icon: <AlertCircle className="w-3 h-3" /> 
    },
    possible_hallucination: { 
      label: 'Possible Hallucination', 
      color: 'bg-red-100 text-red-700', 
      icon: <AlertCircle className="w-3 h-3" /> 
    },
    outdated_info: { 
      label: 'Outdated Info', 
      color: 'bg-yellow-100 text-yellow-700', 
      icon: <AlertCircle className="w-3 h-3" /> 
    },
    nap_mismatch: { 
      label: 'NAP Mismatch', 
      color: 'bg-orange-100 text-orange-700', 
      icon: <AlertCircle className="w-3 h-3" /> 
    },
    conflicting_prices: { 
      label: 'Conflicting Prices', 
      color: 'bg-orange-100 text-orange-700', 
      icon: <AlertCircle className="w-3 h-3" /> 
    },
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50">
      <div className="h-full w-full max-w-4xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {answers[0]?.queryText}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Query Type: <span className="capitalize">{answers[0]?.queryType}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Surface Toggle */}
          {answers.length > 1 && (
            <div className="mt-4 flex items-center gap-2">
              {[...uniqueSurfaces, 'both' as const].map((surface) => (
                <button
                  key={surface}
                  onClick={() => setSelectedSurface(surface)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedSurface === surface
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {surface === 'both' ? null : surface === 'openai' || surface === 'chatgpt' ? <Sparkles className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  {surface === 'both' ? 'Compare' : getSurfaceLabel(surface)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className={`p-6 ${selectedSurface === 'both' ? 'grid grid-cols-2 gap-6' : ''}`}>
          {displayAnswers.map((answer, idx) => (
            <div key={answer.id} className="space-y-6">
              {/* Surface Label for Comparison */}
              {selectedSurface === 'both' && (
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                  {answer.surface === 'openai' || answer.surface === 'chatgpt'
                    ? <Sparkles className="w-4 h-4 text-green-500" />
                    : <Globe className="w-4 h-4 text-purple-500" />
                  }
                  <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                    {getSurfaceLabel(answer.surface)}
                  </span>
                </div>
              )}

              {/* Metrics Card */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Metrics</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-gray-500">Presence</span>
                    <div className="flex items-center gap-1 mt-1">
                      {answer.presence ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-gray-400" />
                      )}
                      <span className={`text-sm font-medium ${answer.presence ? 'text-green-600' : 'text-gray-400'}`}>
                        {answer.presence ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">LLM Rank</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                      {answer.llmRank ?? '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Link Rank</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                      {answer.linkRank ?? '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Share of Voice</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                      {answer.sov !== null ? `${(answer.sov * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </div>

                {/* Flags */}
                {answer.flags.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-xs text-gray-500 block mb-2">Flags</span>
                    <div className="flex flex-wrap gap-1.5">
                      {answer.flags.map((flag) => {
                        const info = FLAG_INFO[flag] || { label: flag, color: 'bg-gray-100 text-gray-700', icon: null }
                        return (
                          <span
                            key={flag}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${info.color}`}
                          >
                            {info.icon}
                            {info.label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Full LLM Response */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {answer.naturalResponse ? 'Natural LLM Response (What Users See)' : 'Full LLM Response'}
                </h3>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                  {answer.naturalResponse ? (
                    <div className="space-y-3">
                      {answer.analysisMethod && (
                        <div className="text-xs text-gray-500">
                          Method: <span className="font-medium">{answer.analysisMethod}</span>
                        </div>
                      )}
                      <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                        {answer.naturalResponse}
                      </p>

                      {/* Extracted Analysis */}
                      {answer.rawResponse?.analysis && (
                        <details className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
                            Extracted Analysis (click to expand)
                          </summary>
                          <div className="mt-3 space-y-2">
                            {answer.rawResponse?.analysis?.brand_analysis && (
                              <div className="text-sm text-gray-700 dark:text-gray-300">
                                <div className="font-medium text-gray-900 dark:text-white">Brand Analysis</div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 space-y-0.5">
                                  <div>Mentioned: {String(answer.rawResponse.analysis.brand_analysis.mentioned)}</div>
                                  <div>Position: {answer.rawResponse.analysis.brand_analysis.position ?? '—'}</div>
                                  <div>Location stated: {answer.rawResponse.analysis.brand_analysis.location_stated ?? '—'}</div>
                                  <div>Location correct: {String(answer.rawResponse.analysis.brand_analysis.location_correct)}</div>
                                  <div>Prominence: {answer.rawResponse.analysis.brand_analysis.prominence ?? '—'}</div>
                                </div>
                              </div>
                            )}

                            {typeof answer.rawResponse?.analysis?.extraction_confidence === 'number' && (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Extraction confidence: <span className="font-medium">{answer.rawResponse.analysis.extraction_confidence}%</span>
                              </div>
                            )}

                            <details className="cursor-pointer">
                              <summary className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                                View full extracted JSON
                              </summary>
                              <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 overflow-x-auto bg-white dark:bg-gray-950 p-3 rounded">
                                {JSON.stringify(answer.rawResponse.analysis, null, 2)}
                              </pre>
                            </details>
                          </div>
                        </details>
                      )}
                    </div>
                  ) : answer.rawResponse ? (
                    <div className="space-y-3">
                      {/* Try to extract text content from raw response */}
                      {typeof answer.rawResponse === 'object' && answer.rawResponse?.choices?.[0]?.message?.content ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                          {answer.rawResponse.choices[0].message.content}
                        </p>
                      ) : typeof answer.rawResponse === 'object' && answer.rawResponse?.content?.[0]?.text ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                          {answer.rawResponse.content[0].text}
                        </p>
                      ) : typeof answer.rawResponse === 'string' ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                          {answer.rawResponse}
                        </p>
                      ) : (
                        <details className="cursor-pointer">
                          <summary className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-2">
                            View Raw JSON Response
                          </summary>
                          <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto bg-gray-50 dark:bg-gray-900 p-3 rounded">
                            {JSON.stringify(answer.rawResponse, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">
                      {answer.answerSummary || 'No response available'}
                    </p>
                  )}
                </div>
              </div>

              {/* Ordered Entities */}
              {answer.orderedEntities.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Ordered Entities ({answer.orderedEntities.length})
                  </h3>
                  <div className="space-y-2">
                    {answer.orderedEntities.map((entity) => (
                      <div
                        key={entity.position}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                            {entity.position}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white">
                              {entity.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">{entity.domain}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {entity.rationale}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Citations */}
              {answer.citations.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Citations ({answer.citations.length})
                  </h3>
                  <div className="space-y-1.5">
                    {answer.citations.map((citation, idx) => (
                      <a
                        key={idx}
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                          citation.isBrandDomain
                            ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-900/20'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className={`h-6 w-6 flex items-center justify-center rounded-full text-xs font-medium ${
                          citation.isBrandDomain 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            {citation.domain}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{citation.url}</p>
                        </div>
                        {citation.isBrandDomain && (
                          <span className="text-xs font-medium text-green-600 dark:text-green-400">
                            Your Brand
                          </span>
                        )}
                        <ExternalLink className="w-4 h-4 text-gray-400" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}









