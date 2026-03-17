'use client'

import { useState, useEffect } from 'react'
import { Loader2, Sparkles, MapPin, Building2, TrendingUp, Target, ChevronRight, Users, Palette } from 'lucide-react'
import { ConversationInterface } from './ConversationInterface'
import { SectionReview } from './SectionReview'
import { CompletionView } from './CompletionView'
import { BrandForgeCompetitorCard, type BrandForgeCompetitor } from './BrandForgeCompetitorCard'
import type { BrandForgeCompletionResult } from './types'

interface BrandForgeWizardProps {
  propertyId: string
  propertyAddress: {
    street?: string
    city?: string
    state?: string
    zip?: string
  }
  propertyType: string
  onComplete: (brandAsset: any) => void
}

type WizardStep = 'settings' | 'analyzing' | 'review-analysis' | 'conversation' | 'generation' | 'complete'

interface CompetitorCard {
  name: string
  address?: string
  brandVoice?: string
  positioning?: string
  targetAudience?: string
  colorScheme?: string[]
  strengths?: string[]
  weaknesses?: string[]
}

export function BrandForgeWizard({ 
  propertyId, 
  propertyAddress, 
  propertyType,
  onComplete 
}: BrandForgeWizardProps) {
  const [step, setStep] = useState<WizardStep>('settings')
  const [brandAssetId, setBrandAssetId] = useState<string | null>(null)
  const [competitiveContext, setCompetitiveContext] = useState<any>(null)
  const [currentSection, setCurrentSection] = useState<number>(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completionResult, setCompletionResult] = useState<BrandForgeCompletionResult | null>(null)
  
  // Settings
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [maxCompetitors, setMaxCompetitors] = useState(10)

  async function runAnalysis() {
    setStep('analyzing')
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/brandforge/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          address: propertyAddress,
          propertyType,
          radiusMiles,
          maxCompetitors
        })
      })

      if (!res.ok) throw new Error('Analysis failed')

      const data = await res.json()
      setCompetitiveContext(data.analysis)
      setStep('review-analysis')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
      setStep('settings')
    } finally {
      setIsLoading(false)
    }
  }

  function handleConversationComplete(assetId: string) {
    setBrandAssetId(assetId)
    setStep('generation')
  }

  function handleAllSectionsComplete(result: BrandForgeCompletionResult) {
    setCompletionResult(result)
    setStep('complete')
    onComplete(result)
  }

  return (
    <div className="w-full">
      {/* Progress indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium text-slate-900">
            {step === 'settings' && 'Configure Analysis'}
            {step === 'analyzing' && 'Analyzing Market'}
            {step === 'review-analysis' && 'Market Intelligence Report'}
            {step === 'conversation' && 'Brand Strategy Conversation'}
            {step === 'generation' && `Creating Brand Book (${currentSection}/12)`}
            {step === 'complete' && 'Brand Book Complete'}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div 
            className="bg-indigo-600 h-2 rounded-full transition-all"
            style={{ 
              width: `${
                step === 'settings' ? 5 :
                step === 'analyzing' ? 10 :
                step === 'review-analysis' ? 20 :
                step === 'conversation' ? 35 :
                step === 'generation' ? 35 + ((currentSection / 12) * 55) :
                100
              }%` 
            }}
          />
        </div>
      </div>

      {/* Step 1: Settings - Radius Selection */}
      {step === 'settings' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Configure Competitive Analysis
            </h3>
            <p className="text-indigo-100 text-sm mt-1">
              Set the search radius to discover competitors near your property
            </p>
          </div>
          
          <div className="p-6 space-y-6">
            {/* Property Info */}
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-slate-600 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900">{propertyAddress.street}</p>
                  <p className="text-sm text-slate-600">
                    {propertyAddress.city}, {propertyAddress.state} {propertyAddress.zip}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{propertyType}</p>
                </div>
              </div>
            </div>

            {/* Radius Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Search Radius
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 3, 5, 10].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadiusMiles(r)}
                    className={`py-3 px-4 rounded-lg border-2 transition-all text-center ${
                      radiusMiles === r
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-600'
                    }`}
                  >
                    <span className="text-lg font-semibold">{r}</span>
                    <span className="text-xs block">mile{r > 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Max Competitors */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Maximum Competitors to Analyze
              </label>
              <select
                value={maxCompetitors}
                onChange={(e) => setMaxCompetitors(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={5}>5 competitors</option>
                <option value={10}>10 competitors</option>
                <option value={15}>15 competitors</option>
                <option value={20}>20 competitors</option>
              </select>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={runAnalysis}
              className="w-full py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <Target className="w-5 h-5" />
              Start Competitive Analysis
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Analyzing */}
      {step === 'analyzing' && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <div className="mb-4">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            Analyzing Your Market
          </h3>
          <p className="text-slate-600">
            Discovering {maxCompetitors} competitors within {radiusMiles} miles...
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Analyzing brand positioning, voice, and market gaps
          </p>
        </div>
      )}

      {/* Step 3: Review Analysis - MarketVision Style */}
      {step === 'review-analysis' && competitiveContext && (
        <div className="space-y-6">
          {/* Market Summary Card */}
          <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-xl p-6 text-white">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-6 h-6" />
              Market Intelligence Report
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white/10 rounded-lg p-4">
                <p className="text-3xl font-bold">{competitiveContext.competitorCount || 0}</p>
                <p className="text-indigo-100 text-sm">Competitors Found</p>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <p className="text-3xl font-bold">{radiusMiles} mi</p>
                <p className="text-indigo-100 text-sm">Search Radius</p>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <p className="text-3xl font-bold">{competitiveContext.marketGaps?.length || 0}</p>
                <p className="text-indigo-100 text-sm">Market Gaps Identified</p>
              </div>
            </div>
          </div>

          {/* Market Gaps */}
          {competitiveContext.marketGaps?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-green-600" />
                Strategic Opportunities (Market Gaps)
              </h4>
              <div className="grid md:grid-cols-2 gap-3">
                {competitiveContext.marketGaps.map((gap: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 bg-green-50 rounded-lg p-3">
                    <span className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {idx + 1}
                    </span>
                    <p className="text-sm text-green-800">{gap}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Competitor Cards */}
          {competitiveContext.competitors?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-600" />
                  Competitor Brand Analysis
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                    {competitiveContext.competitors.length} {competitiveContext.competitors.length === 1 ? 'Competitor' : 'Competitors'}
                  </span>
                </h4>
              </div>
              <div className="grid md:grid-cols-2 gap-5">
                {competitiveContext.competitors.map((comp: BrandForgeCompetitor) => (
                  <BrandForgeCompetitorCard 
                    key={comp.id} 
                    competitor={comp} 
                  />
                ))}
              </div>
            </div>
          )}

          {/* Strategic Recommendations */}
          {competitiveContext.recommendations?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <h4 className="font-semibold text-amber-900 mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-600" />
                AI Strategic Recommendations
              </h4>
              <ul className="space-y-2">
                {competitiveContext.recommendations.map((rec: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-amber-800">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Proceed Button */}
          <div className="flex justify-end">
            <button
              onClick={() => setStep('conversation')}
              className="py-3 px-6 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
            >
              Continue to Brand Strategy
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Conversation */}
      {step === 'conversation' && competitiveContext && (
        <ConversationInterface
          propertyId={propertyId}
          competitiveContext={competitiveContext}
          onComplete={handleConversationComplete}
        />
      )}

      {/* Step 5: Generation */}
      {step === 'generation' && brandAssetId && (
        <SectionReview
          brandAssetId={brandAssetId}
          onSectionChange={setCurrentSection}
          onComplete={handleAllSectionsComplete}
        />
      )}

      {/* Step 6: Complete */}
      {step === 'complete' && brandAssetId && (
        <CompletionView
          propertyId={propertyId}
          brandAssetId={brandAssetId}
          completionResult={completionResult}
        />
      )}
    </div>
  )
}



