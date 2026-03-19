'use client'

// SiteForge Product Page
// /dashboard/siteforge
// Created: December 11, 2025

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { ConversationalGenerationWizard } from '@/components/siteforge'
import {
  Globe,
  Plus,
  ExternalLink,
  Eye,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  Sparkles
} from 'lucide-react'

interface Website {
  id: string
  propertyId: string
  wpUrl: string | null
  wpAdminUrl: string | null
  generationStatus: string
  generationProgress: number
  currentStep: string | null
  errorMessage: string | null
  brandSource: string | null
  brandConfidence: number | null
  version: number
  createdAt: string
  generationCompletedAt: string | null
}

export default function SiteForgePage() {
  const router = useRouter()
  const { currentProperty, loading: propertyLoading } = usePropertyContext()
  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGenerationWizard, setShowGenerationWizard] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchWebsites = useCallback(async () => {
    if (propertyLoading) {
      return
    }

    if (!currentProperty?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/siteforge/list?propertyId=${currentProperty.id}`)
      
      if (!response.ok) {
        let message = 'Failed to fetch websites'

        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
            message = payload.error
          }
        } catch {
          // Ignore parse issues and keep fallback message.
        }

        throw new Error(message)
      }

      const data = await response.json()
      setWebsites(data.websites || [])
    } catch (err) {
      console.error('Error fetching websites:', err)
      setError(err instanceof Error ? err.message : 'Failed to load websites')
    } finally {
      setLoading(false)
    }
  }, [currentProperty?.id, propertyLoading])

  useEffect(() => {
    fetchWebsites()
  }, [fetchWebsites, refreshKey])

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleGenerationComplete = (websiteId: string) => {
    router.push(`/dashboard/siteforge/${websiteId}`)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle className="w-5 h-5 text-emerald-500" />
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      case 'queued':
      case 'analyzing_brand':
      case 'planning_architecture':
      case 'generating_content':
      case 'preparing_assets':
      case 'deploying':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      default:
        return <Clock className="w-5 h-5 text-gray-400" />
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      queued: 'Queued',
      analyzing_brand: 'Analyzing Brand',
      planning_architecture: 'Planning Architecture',
      generating_content: 'Generating Content',
      preparing_assets: 'Preparing Assets',
      deploying: 'Deploying',
      complete: 'Complete',
      failed: 'Failed'
    }
    return labels[status] || status
  }

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
      case 'failed':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
      case 'queued':
      case 'analyzing_brand':
      case 'planning_architecture':
      case 'generating_content':
      case 'preparing_assets':
      case 'deploying':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-600'
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return null
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    } catch {
      return null
    }
  }

  const getWebsiteTitle = (website: Website, index: number) => {
    if (website.version && website.version > 1) {
      return `Website v${website.version}`
    }
    const formattedDate = formatDate(website.createdAt)
    if (formattedDate) {
      return `Website - ${formattedDate.split(',')[0]}`
    }
    return `Website #${index + 1}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Globe className="w-7 h-7 text-indigo-500" />
            <span className="text-gray-900 dark:text-gray-900">SiteForge</span>
          </h1>
          <p className="text-gray-700 dark:text-gray-300 mt-1">
            AI-powered WordPress website generation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowGenerationWizard(true)}
            disabled={!currentProperty || propertyLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Generate Website
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">Error loading websites</p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* No Property Selected */}
      {!currentProperty && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="h-16 w-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Globe size={32} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No property selected
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
            Select a property from the dropdown to view and generate websites.
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && currentProperty && websites.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="h-16 w-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Globe size={32} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No websites yet
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
            Generate your first AI-powered WordPress website in just 3 minutes.
          </p>
          <button
            onClick={() => setShowGenerationWizard(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            <Sparkles size={18} />
            Generate Your First Website
          </button>
        </div>
      )}

      {/* Websites Grid - ALWAYS show when property selected and not loading */}
      {!loading && currentProperty && websites.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {websites.map((website, index) => (
            <div
              key={website.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border hover:shadow-lg transition-all group ${
                website.generationStatus === 'complete' 
                  ? 'border-emerald-200 dark:border-emerald-800' 
                  : website.generationStatus === 'failed'
                  ? 'border-red-200 dark:border-red-800'
                  : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
              }`}
            >
              <div className="p-6">
                {/* Header with Title and Status */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                      {getWebsiteTitle(website, index)}
                    </h3>
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${getStatusBadgeStyle(website.generationStatus)}`}>
                      {getStatusIcon(website.generationStatus)}
                      {getStatusLabel(website.generationStatus)}
                    </span>
                  </div>
                  {website.brandSource && (
                    <span className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full capitalize">
                      {website.brandSource}
                    </span>
                  )}
                </div>

                {/* Progress Bar (for generating) */}
                {website.generationStatus !== 'complete' && website.generationStatus !== 'failed' && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>{website.currentStep ? getStatusLabel(website.currentStep) : 'Processing...'}</span>
                      <span>{website.generationProgress}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all duration-500"
                        style={{ width: `${website.generationProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error Message for Failed */}
                {website.generationStatus === 'failed' && website.errorMessage && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800">
                    <p className="text-xs text-red-600 dark:text-red-400">
                      <strong>Error:</strong> {website.errorMessage}
                    </p>
                  </div>
                )}

                {/* Success indicator for Complete */}
                {website.generationStatus === 'complete' && (
                  <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-800">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle size={14} />
                      Website generated successfully
                    </p>
                  </div>
                )}

                {/* Website Info */}
                {website.wpUrl && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Website URL</p>
                    <a
                      href={website.wpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center gap-1 group-hover:underline truncate"
                    >
                      {website.wpUrl.replace('https://', '')}
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </a>
                  </div>
                )}

                {/* Brand Confidence */}
                {website.brandConfidence !== null && website.brandConfidence !== undefined && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Brand Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${website.brandConfidence * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {Math.round(website.brandConfidence * 100)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  {formatDate(website.createdAt) && (
                    <p>Created: {formatDate(website.createdAt)}</p>
                  )}
                  {website.generationCompletedAt && formatDate(website.generationCompletedAt) && (
                    <p>Completed: {formatDate(website.generationCompletedAt)}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <button
                    onClick={() => router.push(`/dashboard/siteforge/${website.id}`)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                  >
                    <Eye size={14} />
                    View Details
                  </button>
                  {website.wpUrl && website.generationStatus === 'complete' && (
                    <button
                      onClick={() => window.open(website.wpUrl!, '_blank')}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
                    >
                      <ExternalLink size={14} />
                      Visit Site
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generation Wizard Modal */}
      {showGenerationWizard && currentProperty && (
        <ConversationalGenerationWizard
          propertyId={currentProperty.id}
          propertyName={currentProperty.name}
          open={showGenerationWizard}
          onClose={() => setShowGenerationWizard(false)}
        />
      )}
    </div>
  )
}
