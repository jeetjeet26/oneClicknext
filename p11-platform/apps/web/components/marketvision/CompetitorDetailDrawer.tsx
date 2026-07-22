'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Building2,
  MapPin,
  Phone,
  ExternalLink,
  Calendar,
  Home,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Edit2,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Link2,
  Sparkles,
  ClipboardPaste,
  Eye,
  Save,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react'

interface CompetitorUnit {
  id: string
  unitType: string
  bedrooms: number
  bathrooms: number
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  availableCount: number
  moveInSpecials: string | null
  lastUpdatedAt: string
}

interface Competitor {
  id: string
  propertyId?: string
  name: string
  address: string | null
  websiteUrl: string | null
  phone: string | null
  unitsCount: number | null
  yearBuilt: number | null
  propertyType: string
  amenities: string[]
  photos: string[]
  ilsListings?: Record<string, string>
  notes: string | null
  isActive: boolean
  lastScrapedAt: string | null
  units?: CompetitorUnit[]
}

interface CompetitorDetailDrawerProps {
  competitor: Competitor | null
  onClose: () => void
  onEdit: (competitor: Competitor) => void
}

interface RefreshStatus {
  loading: boolean
  message: string | null
  type: 'success' | 'error' | 'info' | null
}

interface ExtractedUnit {
  unitType: string
  bedrooms: number
  bathrooms: number
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  availableCount: number
  moveInSpecials: string | null
}

interface ExtractionResult {
  units: ExtractedUnit[]
  propertySpecials: string | null
  confidence: number
  rawDataQuality: 'high' | 'medium' | 'low'
  notes: string | null
}

interface ExtractionStatus {
  loading: boolean
  message: string | null
  type: 'success' | 'error' | 'info' | null
}

