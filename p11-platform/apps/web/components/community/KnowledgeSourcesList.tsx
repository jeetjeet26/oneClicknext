'use client'

import { useState } from 'react'
import {
  FileText,
  Globe,
  Database,
  FormInput,
  Upload,
  RefreshCw,
  Loader2,
  ChevronRight,
  Check,
  AlertCircle,
  Clock,
  Sparkles,
  FolderOpen,
  Home,
  Shield,
  DollarSign,
  FileEdit,
  Link,
  Type
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ManualPricingModal } from './ManualPricingModal'
import { AddWebsiteUrlsModal } from './AddWebsiteUrlsModal'
import { PasteTextModal } from './PasteTextModal'

type KnowledgeSource = {
  id: string
  property_id: string
  source_type: 'intake_form' | 'document' | 'website' | 'integration' | 'manual'
  source_name: string
  source_url: string | null
  file_name: string | null
  file_type: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  documents_created: number
  extracted_data: Record<string, unknown>
  last_synced_at: string | null
  error_message: string | null
  created_at: string
}

type Props = {
  sources: KnowledgeSource[]
  documentsCount: number
  uniqueDocuments: number
  categories: Record<string, number>
  insights: string[]
  propertyId: string
  onRefresh?: () => void
  onUploadClick?: () => void
}

const SOURCE_TYPE_CONFIG = {
  intake_form: { icon: FormInput, label: 'Intake Form', color: 'text-purple-500' },
  document: { icon: FileText, label: 'Document', color: 'text-blue-500' },
  website: { icon: Globe, label: 'Website', color: 'text-emerald-500' },
  integration: { icon: Database, label: 'Integration', color: 'text-amber-500' },
  manual: { icon: FileText, label: 'Manual Entry', color: 'text-slate-500' },
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'text-slate-400', bgColor: 'bg-slate-100', icon: Clock },
  processing: { label: 'Processing', color: 'text-blue-500', bgColor: 'bg-blue-50', icon: Loader2 },
  completed: { label: 'Processed', color: 'text-emerald-500', bgColor: 'bg-emerald-50', icon: Check },
  failed: { label: 'Failed', color: 'text-red-500', bgColor: 'bg-red-50', icon: AlertCircle },
}

