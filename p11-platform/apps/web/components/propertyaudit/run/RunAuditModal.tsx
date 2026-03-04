'use client'

import { useState } from 'react'
import { X, Play, Sparkles, Globe, Repeat } from 'lucide-react'

interface RunAuditModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (config: {
    surfaces: ('openai' | 'claude')[]
    executionCount: number
  }) => Promise<void>
  queryCount: number
}

export function RunAuditModal({
  isOpen,
  onClose,
  onSubmit,
  queryCount
}: RunAuditModalProps) {
  const [surfaces, setSurfaces] = useState<('openai' | 'claude')[]>(['openai', 'claude'])
  const [executionCount, setExecutionCount] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const toggleSurface = (surface: 'openai' | 'claude') => {
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
              Select AI Models
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => toggleSurface('openai')}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                  surfaces.includes('openai')
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <Sparkles className="w-5 h-5 text-green-500" />
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-white">OpenAI</div>
                  <div className="text-xs text-gray-500">GPT-4 Search / ChatGPT</div>
                </div>
                {surfaces.includes('openai') && (
                  <div className="w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">✓</div>
                )}
              </button>

              <button
                type="button"
                onClick={() => toggleSurface('claude')}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                  surfaces.includes('claude')
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <Globe className="w-5 h-5 text-purple-500" />
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-white">Claude</div>
                  <div className="text-xs text-gray-500">Claude 3.5 Sonnet</div>
                </div>
                {surfaces.includes('claude') && (
                  <div className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs">✓</div>
                )}
              </button>
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
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={surfaces.length === 0 || isSubmitting}
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
