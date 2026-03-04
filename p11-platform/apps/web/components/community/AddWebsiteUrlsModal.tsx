'use client'

import { useState } from 'react'
import { X, Globe, Loader2, Check, AlertCircle, Plus, Trash2 } from 'lucide-react'

type Props = {
  propertyId: string
  onClose: () => void
  onSuccess: () => void
}

export function AddWebsiteUrlsModal({ propertyId, onClose, onSuccess }: Props) {
  const [urls, setUrls] = useState<string[]>([''])
  const [isScrapingWebsite, setIsScrapingWebsite] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'input' | 'scraping' | 'success'>('input')

  const handleAddUrl = () => {
    setUrls([...urls, ''])
  }

  const handleRemoveUrl = (index: number) => {
    if (urls.length === 1) return // Keep at least one input
    setUrls(urls.filter((_, i) => i !== index))
  }

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const handleScrape = async () => {
    // Filter out empty URLs
    const validUrls = urls.filter(url => url.trim())
    
    if (validUrls.length === 0) {
      setError('Please enter at least one URL')
      return
    }

    // Validate URLs
    const invalidUrls: string[] = []
    validUrls.forEach(url => {
      let testUrl = url.trim()
      if (!testUrl.startsWith('http')) {
        testUrl = 'https://' + testUrl
      }
      try {
        new URL(testUrl)
      } catch {
        invalidUrls.push(url)
      }
    })

    if (invalidUrls.length > 0) {
      setError(`Invalid URL(s): ${invalidUrls.join(', ')}`)
      return
    }

    setIsScrapingWebsite(true)
    setError(null)
    setStep('scraping')

    try {
      const response = await fetch('/api/community/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          websiteUrl: validUrls[0],
          additionalUrls: validUrls.slice(1)
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to scrape website')
      }

      setScrapeResult(result)
      setStep('success')
      
      // Auto-close after 2 seconds
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 2000)

    } catch (err: any) {
      setError(err.message || 'Failed to scrape website')
      setStep('input')
    } finally {
      setIsScrapingWebsite(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Add Website URLs</h3>
              <p className="text-sm text-slate-500">
                {step === 'input' && 'Scrape additional pages to expand your knowledge base'}
                {step === 'scraping' && 'Scraping website content...'}
                {step === 'success' && 'Content added successfully!'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isScrapingWebsite}
            className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Website URLs to Scrape
                </label>
                <div className="space-y-2">
                  {urls.map((url, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => handleUrlChange(index, e.target.value)}
                        placeholder="https://example.com/amenities"
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                      />
                      {urls.length > 1 && (
                        <button
                          onClick={() => handleRemoveUrl(index)}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                          title="Remove URL"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleAddUrl}
                  className="mt-2 flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Add another URL
                </button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">💡 Tips:</h4>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>• Add specific pages like amenities, floor plans, pet policy</li>
                  <li>• Content will be automatically chunked and added to your KB</li>
                  <li>• Your chatbot will be able to answer questions about this content</li>
                  <li>• You can add multiple URLs at once</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'scraping' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Scraping Website...</h3>
              <p className="text-sm text-slate-600 text-center">
                Extracting content, generating embeddings, and adding to knowledge base
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <Check className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Content Added!</h3>
              {scrapeResult && (
                <div className="text-sm text-slate-600 space-y-1 text-center">
                  <p>{scrapeResult.documentsCreated} chunks created from {scrapeResult.pagesScraped} page(s)</p>
                  {scrapeResult.amenities && scrapeResult.amenities.length > 0 && (
                    <p className="text-xs text-emerald-600">
                      Found {scrapeResult.amenities.length} amenities
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'input' && (
          <div className="p-6 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
              disabled={isScrapingWebsite}
            >
              Cancel
            </button>

            <button
              onClick={handleScrape}
              disabled={isScrapingWebsite || urls.every(url => !url.trim())}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {isScrapingWebsite ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scraping...
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" />
                  Scrape & Add to KB
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