const CATEGORY_CONFIG = {
  property: { icon: Home, label: 'Property Details', color: 'text-indigo-500', bgColor: 'bg-indigo-50' },
  policies: { icon: Shield, label: 'Policies', color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
  pricing: { icon: DollarSign, label: 'Pricing', color: 'text-amber-500', bgColor: 'bg-amber-50' },
  other: { icon: FolderOpen, label: 'Other', color: 'text-slate-500', bgColor: 'bg-slate-50' },
}

export function KnowledgeSourcesList({ 
  sources, 
  documentsCount, 
  uniqueDocuments, 
  categories, 
  insights,
  propertyId,
  onRefresh,
  onUploadClick
}: Props) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isScrapingPricing, setIsScrapingPricing] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<any>(null)
  const [showManualPricingModal, setShowManualPricingModal] = useState(false)
  const [showAddWebsiteUrlsModal, setShowAddWebsiteUrlsModal] = useState(false)
  const [showPasteTextModal, setShowPasteTextModal] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await fetch('/api/cron/knowledge-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      })
      onRefresh?.()
    } catch (error) {
      console.error('Error refreshing knowledge:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleScrapePricing = async () => {
    setIsScrapingPricing(true)
    setScrapeResult(null)
    try {
      const response = await fetch('/api/properties/scrape-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      })
      const result = await response.json()
      setScrapeResult(result)
      
      if (result.success) {
        // Optionally refresh the page data
        onRefresh?.()
      }
    } catch (error) {
      console.error('Error scraping pricing:', error)
      setScrapeResult({ success: false, error: 'Failed to scrape pricing' })
    } finally {
      setIsScrapingPricing(false)
    }
  }

  const hasWebsiteSource = sources.some(s => s.source_type === 'website')

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-indigo-50 rounded-lg flex items-center justify-center">
              <Database className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{documentsCount}</p>
              <p className="text-xs text-slate-500">Total Chunks</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-emerald-50 rounded-lg flex items-center justify-center">
              <FileText className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{uniqueDocuments}</p>
              <p className="text-xs text-slate-500">Documents</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <Globe className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{sources.length}</p>
              <p className="text-xs text-slate-500">Sources</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{insights.length}</p>
              <p className="text-xs text-slate-500">Insights</p>
            </div>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Categories</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
            const count = categories[key] || 0
            const Icon = config.icon
            return (
              <div
                key={key}
                className={`${config.bgColor} rounded-lg p-4 text-center`}
              >
                <Icon className={`h-6 w-6 ${config.color} mx-auto mb-2`} />
                <p className="text-sm font-medium text-slate-900">{config.label}</p>
                <p className="text-xs text-slate-500">{count} item{count !== 1 ? 's' : ''}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* AI Insights */}
      {insights.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-6">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            AI Insights
          </h3>
          <div className="space-y-2">
            {insights.map((insight, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 p-3 bg-white rounded-lg border border-indigo-100"
              >
                <div className="h-5 w-5 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3 w-3 text-indigo-600" />
                </div>
                <p className="text-sm text-slate-700">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources List */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-slate-400" />
            Knowledge Sources
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {hasWebsiteSource && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <button
              onClick={() => setShowAddWebsiteUrlsModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Add new website URLs to scrape"
            >
              <Link className="h-4 w-4" />
              Add URLs
            </button>
            <button
              onClick={() => setShowPasteTextModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Paste text content directly"
            >
              <Type className="h-4 w-4" />
              Paste Text
            </button>
            <button
              onClick={handleScrapePricing}
              disabled={isScrapingPricing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
              title="Scrape pricing and floorplan data from property website"
            >
              <DollarSign className={`h-4 w-4 ${isScrapingPricing ? 'animate-pulse' : ''}`} />
              {isScrapingPricing ? 'Scraping...' : 'Scrape Pricing'}
            </button>
            <button
              onClick={() => setShowManualPricingModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
              title="Extract pricing from pasted text using AI"
            >
              <FileEdit className="h-4 w-4" />
              Paste Pricing
            </button>
            <button
              onClick={onUploadClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        </div>

        {/* Scrape result notification */}
        {scrapeResult && (
          <div className={`mx-6 mt-4 p-3 rounded-lg ${
            scrapeResult.success 
              ? 'bg-emerald-50 border border-emerald-200' 
              : 'bg-red-50 border border-red-200'
          }`}>
            <p className={`text-sm font-medium ${
              scrapeResult.success ? 'text-emerald-700' : 'text-red-700'
            }`}>
              {scrapeResult.success 
                ? `✓ Successfully scraped ${scrapeResult.units_found} floor plans from ${scrapeResult.property_name}` 
                : `✗ ${scrapeResult.error}`}
            </p>
            {scrapeResult.success && scrapeResult.floor_plans_found > 0 && (
              <p className="text-xs text-emerald-600 mt-1">
                Found {scrapeResult.floor_plans_found} floor plans, {scrapeResult.amenities_found} amenities
              </p>
            )}
          </div>
        )}

        <div className="p-6">
          {sources.length === 0 ? (
            <div className="text-center py-8">
              <Database className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No knowledge sources yet</p>
              <button
                onClick={onUploadClick}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Upload your first document
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {sources.map((source) => {
                const typeConfig = SOURCE_TYPE_CONFIG[source.source_type]
                const statusConfig = STATUS_CONFIG[source.status]
                const TypeIcon = typeConfig.icon
                const StatusIcon = statusConfig.icon

                return (
                  <div
                    key={source.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center border border-slate-200">
                        <TypeIcon className={`h-5 w-5 ${typeConfig.color}`} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{source.source_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">{typeConfig.label}</span>
                          {source.documents_created > 0 && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-500">{source.documents_created} chunks</span>
                            </>
                          )}
                          {source.last_synced_at && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-400">
                                {formatDistanceToNow(new Date(source.last_synced_at), { addSuffix: true })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
                      <StatusIcon className={`h-3 w-3 ${source.status === 'processing' ? 'animate-spin' : ''}`} />
                      {statusConfig.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Manual Pricing Modal */}
      {showManualPricingModal && (
        <ManualPricingModal
          propertyId={propertyId}
          onClose={() => setShowManualPricingModal(false)}
          onSuccess={() => {
            setShowManualPricingModal(false)
            onRefresh?.()
          }}
        />
      )}

      {/* Add Website URLs Modal */}
      {showAddWebsiteUrlsModal && (
        <AddWebsiteUrlsModal
          propertyId={propertyId}
          onClose={() => setShowAddWebsiteUrlsModal(false)}
          onSuccess={() => {
            setShowAddWebsiteUrlsModal(false)
            onRefresh?.()
          }}
        />
      )}

      {/* Paste Text Modal */}
      {showPasteTextModal && (
        <PasteTextModal
          propertyId={propertyId}
          onClose={() => setShowPasteTextModal(false)}
          onSuccess={() => {
            setShowPasteTextModal(false)
            onRefresh?.()
          }}
        />
      )}
    </div>
  )
}