export function CompetitorDetailDrawer({ 
  competitor, 
  onClose,
  onEdit
}: CompetitorDetailDrawerProps) {
  const [units, setUnits] = useState<CompetitorUnit[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    loading: false,
    message: null,
    type: null
  })
  const [showAddAptUrl, setShowAddAptUrl] = useState(false)
  const [aptUrl, setAptUrl] = useState('')
  
  // AI Extraction state
  const [showAiExtractor, setShowAiExtractor] = useState(false)
  const [pastedContent, setPastedContent] = useState('')
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>({
    loading: false,
    message: null,
    type: null
  })
  const [extractedPreview, setExtractedPreview] = useState<ExtractionResult | null>(null)

  useEffect(() => {
    if (competitor) {
      if (competitor.units) {
        setUnits(competitor.units)
      } else {
        fetchUnits()
      }
      // Reset state when competitor changes
      setRefreshStatus({ loading: false, message: null, type: null })
      setShowAddAptUrl(false)
      setAptUrl('')
      // Reset AI extraction state
      setShowAiExtractor(false)
      setPastedContent('')
      setExtractedPreview(null)
      setExtractionStatus({ loading: false, message: null, type: null })
    }
  }, [competitor?.id])

  const fetchUnits = async () => {
    if (!competitor) return

    setLoading(true)
    try {
      const res = await fetch(`/api/marketvision/units?competitorId=${competitor.id}`)
      const data = await res.json()

      if (res.ok) {
        setUnits(data.units || [])
      }
    } catch (err) {
      console.error('Error fetching units:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshFromApartmentsCom = async () => {
    if (!competitor) return

    const apartmentsComUrl = competitor.ilsListings?.apartments_com

    if (!apartmentsComUrl) {
      setShowAddAptUrl(true)
      return
    }

    setRefreshStatus({ 
      loading: true, 
      message: 'Scraping pricing from apartments.com...', 
      type: 'info' 
    })

    try {
      const res = await fetch('/api/marketvision/apartments-com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh_single',
          competitorId: competitor.id
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Refresh failed')
      }

      // Handle different response scenarios
      if (data.scraped && data.units_scraped) {
        setRefreshStatus({
          loading: false,
          message: `Updated ${data.units_scraped} unit types from apartments.com`,
          type: 'success'
        })
        // Refresh units after a short delay
        setTimeout(() => {
          fetchUnits()
          setRefreshStatus({ loading: false, message: null, type: null })
        }, 3000)
      } else if (data.source_url) {
        // Scraping blocked but URL is saved
        setRefreshStatus({
          loading: false,
          message: data.message || 'URL saved - apartments.com is blocking automated scraping. Click the link below to view pricing.',
          type: 'info'
        })
      } else {
        setRefreshStatus({
          loading: false,
          message: data.message || 'Refresh completed',
          type: 'success'
        })
      }

    } catch (err) {
      console.error('Apartments.com refresh error:', err)
      setRefreshStatus({
        loading: false,
        message: err instanceof Error ? err.message : 'Refresh failed',
        type: 'error'
      })
    }
  }

  const handleAddApartmentsComUrl = async () => {
    if (!competitor || !aptUrl.trim()) return

    if (!aptUrl.includes('apartments.com')) {
      setRefreshStatus({
        loading: false,
        message: 'URL must be from apartments.com',
        type: 'error'
      })
      return
    }

    setRefreshStatus({
      loading: true,
      message: 'Adding apartments.com listing and scraping...',
      type: 'info'
    })

    try {
      const res = await fetch('/api/marketvision/apartments-com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_listing',
          competitorId: competitor.id,
          url: aptUrl.trim()
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add listing')
      }

      setRefreshStatus({
        loading: false,
        message: data.scraped 
          ? `Scraped ${data.unitsScraped || 0} unit types from apartments.com`
          : data.url_saved 
            ? 'URL saved! Click the link below to view pricing on apartments.com'
            : 'Apartments.com URL saved',
        type: 'success'
      })

      setShowAddAptUrl(false)
      setAptUrl('')

      // Update competitor in parent component would be ideal, for now just refresh units
      setTimeout(() => {
        fetchUnits()
        setRefreshStatus({ loading: false, message: null, type: null })
      }, 3000)

    } catch (err) {
      console.error('Add listing error:', err)
      setRefreshStatus({
        loading: false,
        message: err instanceof Error ? err.message : 'Failed to add listing',
        type: 'error'
      })
    }
  }

  const handleExtractPreview = async () => {
    if (!competitor) return
    if (!pastedContent.trim()) {
      setExtractionStatus({
        loading: false,
        message: 'Please paste content from the competitor\'s floor plans page',
        type: 'error'
      })
      return
    }

    setExtractionStatus({
      loading: true,
      message: 'Analyzing content with AI...',
      type: 'info'
    })
    setExtractedPreview(null)

    try {
      const res = await fetch('/api/marketvision/extract-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: pastedContent,
          competitorId: competitor.id,
          action: 'preview'
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Extraction failed')
      }

      setExtractedPreview({
        units: data.units,
        propertySpecials: data.propertySpecials,
        confidence: data.confidence,
        rawDataQuality: data.rawDataQuality,
        notes: data.notes
      })

      setExtractionStatus({
        loading: false,
        message: `Extracted ${data.totalExtracted} unit types (${Math.round(data.confidence * 100)}% confidence)`,
        type: 'success'
      })

    } catch (err) {
      console.error('Extraction error:', err)
      setExtractionStatus({
        loading: false,
        message: err instanceof Error ? err.message : 'Extraction failed',
        type: 'error'
      })
    }
  }

  const handleSaveExtracted = async () => {
    if (!competitor || !extractedPreview || extractedPreview.units.length === 0) return

    setExtractionStatus({
      loading: true,
      message: 'Saving extracted units...',
      type: 'info'
    })

    try {
      const res = await fetch('/api/marketvision/extract-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: pastedContent,
          competitorId: competitor.id,
          action: 'save'
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Save failed')
      }

      setExtractionStatus({
        loading: false,
        message: `Saved ${data.totalSaved} unit types successfully!`,
        type: 'success'
      })

      // Refresh units display
      setTimeout(() => {
        fetchUnits()
        setShowAiExtractor(false)
        setPastedContent('')
        setExtractedPreview(null)
        setExtractionStatus({ loading: false, message: null, type: null })
      }, 2000)

    } catch (err) {
      console.error('Save extracted error:', err)
      setExtractionStatus({
        loading: false,
        message: err instanceof Error ? err.message : 'Save failed',
        type: 'error'
      })
    }
  }

  if (!competitor) return null

  // Calculate stats
  const avgRent = units.length > 0
    ? Math.round(units.filter(u => u.rentMin).map(u => u.rentMin!).reduce((a, b) => a + b, 0) / units.filter(u => u.rentMin).length)
    : null

  const totalAvailable = units.reduce((sum, u) => sum + u.availableCount, 0)

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Building2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-lg">
              {competitor.name}
            </h2>
            {competitor.address && (
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                <MapPin className="w-3.5 h-3.5" />
                {competitor.address}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(competitor)}
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Edit2 className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 dark:bg-gray-700/30">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {avgRent ? `$${avgRent.toLocaleString()}` : '-'}
            </p>
            <p className="text-xs text-gray-500">Avg Rent</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {units.length}
            </p>
            <p className="text-xs text-gray-500">Unit Types</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {totalAvailable}
            </p>
            <p className="text-xs text-gray-500">Available</p>
          </div>
        </div>

        {/* Property Info */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Property Details
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {competitor.unitsCount && (
              <div>
                <p className="text-gray-500">Total Units</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {competitor.unitsCount}
                </p>
              </div>
            )}
            {competitor.yearBuilt && (
              <div>
                <p className="text-gray-500">Year Built</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {competitor.yearBuilt}
                </p>
              </div>
            )}
            <div>
              <p className="text-gray-500">Property Type</p>
              <p className="font-medium text-gray-900 dark:text-white capitalize">
                {competitor.propertyType}
              </p>
            </div>
            {competitor.lastScrapedAt && (
              <div>
                <p className="text-gray-500">Last Updated</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {new Date(competitor.lastScrapedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {/* Contact Links */}
          <div className="flex items-center gap-3 mt-4">
            {competitor.websiteUrl && (
              <a
                href={competitor.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Website
              </a>
            )}
            {competitor.phone && (
              <a
                href={`tel:${competitor.phone}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call
              </a>
            )}
          </div>
        </div>

        {/* Amenities */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              Amenities
            </h3>
            {competitor.amenities.length > 0 && (
              <span className="text-xs text-gray-500">
                {competitor.amenities.length} amenities
              </span>
            )}
          </div>
          {competitor.amenities.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {competitor.amenities.map((amenity, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full"
                >
                  {amenity}
                </span>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-400">No amenities recorded</p>
              <button
                onClick={() => onEdit(competitor)}
                className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Add amenities →
              </button>
            </div>
          )}
        </div>

        {/* Apartments.com Refresh Section */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              Pricing Data
            </h3>
            <button
              onClick={handleRefreshFromApartmentsCom}
              disabled={refreshStatus.loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
            >
              {refreshStatus.loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Refresh from Apartments.com
            </button>
          </div>

          {/* Status Message */}
          {refreshStatus.message && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-3 ${
              refreshStatus.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : refreshStatus.type === 'error'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            }`}>
              {refreshStatus.loading ? (
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              ) : refreshStatus.type === 'success' ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
              ) : refreshStatus.type === 'error' ? (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              ) : null}
              <span className="flex-1">{refreshStatus.message}</span>
            </div>
          )}

          {/* Add Apartments.com URL Form */}
          {showAddAptUrl && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                Add Apartments.com Listing URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={aptUrl}
                  onChange={(e) => setAptUrl(e.target.value)}
                  placeholder="https://www.apartments.com/..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={handleAddApartmentsComUrl}
                  disabled={!aptUrl.trim() || refreshStatus.loading}
                  className="px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Link2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Paste the apartments.com URL for this property to enable price tracking
              </p>
              <button
                onClick={() => setShowAddAptUrl(false)}
                className="text-xs text-gray-500 hover:text-gray-700 mt-2"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Show existing apartments.com URL */}
          {competitor.ilsListings?.apartments_com && !showAddAptUrl && (
            <a
              href={competitor.ilsListings.apartments_com}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline mb-3"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on Apartments.com
            </a>
          )}
        </div>

        {/* AI Floor Plan Extraction Section */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <button
            onClick={() => setShowAiExtractor(!showAiExtractor)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              AI Floor Plan Extractor
            </h3>
            {showAiExtractor ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {showAiExtractor && (
            <div className="mt-4 space-y-4">
              {/* Info callout */}
              <div className="flex items-start gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
                <Info className="w-4 h-4 text-violet-600 dark:text-violet-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-violet-700 dark:text-violet-300">
                  Copy & paste the floor plans page content from any competitor website. Our AI will extract unit types, pricing, and availability automatically.
                </p>
              </div>

              {/* Paste content area */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                  <ClipboardPaste className="w-3.5 h-3.5 inline mr-1" />
                  Paste Floor Plans Content
                </label>
                <textarea
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  placeholder="Copy and paste the entire floor plans / pricing section from the competitor's website here...

Example:
S1 Studio 1 Bath 598 Sq. Ft. Starting at $2,602
A1 1 Bed 1 Bath 650 Sq. Ft. Call for details
B1 2 Bed 2 Bath 1,094 Sq. Ft. Starting at $3,005 Specials Available"
                  className="w-full h-32 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {pastedContent.length} characters
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleExtractPreview}
                  disabled={extractionStatus.loading || !pastedContent.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-200 dark:hover:bg-violet-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {extractionStatus.loading && !extractedPreview ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  Preview
                </button>
                <button
                  onClick={handleSaveExtracted}
                  disabled={extractionStatus.loading || !extractedPreview || extractedPreview.units.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {extractionStatus.loading && extractedPreview ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Units
                </button>
              </div>

              {/* Extraction Status */}
              {extractionStatus.message && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  extractionStatus.type === 'success' 
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : extractionStatus.type === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                }`}>
                  {extractionStatus.loading ? (
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  ) : extractionStatus.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  ) : extractionStatus.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="flex-1">{extractionStatus.message}</span>
                </div>
              )}

              {/* Extraction Preview */}
              {extractedPreview && extractedPreview.units.length > 0 && (
                <div className="space-y-3">
                  {/* Quality indicator */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`px-2 py-1 rounded-full ${
                      extractedPreview.rawDataQuality === 'high'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : extractedPreview.rawDataQuality === 'medium'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {extractedPreview.rawDataQuality === 'high' ? '✓ High' : 
                       extractedPreview.rawDataQuality === 'medium' ? '◐ Medium' : '⚠ Low'} quality data
                    </span>
                    <span className="text-gray-500">
                      {Math.round(extractedPreview.confidence * 100)}% confidence
                    </span>
                  </div>

                  {/* Property specials */}
                  {extractedPreview.propertySpecials && (
                    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                      🎁 {extractedPreview.propertySpecials}
                    </div>
                  )}

                  {/* Units preview */}
                  <div className="text-xs font-medium text-gray-500 mb-2">
                    Preview ({extractedPreview.units.length} units):
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {extractedPreview.units.map((unit, idx) => (
                      <div
                        key={idx}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {unit.unitType}
                          </span>
                          <span className="text-gray-900 dark:text-white font-medium">
                            {unit.rentMin 
                              ? `$${unit.rentMin.toLocaleString()}${unit.rentMax && unit.rentMax !== unit.rentMin ? ` - $${unit.rentMax.toLocaleString()}` : ''}` 
                              : 'Call for pricing'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-gray-500 mt-1">
                          <span>{unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} bed`} • {unit.bathrooms} bath</span>
                          {unit.sqftMin && (
                            <span>
                              {unit.sqftMin.toLocaleString()}
                              {unit.sqftMax && unit.sqftMax !== unit.sqftMin && ` - ${unit.sqftMax.toLocaleString()}`} sf
                            </span>
                          )}
                        </div>
                        {unit.moveInSpecials && (
                          <div className="mt-1.5 text-amber-600 dark:text-amber-400">
                            🎁 {unit.moveInSpecials}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Notes from extraction */}
                  {extractedPreview.notes && (
                    <p className="text-xs text-gray-500 italic">
                      Note: {extractedPreview.notes}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unit Pricing */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Unit Types
            </h3>
            <button
              onClick={fetchUnits}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
            </div>
          ) : units.length === 0 ? (
            <div className="py-8 text-center">
              <Home className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No unit data available</p>
            </div>
          ) : (
            <div className="space-y-3">
              {units
                .sort((a, b) => a.bedrooms - b.bedrooms)
                .map((unit) => (
                  <div
                    key={unit.id}
                    className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {unit.unitType}
                        </span>
                        {unit.availableCount > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                            {unit.availableCount} available
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        {unit.rentMin ? (
                          <p className="font-semibold text-gray-900 dark:text-white">
                            ${unit.rentMin.toLocaleString()}
                            {unit.rentMax && unit.rentMax !== unit.rentMin && (
                              <span className="text-gray-500 font-normal">
                                {' '}- ${unit.rentMax.toLocaleString()}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-gray-400">No pricing</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        {unit.bedrooms} bed • {unit.bathrooms} bath
                      </span>
                      {unit.sqftMin && (
                        <span>
                          {unit.sqftMin.toLocaleString()}
                          {unit.sqftMax && unit.sqftMax !== unit.sqftMin && (
                            <> - {unit.sqftMax.toLocaleString()}</>
                          )} sq ft
                        </span>
                      )}
                      {unit.rentMin && unit.sqftMin && (
                        <span className="text-indigo-600 dark:text-indigo-400">
                          ${(unit.rentMin / unit.sqftMin).toFixed(2)}/sq ft
                        </span>
                      )}
                    </div>

                    {unit.moveInSpecials && (
                      <div className="mt-2 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300">
                        🎁 {unit.moveInSpecials}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {competitor.notes && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Notes
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {competitor.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

