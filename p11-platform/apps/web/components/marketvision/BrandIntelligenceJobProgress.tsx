'use client'

/**
 * Brand Intelligence Job Progress Component
 * Shows progress of brand intelligence extraction
 */

import React, { useState, useEffect, useCallback } from 'react'
import { BrandIntelligenceJob, isTerminalJobStatus } from './types'

interface BrandIntelligenceJobProgressProps {
  jobId: string
  onComplete?: () => void
  onClose?: () => void
}

export function BrandIntelligenceJobProgress({ 
  jobId, 
  onComplete,
  onClose 
}: BrandIntelligenceJobProgressProps) {
  const [job, setJob] = useState<BrandIntelligenceJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchJobStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/marketvision/brand-intelligence/job/${jobId}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch job status')
      }

      setJob(data.job)

      // Check if job reached a terminal state
      if (isTerminalJobStatus(data.job.status)) {
        onComplete?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    }
  }, [jobId, onComplete])

  useEffect(() => {
    // Initial fetch
    fetchJobStatus()

    // Poll every 3 seconds while the job has not reached a terminal state
    const interval = setInterval(() => {
      if (!job || !isTerminalJobStatus(job.status)) {
        fetchJobStatus()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [fetchJobStatus, job, job?.status])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'succeeded': return 'text-green-600 bg-green-50'
      case 'failed': return 'text-red-600 bg-red-50'
      case 'cancelled': return 'text-gray-600 bg-gray-100'
      case 'running': return 'text-blue-600 bg-blue-50'
      case 'retrying': return 'text-amber-600 bg-amber-50'
      case 'queued': return 'text-yellow-600 bg-yellow-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'succeeded': return '✓'
      case 'failed': return '✕'
      case 'cancelled': return '⊘'
      case 'running': return '⟳'
      case 'retrying': return '↻'
      case 'queued': return '◷'
      default: return '?'
    }
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-700">
          <span className="text-lg">⚠️</span>
          <span>{error}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-3 text-sm text-red-600 hover:text-red-700"
          >
            Dismiss
          </button>
        )}
      </div>
    )
  }

  if (!job) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-2 bg-gray-200 rounded w-full mb-2"></div>
        <div className="h-2 bg-gray-200 rounded w-2/3"></div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStatusColor(job.status)}`}>
            <span className={job.status === 'running' ? 'animate-spin' : ''}>
              {getStatusIcon(job.status)}
            </span>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Brand Intelligence Extraction</h4>
            <p className="text-sm text-gray-500 capitalize">
              {job.status}
              {job.result === 'partial' ? ' (partial)' : ''}
            </p>
          </div>
        </div>
        
        {onClose && isTerminalJobStatus(job.status) && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Progress</span>
          <span>{Math.round(job.progressPercent)}%</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 ${
              job.result === 'partial' ? 'bg-amber-500' :
              job.status === 'succeeded' ? 'bg-green-500' :
              job.status === 'failed' ? 'bg-red-500' :
              'bg-blue-500'
            }`}
            style={{ width: `${job.progressPercent}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center p-3 bg-gray-50 rounded-lg">
          <div className="text-2xl font-semibold text-gray-900">{job.processedCount}</div>
          <div className="text-xs text-gray-500">Processed</div>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-lg">
          <div className="text-2xl font-semibold text-gray-900">{job.totalCompetitors}</div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-lg">
          <div className={`text-2xl font-semibold ${job.failedCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {job.failedCount}
          </div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
      </div>

      {/* Batch Info */}
      {job.totalBatches > 1 && (
        <div className="text-sm text-gray-600 text-center">
          Batch {job.currentBatch} of {job.totalBatches}
        </div>
      )}

      {/* Error Message */}
      {job.errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-sm text-red-700">
          {job.errorMessage}
        </div>
      )}

      {/* Completion Message */}
      {job.status === 'succeeded' && job.result === 'partial' && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded text-sm text-amber-700">
          Partial result: analyzed {job.processedCount} competitors, {job.failedCount} failed.
        </div>
      )}
      {job.status === 'succeeded' && job.result === 'success' && (
        <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded text-sm text-green-700">
          ✓ Brand intelligence extraction complete! Analyzed {job.processedCount} competitors.
        </div>
      )}
    </div>
  )
}

