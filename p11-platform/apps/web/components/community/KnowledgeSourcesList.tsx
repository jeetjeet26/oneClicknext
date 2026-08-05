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
import type { LucideIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ManualPricingModal } from './ManualPricingModal'
import { AddWebsiteUrlsModal } from './AddWebsiteUrlsModal'
import { PasteTextModal } from './PasteTextModal'
import {
  presentKnowledgeSource,
  type KnowledgeSourceRecord,
} from './knowledge-presentation'

type SourceTypeConfig = {
  icon: LucideIcon
  label: string
  color: string
}

type Props = {
  sources: KnowledgeSourceRecord[]
  documentsCount: number
  uniqueDocuments: number
  categories: Record<string, number>
  insights: string[]
  propertyId: string
  onRefresh?: () => void
  onUploadClick?: () => void
}

type ScrapeResult = {
  success: boolean
  error?: string
  units_found?: number
  property_name?: string
  floor_plans_found?: number
  amenities_found?: number
}

const SOURCE_TYPE_CONFIG: Record<string, SourceTypeConfig> = {
  intake_form: { icon: FormInput, label: 'Intake Form', color: 'text-purple-500' },
  document: { icon: FileText, label: 'Document', color: 'text-blue-500' },
  website: { icon: Globe, label: 'Website', color: 'text-emerald-500' },
  integration: { icon: Database, label: 'Integration', color: 'text-amber-500' },
  manual: { icon: FileText, label: 'Manual Entry', color: 'text-slate-500' },
  brand_book: { icon: Sparkles, label: 'Brand Book', color: 'text-fuchsia-500' },
  competitor_intelligence: { icon: Shield, label: 'Competitor Intelligence', color: 'text-cyan-500' },
}
const DEFAULT_SOURCE_TYPE_CONFIG = { icon: FileText, label: 'Other Source', color: 'text-slate-500' }

const STATUS_CONFIG: Record<string, {
  label: string
  color: string
  bgColor: string
  icon: LucideIcon
}> = {
  pending: { label: 'Pending', color: 'text-slate-400', bgColor: 'bg-slate-100', icon: Clock },
  processing: { label: 'Processing', color: 'text-blue-500', bgColor: 'bg-blue-50', icon: Loader2 },
  completed: { label: 'Processed', color: 'text-emerald-500', bgColor: 'bg-emerald-50', icon: Check },
  failed: { label: 'Failed', color: 'text-red-500', bgColor: 'bg-red-50', icon: AlertCircle },
}
const DEFAULT_STATUS_CONFIG = STATUS_CONFIG.pending

