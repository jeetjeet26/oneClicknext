'use client'

/**
 * Brand Intelligence Dashboard Component
 * Main dashboard for competitive brand intelligence
 */

import React, { useState, useEffect, useCallback } from 'react'
import { BrandIntelligence } from './types'
import { BrandIntelligenceCard } from './BrandIntelligenceCard'
import { CompetitorComparisonView } from './CompetitorComparisonView'
import { SemanticSearchPanel } from './SemanticSearchPanel'
import { BrandIntelligenceJobProgress } from './BrandIntelligenceJobProgress'
import { CompetitorIntakePanel } from './CompetitorIntakePanel'

interface BrandIntelligenceDashboardProps {
  propertyId: string
  propertyName?: string
  propertyBrandVoice?: string
  propertyTargetAudience?: string
}

type ViewMode = 'cards' | 'comparison' | 'search'

export function BrandIntelligenceDashboard({ 
  propertyId,
  propertyName,
  propertyBrandVoice,
  propertyTargetAudience
}: BrandIntelligenceDashboardProps) {
  const [intelligence, setIntelligence] = useState<BrandIntelligence[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionJobId, setExtractionJobId] = useState<string | null>(null)

  const fetchBrandIntelligence = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/marketvision/brand-intelligence?propertyId=${propertyId}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch brand intelligence')
      }

      setIntelligence(data.competitors || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    fetchBrandIntelligence()
  }, [fetchBrandIntelligence])

  const handleExtractBrandIntelligence = async () => {
    try {
      setIsExtracting(true)
      setError(null)

      const response = await fetch('/api/marketvision/brand-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          forceRefresh: false
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start extraction')
      }

      setExtractionJobId(data.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start extraction')
      setIsExtracting(false)
    }
  }

  const handleExtractionComplete = () => {
    setIsExtracting(false)
    setExtractionJobId(null)
    fetchBrandIntelligence()
  }

  const handleViewDetails = (competitorId: string) => {
    // Could open a modal or navigate to a detail page
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Brand Intelligence</h2>
          <p className="text-sm text-gray-600 mt-1">
            AI-powered competitive brand analysis for {propertyName || 'your property'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Tabs */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'cards' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('comparison')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'comparison' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Compare
            </button>
            <button
              onClick={() => setViewMode('search')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'search' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Search
            </button>
          </div>

          {/* Extract Button */}
          <button
            onClick={handleExtractBrandIntelligence}
            disabled={isExtracting}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isExtracting ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing...
              </>
            ) : (
              <>
                <span>🔍</span>
                Analyze Competitors
              </>
            )}
          </button>
        </div>
      </div>

      {/* Job Progress */}
      {extractionJobId && (
        <BrandIntelligenceJobProgress 
          jobId={extractionJobId}
          onComplete={handleExtractionComplete}
          onClose={() => {
            setExtractionJobId(null)
            setIsExtracting(false)
          }}
        />
      )}

      <CompetitorIntakePanel
        propertyId={propertyId}
        onComplete={fetchBrandIntelligence}
      />

      {/* Error State */}
      {error && !extractionJobId && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchBrandIntelligence}
            className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && !extractionJobId && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-2/3 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div className="flex gap-2 mb-4">
                <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                <div className="h-6 bg-gray-200 rounded-full w-24"></div>
              </div>
              <div className="h-20 bg-gray-200 rounded mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && intelligence.length === 0 && !extractionJobId && (
        <div className="text-center py-16 bg-gray-50 rounded-xl border border-gray-200">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            No Brand Intelligence Yet
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Analyze your competitors' websites to uncover their brand positioning, 
            target audience, and marketing strategies.
          </p>
          <button
            onClick={handleExtractBrandIntelligence}
            className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Start Analysis
          </button>
        </div>
      )}

      {/* Content Views */}
      {!isLoading && !error && intelligence.length > 0 && (
        <>
          {viewMode === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {intelligence.map((intel) => (
                <BrandIntelligenceCard
                  key={intel.id}
                  intelligence={intel}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}

          {viewMode === 'comparison' && (
            <CompetitorComparisonView
              competitors={intelligence}
              yourProperty={{
                name: propertyName || '',
                brandVoice: propertyBrandVoice,
                targetAudience: propertyTargetAudience
              }}
            />
          )}

          {viewMode === 'search' && (
            <SemanticSearchPanel
              propertyId={propertyId}
            />
          )}
        </>
      )}

      {/* Stats Footer */}
      {!isLoading && intelligence.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500 pt-4 border-t border-gray-200">
          <span>
            {intelligence.length} competitor{intelligence.length !== 1 ? 's' : ''} analyzed
          </span>
          <span>
            Last updated: {new Date().toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
        </div>
      )}
    </div>
  )
}

