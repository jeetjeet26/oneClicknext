'use client'

import { useState } from 'react'
import { useEffect } from 'react'
import { X, Play, Sparkles, Globe, Repeat } from 'lucide-react'
import { DEFAULT_AUDIT_SURFACES, getSurfaceLabel, type Surface } from '@/utils/propertyaudit/types'

const SURFACE_OPTIONS: Array<{ id: Surface; description: string }> = [
  { id: 'chatgpt', description: 'Grounded proxy for ChatGPT-style answers' },
  { id: 'gemini', description: 'Grounded Gemini answer measurement' },
  { id: 'perplexity', description: 'Citation-rich Perplexity answer capture' },
  { id: 'google_ai', description: 'Google-grounded AI Overview proxy' },
]

interface RunAuditModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (config: {
    surfaces: Surface[]
    executionCount: number
  }) => Promise<void>
  queryCount: number
  propertyId: string
}

export function RunAuditModal({
  isOpen,
  onClose,
  onSubmit,
  queryCount,
  propertyId
}: RunAuditModalProps) {
  const [surfaces, setSurfaces] = useState<Surface[]>(DEFAULT_AUDIT_SURFACES)
  const [executionCount, setExecutionCount] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [preflight, setPreflight] = useState<any>(null)

  useEffect(() => {
    if (!isOpen || !propertyId) return

    const controller = new AbortController()
    const loadPreflight = async () => {
      try {
        const res = await fetch(
          `/api/propertyaudit/preflight?propertyId=${propertyId}&surfaces=${surfaces.join(',')}`,
          { signal: controller.signal }
        )
        if (res.ok) {
          setPreflight(await res.json())
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to load PropertyAudit preflight:', error)
        }
      }
    }

    loadPreflight()
    return () => controller.abort()
  }, [isOpen, propertyId, surfaces])

  if (!isOpen) return null

  const toggleSurface = (surface: Surface) => {
    if (surfaces.includes(surface)) {
      if (surfaces.length > 1) { // Keep at least one selected
        setSurfaces(surfaces.filter(s => s !== surface))
      }
    } else {
      setSurfaces([...surfaces, surface])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (surfaces.length === 0) return

    setIsSubmitting(true)
    try {
      await onSubmit({ surfaces, executionCount })
      onClose()
    } catch (error) {
      console.error('Error starting audit:', error)
      alert('Failed to start audit. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalExecutions = queryCount * executionCount * surfaces.length
  const selectedReadiness = preflight?.surfaces?.filter((surface: any) => surfaces.includes(surface.surface)) || []
  const hasMissingSurfaceConfig = selectedReadiness.some((surface: any) => !surface.ready)
  const runtimeNotReady = preflight?.runtime && !preflight.runtime.ready
  const canSubmit = surfaces.length > 0 && !isSubmitting && !hasMissingSurfaceConfig && !runtimeNotReady

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Play className="w-5 h-5 text-indigo-500" />
            Configure Audit Run
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Surface Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select GEO Surfaces
            </label>
            <div className="space-y-2">
              {SURFACE_OPTIONS.map((option, index) => {
                const selected = surfaces.includes(option.id)
                const Icon = index % 2 === 0 ? Sparkles : Globe
                const readiness = preflight?.surfaces?.find((surface: any) => surface.surface === option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleSurface(option.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-5 h-5 text-indigo-500" />
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                        {getSurfaceLabel(option.id)}
                        {readiness && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                            readiness.ready
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          }`}>
                            {readiness.ready ? 'Ready' : 'Missing config'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{option.description}</div>
                      {readiness?.missingKeys?.length > 0 && (
                        <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                          Missing: {readiness.missingKeys.join(', ')}
                        </div>
                      )}
                    </div>
                    {selected && (
                      <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs">✓</div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Execution Count Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <div className="flex items-center justify-between">
                <span>Run Each Query</span>
                <span className="font-semibold text-indigo-600 flex items-center gap-1">
                  <Repeat className="w-4 h-4" />
                  {executionCount}× {executionCount === 1 ? 'time' : 'times'}
                </span>
              </div>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={executionCount}
              onChange={(e) => setExecutionCount(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1× (single check)</span>
              <span>5× (high confidence)</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Running queries multiple times provides statistical confidence and presence rate analysis
            </p>
          </div>

          {/* Summary */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 border border-gray-200 dark:border-gray-700">
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Queries:</span>
                <span className="font-medium text-gray-900 dark:text-white">{queryCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Models:</span>
                <span className="font-medium text-gray-900 dark:text-white">{surfaces.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Executions per query:</span>
                <span className="font-medium text-gray-900 dark:text-white">{executionCount}×</span>
              </div>
              <div className="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 flex justify-between">
                <span className="font-semibold text-gray-900 dark:text-white">Total LLM calls:</span>
                <span className="font-bold text-indigo-600">{totalExecutions}</span>
              </div>
              {preflight?.runtime && (
                <div className="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 text-xs text-gray-500">
                  Runtime: Data engine · {preflight.runtime.ready ? 'ready' : 'not ready'}
                  {!preflight.runtime.ready && preflight.runtime.dataEngine?.message ? (
                    <div className="mt-1 text-red-600 dark:text-red-400">
                      {preflight.runtime.dataEngine.message}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Audit
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
