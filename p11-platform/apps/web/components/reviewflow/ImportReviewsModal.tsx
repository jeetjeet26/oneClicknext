'use client'

import { useState, useEffect } from 'react'
import { 
  X, Upload, Loader2, FileText, Globe, Check, AlertCircle,
  ChevronRight, ExternalLink, Info, Search, RefreshCw
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { PlatformIcon } from './PlatformIcon'

interface ImportReviewsModalProps {
  propertyId: string
  onClose: () => void
  onImported: () => void
}

interface PropertyData {
  name: string
  address: {
    street?: string
    city?: string
    state?: string
    zip?: string
    full?: string
  } | null
}

type ImportMethod = 'manual' | 'csv' | 'google-api' | 'google-scraper' | 'yelp'
type ImportStep = 'select' | 'configure' | 'importing' | 'complete'

interface ManualReview {
  platform: string
  reviewerName: string
  rating: number
  reviewText: string
  reviewDate: string
}

const PLATFORMS = [
  { id: 'google', name: 'Google', color: 'text-blue-500' },
  { id: 'yelp', name: 'Yelp', color: 'text-red-500' },
  { id: 'apartments_com', name: 'Apartments.com', color: 'text-green-500' },
  { id: 'facebook', name: 'Facebook', color: 'text-blue-600' },
]

function isPropertyAddress(value: unknown): value is PropertyData['address'] {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function ImportReviewsModal({ propertyId, onClose, onImported }: ImportReviewsModalProps) {
  const supabase = createClient()
  const [step, setStep] = useState<ImportStep>('select')
  const [method, setMethod] = useState<ImportMethod | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [limitationNote, setLimitationNote] = useState<string | null>(null)
  
  // Property data (fetched on mount)
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null)
  
  // Manual entry
  const [manualReview, setManualReview] = useState<ManualReview>({
    platform: 'google',
    reviewerName: '',
    rating: 5,
    reviewText: '',
    reviewDate: new Date().toISOString().split('T')[0]
  })
  
  // CSV upload
  const [csvFile, setCsvFile] = useState<File | null>(null)
  
  // Google connection
  const [googleInputMethod, setGoogleInputMethod] = useState<'search' | 'placeid'>('search')
  const [googlePlaceId, setGooglePlaceId] = useState('')
  const [googlePropertyName, setGooglePropertyName] = useState('')
  const [googleAddress, setGoogleAddress] = useState('')
  const [googleConnectionType, setGoogleConnectionType] = useState<'api' | 'scraper'>('scraper') // Default to full scrape
  
  // Fetch property data on mount
  useEffect(() => {
    async function fetchProperty() {
      const { data, error } = await supabase
        .from('properties')
        .select('name, address')
        .eq('id', propertyId)
        .single()
      
      if (data && !error) {
        const address = isPropertyAddress(data.address) ? data.address : null
        setPropertyData({
          name: data.name,
          address,
        })
        
        // Pre-populate Google search fields
        setGooglePropertyName(data.name || '')
        
        // Format address from JSON
        if (address) {
          const addr = address
          if (addr?.full) {
            setGoogleAddress(addr.full)
          } else if (addr?.street) {
            const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean)
            setGoogleAddress(parts.join(' '))
          }
        }
      }
    }
    
    if (propertyId) {
      fetchProperty()
    }
  }, [propertyId, supabase])
  
  const [searchingGoogle, setSearchingGoogle] = useState(false)
  const [foundPlaceId, setFoundPlaceId] = useState<string | null>(null)
  const [foundPlaceName, setFoundPlaceName] = useState<string | null>(null)
  
  // Yelp connection
  const [yelpInput, setYelpInput] = useState('')
  const [yelpInputType, setYelpInputType] = useState<'url' | 'id'>('url')

  const handleMethodSelect = (selectedMethod: ImportMethod) => {
    setMethod(selectedMethod)
    setStep('configure')
    setError(null)
  }

  const handleManualSubmit = async () => {
    if (!manualReview.reviewText.trim()) {
      setError('Review text is required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/reviewflow/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          platform: manualReview.platform,
          reviewerName: manualReview.reviewerName || null,
          rating: manualReview.rating,
          reviewText: manualReview.reviewText,
          reviewDate: manualReview.reviewDate
        })
      })

      if (!res.ok) {
        throw new Error('Failed to import review')
      }

      // Auto-analyze the review
      const data = await res.json()
      await fetch('/api/reviewflow/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: data.review.id })
      })

      setImportedCount(1)
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile) {
      setError('Please select a CSV file')
      return
    }

    setLoading(true)
    setStep('importing')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', csvFile)
      formData.append('propertyId', propertyId)

      const res = await fetch('/api/reviewflow/import', {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'CSV import failed')
      }

      const data = await res.json()
      setImportedCount(data.imported || 0)
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('configure')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSearch = async () => {
    if (!googlePropertyName.trim() || !googleAddress.trim()) {
      setError('Property name and address are required')
      return
    }

    setSearchingGoogle(true)
    setError(null)
    setFoundPlaceId(null)
    setFoundPlaceName(null)

    try {
      const dataEngineUrl = process.env.NEXT_PUBLIC_DATA_ENGINE_URL || 'http://localhost:8000'
      const res = await fetch(`${dataEngineUrl}/scraper/google-reviews/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: googlePropertyName,
          address: googleAddress
        })
      })

      const data = await res.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Property not found on Google')
      }

      setFoundPlaceId(data.place_id)
      setFoundPlaceName(data.place_name)
      setGooglePlaceId(data.place_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearchingGoogle(false)
    }
  }

  const handleGoogleConnect = async () => {
    const placeIdToUse = googleInputMethod === 'search' ? foundPlaceId : googlePlaceId

    if (!placeIdToUse?.trim()) {
      if (googleInputMethod === 'search') {
        setError('Please search for your property first')
      } else {
        setError('Google Place ID is required')
      }
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Save the connection
      const res = await fetch('/api/reviewflow/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          platform: 'google',
          placeId: placeIdToUse,
          connectionType: googleConnectionType,
          syncFrequency: 'hourly'
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to connect Google')
      }

      // Trigger initial sync
      setStep('importing')
      const syncRes = await fetch('/api/reviewflow/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          platform: 'google',
          method: googleConnectionType
        })
      })

      const syncData = await syncRes.json()
      
      if (syncRes.ok) {
        setImportedCount(syncData.imported || 0)
        if (syncData.note) {
          setLimitationNote(syncData.note)
        }
      } else {
        throw new Error(syncData.error || 'Sync failed')
      }

      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setStep('configure')
    } finally {
      setLoading(false)
    }
  }

  const handleYelpConnect = async () => {
    if (!yelpInput.trim()) {
      setError(yelpInputType === 'url' ? 'Yelp URL is required' : 'Yelp Business ID is required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Create connection with the appropriate field
      const connectionBody: Record<string, unknown> = {
        propertyId,
        platform: 'yelp',
        connectionType: 'api',
        syncFrequency: 'daily',
        limitationNote: 'Yelp API returns only 3 most recent reviews per business'
      }

      if (yelpInputType === 'url') {
        connectionBody.yelpBusinessUrl = yelpInput
      } else {
        connectionBody.yelpBusinessId = yelpInput
      }

      const res = await fetch('/api/reviewflow/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionBody)
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to connect Yelp')
      }

      // Trigger initial sync
      setStep('importing')
      const syncRes = await fetch('/api/reviewflow/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          platform: 'yelp'
        })
      })

      const syncData = await syncRes.json()
      
      if (syncRes.ok) {
        setImportedCount(syncData.imported || 0)
        setLimitationNote('Yelp API returns only 3 most recent reviews. Your business may have more reviews on Yelp.')
      } else {
        throw new Error(syncData.error || 'Sync failed')
      }

      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setStep('configure')
    } finally {
      setLoading(false)
    }
  }

  const renderStepContent = () => {
    switch (step) {
      case 'select':
        return (
          <div className="space-y-4">
            <p className="text-slate-600 dark:text-slate-400">
              Choose how you want to import reviews into ReviewFlow:
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleMethodSelect('manual')}
                className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-rose-300 dark:hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all text-left group"
              >
                <FileText className="w-8 h-8 text-rose-500 mb-3" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Manual Entry</h3>
                <p className="text-sm text-slate-500 mt-1">Add reviews one at a time</p>
              </button>
              
              <button
                onClick={() => handleMethodSelect('csv')}
                className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-rose-300 dark:hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all text-left group"
              >
                <Upload className="w-8 h-8 text-rose-500 mb-3" />
                <h3 className="font-semibold text-slate-900 dark:text-white">CSV Upload</h3>
                <p className="text-sm text-slate-500 mt-1">Bulk import from spreadsheet</p>
              </button>
              
              <button
                onClick={() => handleMethodSelect('google-api')}
                className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-rose-300 dark:hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all text-left group"
              >
                <Globe className="w-8 h-8 text-blue-500 mb-3" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Google Business</h3>
                <p className="text-sm text-slate-500 mt-1">Connect via Place ID</p>
              </button>
              
              <button
                onClick={() => handleMethodSelect('yelp')}
                className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-rose-300 dark:hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all text-left group"
              >
                <Globe className="w-8 h-8 text-red-500 mb-3" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Yelp</h3>
                <p className="text-sm text-slate-500 mt-1">Connect via Business URL</p>
                <span className="inline-block mt-2 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                  Max 3 reviews
                </span>
              </button>
            </div>
          </div>
        )

      case 'configure':
        if (method === 'manual') {
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => { setStep('select'); setMethod(null) }} className="text-slate-400 hover:text-slate-600">
                  Import
                </button>
                <ChevronRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-900 dark:text-white font-medium">Manual Entry</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Platform
                </label>
                <div className="flex gap-2">
                  {PLATFORMS.map((platform) => (
                    <button
                      key={platform.id}
                      onClick={() => setManualReview({ ...manualReview, platform: platform.id })}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors ${
                        manualReview.platform === platform.id
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10'
                          : 'border-slate-200 dark:border-slate-600'
                      }`}
                    >
                      <PlatformIcon platform={platform.id} size={16} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Reviewer Name (optional)
                  </label>
                  <input
                    type="text"
                    value={manualReview.reviewerName}
                    onChange={(e) => setManualReview({ ...manualReview, reviewerName: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                    placeholder="John D."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Rating
                  </label>
                  <select
                    value={manualReview.rating}
                    onChange={(e) => setManualReview({ ...manualReview, rating: Number(e.target.value) })}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                  >
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r}>{r} Stars</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Review Date
                </label>
                <input
                  type="date"
                  value={manualReview.reviewDate}
                  onChange={(e) => setManualReview({ ...manualReview, reviewDate: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Review Text <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={manualReview.reviewText}
                  onChange={(e) => setManualReview({ ...manualReview, reviewText: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 resize-none"
                  placeholder="Paste the review content here..."
                />
              </div>

              <button
                onClick={handleManualSubmit}
                disabled={loading || !manualReview.reviewText.trim()}
                className="w-full py-3 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
                ) : (
                  <>Import Review</>
                )}
              </button>
            </div>
          )
        }

        if (method === 'csv') {
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => { setStep('select'); setMethod(null) }} className="text-slate-400 hover:text-slate-600">
                  Import
                </button>
                <ChevronRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-900 dark:text-white font-medium">CSV Upload</span>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
                <h4 className="font-medium text-slate-900 dark:text-white mb-2">CSV Format Requirements</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                  Your CSV file should have the following columns:
                </p>
                <code className="block bg-white dark:bg-slate-900 p-3 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                  platform, reviewer_name, rating, review_text, review_date
                </code>
              </div>

              <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
                {csvFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-rose-500" />
                    <div className="text-left">
                      <p className="font-medium text-slate-900 dark:text-white">{csvFile.name}</p>
                      <p className="text-sm text-slate-500">{(csvFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={() => setCsvFile(null)}
                      className="p-1 text-slate-400 hover:text-red-500"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-600 dark:text-slate-400 mb-2">
                      Drag & drop your CSV file here, or
                    </p>
                    <label className="inline-block px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      />
                      Browse Files
                    </label>
                  </>
                )}
              </div>

              <button
                onClick={handleCsvUpload}
                disabled={loading || !csvFile}
                className="w-full py-3 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                ) : (
                  <>Upload & Import</>
                )}
              </button>
            </div>
          )
        }

        if (method === 'google-api' || method === 'google-scraper') {
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => { setStep('select'); setMethod(null) }} className="text-slate-400 hover:text-slate-600">
                  Import
                </button>
                <ChevronRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-900 dark:text-white font-medium">Google Business</span>
              </div>

              {/* Input Method Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  How would you like to connect?
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setGoogleInputMethod('search'); setFoundPlaceId(null); setFoundPlaceName(null) }}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      googleInputMethod === 'search'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      Search by Name
                    </div>
                    <p className="text-xs text-slate-500 mt-1">We&apos;ll find your property on Google</p>
                  </button>
                  <button
                    onClick={() => setGoogleInputMethod('placeid')}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      googleInputMethod === 'placeid'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      Enter Place ID
                    </div>
                    <p className="text-xs text-slate-500 mt-1">If you already have your Place ID</p>
                  </button>
                </div>
              </div>

              {/* Search by Name/Address */}
              {googleInputMethod === 'search' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Property Name <span className="text-red-500">*</span>
                      {propertyData?.name && <span className="text-xs text-green-500 ml-2">✓ Auto-filled</span>}
                    </label>
                    <input
                      type="text"
                      value={googlePropertyName}
                      onChange={(e) => { setGooglePropertyName(e.target.value); setFoundPlaceId(null) }}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      placeholder="The Domain at Wills Crossing"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Address <span className="text-red-500">*</span>
                      {propertyData?.address && <span className="text-xs text-green-500 ml-2">✓ Auto-filled</span>}
                    </label>
                    <input
                      type="text"
                      value={googleAddress}
                      onChange={(e) => { setGoogleAddress(e.target.value); setFoundPlaceId(null) }}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                      placeholder="1234 Main Street, Austin, TX 78701"
                    />
                  </div>

                  {!foundPlaceId && (
                    <button
                      onClick={handleGoogleSearch}
                      disabled={searchingGoogle || !googlePropertyName.trim() || !googleAddress.trim()}
                      className="w-full py-2.5 border-2 border-blue-500 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {searchingGoogle ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Searching Google...</>
                      ) : (
                        <><Search className="w-4 h-4" /> Find Property on Google</>
                      )}
                    </button>
                  )}

                  {foundPlaceId && (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-300 mb-2">
                        <Check className="w-5 h-5" />
                        <span className="font-medium">Property Found!</span>
                      </div>
                      <p className="text-sm text-green-600 dark:text-green-400">
                        <strong>{foundPlaceName}</strong>
                      </p>
                      <p className="text-xs text-green-500 mt-1 font-mono">
                        Place ID: {foundPlaceId}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Direct Place ID Entry */}
              {googleInputMethod === 'placeid' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Google Place ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={googlePlaceId}
                    onChange={(e) => setGooglePlaceId(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 font-mono text-sm"
                    placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Find it on <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline inline-flex items-center gap-1">Place ID Finder <ExternalLink className="w-3 h-3" /></a>
                  </p>
                </div>
              )}

              {/* Connection Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Sync Method
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setGoogleConnectionType('api')}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      googleConnectionType === 'api'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white">Quick (5 reviews)</div>
                    <p className="text-xs text-slate-500 mt-1">Fast, uses Google API</p>
                  </button>
                  <button
                    onClick={() => setGoogleConnectionType('scraper')}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      googleConnectionType === 'scraper'
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white">Full Scrape ✨</div>
                    <p className="text-xs text-slate-500 mt-1">Gets ALL reviews (slower)</p>
                  </button>
                </div>
              </div>

              <button
                onClick={handleGoogleConnect}
                disabled={loading || (googleInputMethod === 'search' ? !foundPlaceId : !googlePlaceId.trim())}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
                ) : (
                  <><RefreshCw className="w-4 h-4" /> Connect & Sync Reviews</>
                )}
              </button>
            </div>
          )
        }

        if (method === 'yelp') {
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => { setStep('select'); setMethod(null) }} className="text-slate-400 hover:text-slate-600">
                  Import
                </button>
                <ChevronRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-900 dark:text-white font-medium">Yelp</span>
              </div>

              {/* Yelp Limitation Warning */}
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                <h4 className="font-medium text-amber-900 dark:text-amber-100 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Yelp API Limitation
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Yelp&apos;s API returns <strong>only the 3 most recent reviews</strong> per business. This is a Yelp restriction, not a bug. Your business may have more reviews on Yelp.com.
                </p>
              </div>

              {/* Input Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Connect Using
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setYelpInputType('url')}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      yelpInputType === 'url'
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white">Yelp URL</div>
                    <p className="text-xs text-slate-500 mt-1">Paste your Yelp business page URL</p>
                  </button>
                  <button
                    onClick={() => setYelpInputType('id')}
                    className={`p-3 border rounded-lg text-left transition-all ${
                      yelpInputType === 'id'
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900 dark:text-white">Business ID</div>
                    <p className="text-xs text-slate-500 mt-1">Enter your Yelp Business ID</p>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {yelpInputType === 'url' ? 'Yelp Business URL' : 'Yelp Business ID'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={yelpInput}
                  onChange={(e) => setYelpInput(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                  placeholder={yelpInputType === 'url' 
                    ? 'https://www.yelp.com/biz/your-business-name' 
                    : 'your-business-name-city'
                  }
                />
                <p className="text-xs text-slate-500 mt-1">
                  {yelpInputType === 'url' 
                    ? 'Example: https://www.yelp.com/biz/the-domain-at-wills-crossing-austin'
                    : 'Example: the-domain-at-wills-crossing-austin'
                  }
                </p>
              </div>

              <button
                onClick={handleYelpConnect}
                disabled={loading || !yelpInput.trim()}
                className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
                ) : (
                  <><RefreshCw className="w-4 h-4" /> Connect & Sync Reviews</>
                )}
              </button>
            </div>
          )
        }

        return null

      case 'importing':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-rose-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Importing Reviews...
            </h3>
            <p className="text-slate-500">
              Fetching and analyzing reviews. This may take a moment.
            </p>
          </div>
        )

      case 'complete':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Import Complete!
            </h3>
            <p className="text-slate-500 mb-4">
              Successfully imported {importedCount} review{importedCount !== 1 ? 's' : ''}.
            </p>
            
            {limitationNote && (
              <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-300 text-sm">
                <Info className="w-4 h-4 inline mr-2" />
                {limitationNote}
              </div>
            )}
            
            <button
              onClick={() => {
                onImported()
                onClose()
              }}
              className="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700"
            >
              View Reviews
            </button>
          </div>
        )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            Import Reviews
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          
          {renderStepContent()}
        </div>
      </div>
    </div>
  )
}
