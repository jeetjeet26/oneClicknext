'use client'

import { MapPin, ArrowRight, ArrowLeft, Globe, Building, Calendar, Hash, Sparkles, Loader2, CheckCircle2, AlertTriangle, Wand2, Plus, X, Link } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useOnboarding } from '../components/OnboardingProvider'
import { AMENITY_OPTIONS, WebsiteScrapeResult } from '../types'
import { PROPERTY_TYPE_OPTIONS } from '@/utils/property-types'

interface ScrapeStatus {
  status: 'idle' | 'scraping' | 'success' | 'error'
  message?: string
  result?: WebsiteScrapeResult
}

// Component name kept as CommunityStep for backward compatibility
// but UI text updated to use "Property" terminology
export function CommunityStep() {
  const { formData, updateCommunity, updateFormData, error, setError, canProceed, goToNextStep, goToPreviousStep } = useOnboarding()
  // Using 'community' internally for compatibility, but representing a property
  const { community } = formData
  const [showAmenities, setShowAmenities] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>({ status: 'idle' })

    const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!community.name.trim()) {
      setError('Property name is required')
      return
    }
    setError(null)
    goToNextStep()
  }

  const toggleAmenity = (amenity: string) => {
    const current = community.amenities || []
    if (current.includes(amenity)) {
      updateCommunity({ amenities: current.filter(a => a !== amenity) })
    } else {
      updateCommunity({ amenities: [...current, amenity] })
    }
  }

  const removeUrlAtIndex = (index: number) => {
    const current = community.additionalUrls || []
    updateCommunity({ additionalUrls: current.filter((_, i) => i !== index) })
  }

  const handleScrapeWebsite = useCallback(async () => {
    // Collect all URLs to scrape (filter out empty strings)
    const urlsToScrape: string[] = []
    if (community.websiteUrl?.trim()) {
      urlsToScrape.push(community.websiteUrl.trim())
    }
    if (community.additionalUrls?.length) {
      urlsToScrape.push(...community.additionalUrls.filter(u => u.trim()))
    }

    if (urlsToScrape.length === 0) {
      setError('Please enter at least one URL to scrape')
      return
    }

    setScrapeStatus({ status: 'scraping', message: `Analyzing ${urlsToScrape.length} page(s)...` })
    setError(null)

    try {
      const response = await fetch('/api/onboarding/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlsToScrape }),
      })

      const result: WebsiteScrapeResult = await response.json()

      if (!response.ok || result.error) {
        setScrapeStatus({ 
          status: 'error', 
          message: result.error || 'Failed to analyze website'
        })
        return
      }

      // Update community data with extracted info
      const updates: Partial<typeof community> = {}

      // Use extracted property name if we don't have one
      if (result.propertyName && !community.name.trim()) {
        updates.name = result.propertyName
      }

      // Add extracted amenities (merge with existing)
      if (result.amenities && result.amenities.length > 0) {
        const existingAmenities = new Set(community.amenities || [])
        result.amenities.forEach(a => existingAmenities.add(a))
        updates.amenities = Array.from(existingAmenities)
      }

      // If we have unit counts from unit types, we could infer something
      // but for now just expand amenities section to show results
      if (Object.keys(updates).length > 0) {
        updateCommunity(updates)
      }

      // Store the full scrape result
      updateFormData('websiteScrapeResult' as keyof typeof formData, result as never)

      // Show amenities section if we found some
      if (result.amenities && result.amenities.length > 0) {
        setShowAmenities(true)
      }

      setScrapeStatus({
        status: 'success',
        message: `Found ${result.amenities?.length || 0} amenities, ${result.pagesScraped} pages analyzed`,
        result,
      })

    } catch (err) {
      setScrapeStatus({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to connect to website'
      })
    }
  }, [community.websiteUrl, community.additionalUrls, community.name, community.amenities, updateCommunity, updateFormData, setError])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-xl shadow-cyan-500/25 mb-6">
          <MapPin className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          Property Details
        </h1>
        <p className="text-slate-400 text-lg">
          Tell us about your property
        </p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Website URL - Moved to top for scraping priority */}
          <div>
            <label htmlFor="websiteUrl" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              Website URL
            </label>
            <div className="flex gap-2">
              <input
                id="websiteUrl"
                type="url"
                value={community.websiteUrl}
                onChange={(e) => {
                  updateCommunity({ websiteUrl: e.target.value })
                  // Reset scrape status when URL changes
                  if (scrapeStatus.status !== 'idle') {
                    setScrapeStatus({ status: 'idle' })
                  }
                }}
                placeholder="https://thereserveatsandpoint.com"
                className="flex-1 px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />
              <button
                type="button"
                onClick={handleScrapeWebsite}
                disabled={(!community.websiteUrl?.trim() && (!community.additionalUrls || community.additionalUrls.filter(u => u.trim()).length === 0)) || scrapeStatus.status === 'scraping'}
                className={`
                  flex items-center gap-2 px-4 py-3 rounded-xl font-medium transition-all
                  ${scrapeStatus.status === 'scraping'
                    ? 'bg-amber-500/20 text-amber-300 cursor-wait'
                    : scrapeStatus.status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                      : 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/20'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                {scrapeStatus.status === 'scraping' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">Analyzing...</span>
                  </>
                ) : scrapeStatus.status === 'success' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Re-scan</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Scan Pages</span>
                  </>
                )}
              </button>
            </div>
            
            {/* Scrape status message */}
            {scrapeStatus.status === 'idle' && (
              <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Add URLs below, then click &quot;Scan Pages&quot; to extract info into the knowledge base
              </p>
            )}
            
            {scrapeStatus.status === 'scraping' && (
              <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-amber-300 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Analyzing website content, this may take a moment...</span>
                </div>
              </div>
            )}
            
            {scrapeStatus.status === 'success' && scrapeStatus.result && (
              <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-emerald-300 text-sm mb-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{scrapeStatus.message}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {scrapeStatus.result.petPolicy && (
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-full">
                      Pet Policy Found
                    </span>
                  )}
                  {scrapeStatus.result.unitTypes && scrapeStatus.result.unitTypes.length > 0 && (
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-full">
                      {scrapeStatus.result.unitTypes.length} Unit Types
                    </span>
                  )}
                  {scrapeStatus.result.specials && scrapeStatus.result.specials.length > 0 && (
                    <span className="px-2 py-1 bg-amber-500/20 text-amber-300 rounded-full">
                      {scrapeStatus.result.specials.length} Specials
                    </span>
                  )}
                  {scrapeStatus.result.brandVoice && (
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full">
                      AI Insights
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {scrapeStatus.status === 'error' && (
              <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{scrapeStatus.message}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  You can continue manually entering the details below.
                </p>
              </div>
            )}

            {/* Additional URLs Section */}
            <div className="mt-4 pt-4 border-t border-slate-700/50">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
                <Link className="w-3 h-3" />
                Additional Pages to Scrape (optional)
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Add specific page URLs (e.g., amenities, floor plans, pet policy) to include in the knowledge base
              </p>
              
              {/* URL Input Fields */}
              <div className="space-y-2 mb-3">
                {(community.additionalUrls || []).map((url, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-slate-800 text-slate-500 text-xs flex-shrink-0">
                      {idx + 1}
                    </div>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const updated = [...(community.additionalUrls || [])]
                        updated[idx] = e.target.value
                        updateCommunity({ additionalUrls: updated })
                      }}
                      placeholder="https://example.com/amenities"
                      className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => removeUrlAtIndex(idx)}
                      className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      title="Remove URL"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add URL Button */}
              <button
                type="button"
                onClick={() => {
                  const current = community.additionalUrls || []
                  updateCommunity({ additionalUrls: [...current, ''] })
                }}
                className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-dashed border-slate-600 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-slate-500 hover:text-slate-300 transition-all text-sm w-full justify-center"
              >
                <Plus className="w-4 h-4" />
                Add URL
              </button>
              
              {community.additionalUrls && community.additionalUrls.filter(u => u.trim()).length > 0 && (
                <p className="text-xs text-slate-500 mt-3">
                  {community.additionalUrls.filter(u => u.trim()).length + (community.websiteUrl ? 1 : 0)} total URL(s) will be scraped
                </p>
              )}
            </div>
          </div>

          {/* Property Name */}
          <div>
            <label htmlFor="propertyName" className="block text-sm font-medium text-slate-300 mb-2">
              Property name <span className="text-red-400">*</span>
            </label>
            <input
              id="propertyName"
              type="text"
              value={community.name}
              onChange={(e) => updateCommunity({ name: e.target.value })}
              placeholder="The Reserve at Sandpoint"
              className="w-full px-4 py-3.5 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              autoFocus
            />
          </div>

          {/* Property Type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              Property type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PROPERTY_TYPE_OPTIONS.map(({ value, label, description }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateCommunity({ type: value })}
                  className={`
                    p-3 rounded-xl border-2 text-left transition-all
                    ${community.type === value
                      ? 'border-cyan-400 bg-cyan-500/10 text-white'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                    }
                  `}
                >
                  <span className="font-medium text-sm block">{label}</span>
                  <span className="text-xs text-slate-500">{description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Address
            </label>
            <input
              type="text"
              value={community.address.street}
              onChange={(e) => updateCommunity({ 
                address: { ...community.address, street: e.target.value } 
              })}
              placeholder="123 Main Street"
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all mb-3"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={community.address.city}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, city: e.target.value } 
                })}
                placeholder="City"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
              <input
                type="text"
                value={community.address.state}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, state: e.target.value } 
                })}
                placeholder="State"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
              <input
                type="text"
                value={community.address.zip}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, zip: e.target.value } 
                })}
                placeholder="ZIP"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
            </div>
          </div>

          {/* Unit Count & Year Built */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="unitCount" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Hash className="w-4 h-4 text-slate-400" />
                Unit count
              </label>
              <input
                id="unitCount"
                type="number"
                min="1"
                value={community.unitCount}
                onChange={(e) => updateCommunity({ unitCount: e.target.value })}
                placeholder="248"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="yearBuilt" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Year built
              </label>
              <input
                id="yearBuilt"
                type="number"
                min="1900"
                max={new Date().getFullYear() + 2}
                value={community.yearBuilt}
                onChange={(e) => updateCommunity({ yearBuilt: e.target.value })}
                placeholder="2019"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />
            </div>
          </div>

          {/* Amenities */}
          <div>
            <button
              type="button"
              onClick={() => setShowAmenities(!showAmenities)}
              className="flex items-center justify-between w-full text-sm font-medium text-slate-300 mb-3 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <Building className="w-4 h-4 text-slate-400" />
                Amenities {community.amenities.length > 0 && (
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 text-xs rounded-full">
                    {community.amenities.length} selected
                  </span>
                )}
                {scrapeStatus.status === 'success' && scrapeStatus.result?.amenities && scrapeStatus.result.amenities.length > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs rounded-full">
                    Auto-detected
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                {showAmenities ? 'Hide' : 'Show'} options
              </span>
            </button>
            
            {showAmenities && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                {AMENITY_OPTIONS.map((amenity) => (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => toggleAmenity(amenity)}
                    className={`
                      px-3 py-2 rounded-lg text-xs font-medium transition-all text-left
                      ${community.amenities.includes(amenity)
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                      }
                    `}
                  >
                    {amenity}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Insights Preview */}
          {scrapeStatus.status === 'success' && scrapeStatus.result && (
            <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI-Extracted Insights
              </h3>
              
              {scrapeStatus.result.brandVoice && (
                <div>
                  <span className="text-xs text-slate-500">Brand Voice:</span>
                  <p className="text-sm text-slate-300">{scrapeStatus.result.brandVoice}</p>
                </div>
              )}
              
              {scrapeStatus.result.targetAudience && (
                <div>
                  <span className="text-xs text-slate-500">Target Audience:</span>
                  <p className="text-sm text-slate-300">{scrapeStatus.result.targetAudience}</p>
                </div>
              )}
              
              {scrapeStatus.result.neighborhoodInfo && (
                <div>
                  <span className="text-xs text-slate-500">Neighborhood:</span>
                  <p className="text-sm text-slate-300">{scrapeStatus.result.neighborhoodInfo}</p>
                </div>
              )}

              {scrapeStatus.result.petPolicy && (
                <div>
                  <span className="text-xs text-slate-500">Pet Policy:</span>
                  <p className="text-sm text-slate-300">
                    {scrapeStatus.result.petPolicy.petsAllowed 
                      ? `Pets allowed${scrapeStatus.result.petPolicy.deposit ? ` • $${scrapeStatus.result.petPolicy.deposit} deposit` : ''}${scrapeStatus.result.petPolicy.maxPets ? ` • Max ${scrapeStatus.result.petPolicy.maxPets} pets` : ''}`
                      : 'No pets allowed'
                    }
                  </p>
                </div>
              )}

              {scrapeStatus.result.specials && scrapeStatus.result.specials.length > 0 && (
                <div>
                  <span className="text-xs text-slate-500">Current Specials:</span>
                  <ul className="text-sm text-amber-300 list-disc list-inside">
                    {scrapeStatus.result.specials.slice(0, 3).map((special, i) => (
                      <li key={i} className="truncate">{special}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <p className="text-xs text-slate-500 pt-2 border-t border-slate-700/50">
                This data will be used to train your AI leasing assistant
              </p>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={goToPreviousStep}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all"
            >
              <ArrowLeft size={18} />
              Back
            </button>
            <button
              type="submit"
              disabled={!canProceed()}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <ArrowRight size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