const CATEGORY_CONFIG = {
  property: { icon: Home, label: 'Property Details', color: 'text-indigo-500', bgColor: 'bg-indigo-50' },
  policies: { icon: Shield, label: 'Policies', color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
  pricing: { icon: DollarSign, label: 'Pricing', color: 'text-amber-500', bgColor: 'bg-amber-50' },
  other: { icon: FolderOpen, label: 'Other', color: 'text-slate-500', bgColor: 'bg-slate-50' },
}

function formatRelativeTimestamp(value: string): string {
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime())
    ? value
    : formatDistanceToNow(timestamp, { addSuffix: true })
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
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)
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
      const result: ScrapeResult = await response.json()
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
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                aria-label={isRefreshing ? 'Refreshing website knowledge sources' : 'Refresh website knowledge sources'}
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddWebsiteUrlsModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Add new website URLs to scrape"
            >
              <Link className="h-4 w-4" />
              Add URLs
            </button>
            <button
              type="button"
              onClick={() => setShowPasteTextModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Paste text content directly"
            >
              <Type className="h-4 w-4" />
              Paste Text
            </button>
            <button
              type="button"
              onClick={handleScrapePricing}
              disabled={isScrapingPricing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
              title="Scrape pricing and floorplan data from property website"
            >
              <DollarSign className={`h-4 w-4 ${isScrapingPricing ? 'animate-pulse' : ''}`} />
              {isScrapingPricing ? 'Scraping...' : 'Scrape Pricing'}
            </button>
            <button
              type="button"
              onClick={() => setShowManualPricingModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
              title="Extract pricing from pasted text using AI"
            >
              <FileEdit className="h-4 w-4" />
              Paste Pricing
            </button>
            <button
              type="button"
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
                ? `✓ Successfully scraped ${scrapeResult.units_found ?? 0} floor plans from ${scrapeResult.property_name ?? 'the property website'}`
                : `✗ ${scrapeResult.error}`}
            </p>
            {scrapeResult.success && (scrapeResult.floor_plans_found ?? 0) > 0 && (
              <p className="text-xs text-emerald-600 mt-1">
                Found {scrapeResult.floor_plans_found} floor plans, {scrapeResult.amenities_found ?? 0} amenities
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
                type="button"
                onClick={onUploadClick}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Upload your first document
              </button>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Knowledge sources">
              {sources.map((source) => {
                const typeConfig = SOURCE_TYPE_CONFIG[source.source_type] ?? DEFAULT_SOURCE_TYPE_CONFIG
                const statusConfig = STATUS_CONFIG[source.status] ?? DEFAULT_STATUS_CONFIG
                const TypeIcon = typeConfig.icon
                const StatusIcon = statusConfig.icon
                const presentation = presentKnowledgeSource(source)

                return (
                  <li
                    key={source.id}
                    className="flex flex-col gap-4 rounded-lg bg-slate-50 p-4 transition-colors hover:bg-slate-100 md:flex-row md:items-start md:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                        <TypeIcon className={`h-5 w-5 ${typeConfig.color}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-900">{source.source_name}</p>
                          {presentation.origin && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                presentation.origin === 'generated'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                              aria-label={`Source origin: ${presentation.origin}`}
                            >
                              {presentation.origin === 'generated' ? 'Generated' : 'Uploaded'}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Source type: {presentation.sourceTypeLabel}
                        </p>

                        {(source.file_name || source.source_url) && (
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            {source.file_name && (
                              <p className="break-all">
                                <span className="font-medium text-slate-700">File:</span> {source.file_name}
                                {source.file_type ? ` (${source.file_type})` : ''}
                              </p>
                            )}
                            {source.source_url && (
                              <p className="break-all">
                                <span className="font-medium text-slate-700">URL:</span>{' '}
                                {presentation.sourceUrlHref ? (
                                  <a
                                    href={presentation.sourceUrlHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-700"
                                  >
                                    {source.source_url}
                                  </a>
                                ) : source.source_url}
                              </p>
                            )}
                          </div>
                        )}

                        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          {presentation.documentCount !== null && (
                            <div className="flex gap-1">
                              <dt className="font-medium text-slate-600">Document chunks:</dt>
                              <dd>{presentation.documentCount}</dd>
                            </div>
                          )}
                          {presentation.ingestionVersion && (
                            <div className="flex gap-1">
                              <dt className="font-medium text-slate-600">Ingestion version:</dt>
                              <dd>{presentation.ingestionVersion}</dd>
                            </div>
                          )}
                          {presentation.lastSuccessfulAt && (
                            <div className="flex gap-1">
                              <dt className="font-medium text-slate-600">Last successful:</dt>
                              <dd>
                                <time
                                  dateTime={presentation.lastSuccessfulAt}
                                  title={new Date(presentation.lastSuccessfulAt).toLocaleString()}
                                >
                                  {formatRelativeTimestamp(presentation.lastSuccessfulAt)}
                                </time>
                              </dd>
                            </div>
                          )}
                          {presentation.lastAttemptAt && (
                            <div className="flex gap-1">
                              <dt className="font-medium text-slate-600">Last attempt:</dt>
                              <dd>
                                <time
                                  dateTime={presentation.lastAttemptAt}
                                  title={new Date(presentation.lastAttemptAt).toLocaleString()}
                                >
                                  {formatRelativeTimestamp(presentation.lastAttemptAt)}
                                </time>
                              </dd>
                            </div>
                          )}
                        </dl>

                        {presentation.identities.length > 0 && (
                          <dl className="mt-2 space-y-1 text-xs text-slate-500" aria-label="Source provenance identities">
                            {presentation.identities.map(identity => (
                              <div key={`${identity.label}:${identity.value}`} className="flex min-w-0 gap-1">
                                <dt className="flex-shrink-0 font-medium text-slate-600">{identity.label}:</dt>
                                <dd className="break-all font-mono">{identity.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}

                        {source.error_message && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700" role="alert">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                            <span>{source.error_message}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`inline-flex w-fit flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
                      aria-label={`Source status: ${statusConfig.label}`}
                    >
                      <StatusIcon
                        className={`h-3 w-3 ${source.status === 'processing' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      {statusConfig.label}
                    </span>
                  </li>
                )
              })}
            </ul>
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

