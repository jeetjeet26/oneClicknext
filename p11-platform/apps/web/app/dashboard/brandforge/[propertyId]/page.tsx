'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { 
  ArrowLeft, Download, Sparkles, Palette, Type, 
  Image as ImageIcon, FileText, CheckCircle, Users,
  Target, Lightbulb, Camera, PenTool, Loader2, Wand2, Building2
} from 'lucide-react'
import { BrandForgeCompetitorCard, type BrandForgeCompetitor } from '@/components/brandforge'

// Component to render full section content
function SectionContent({ sectionKey, data }: { sectionKey: string; data: any }) {
  if (!data) return null

  switch (sectionKey) {
    case 'section_1_introduction':
      return (
        <div className="space-y-4">
          {data.title && <h4 className="text-xl font-bold text-slate-900">{data.title}</h4>}
          {data.tagline && <p className="text-lg text-indigo-600 font-medium">{data.tagline}</p>}
          {data.story && <p className="text-slate-700 leading-relaxed">{data.story}</p>}
          {data.brandEssence && (
            <div className="bg-indigo-50 rounded-lg p-4">
              <p className="text-sm text-indigo-600 font-medium">Brand Essence</p>
              <p className="text-indigo-900">{data.brandEssence}</p>
            </div>
          )}
        </div>
      )

    case 'section_2_positioning':
      return (
        <div className="space-y-4">
          {data.statement && (
            <div className="bg-slate-50 rounded-lg p-4 border-l-4 border-indigo-600">
              <p className="text-lg font-medium text-slate-900">{data.statement}</p>
            </div>
          )}
          {data.differentiators && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Key Differentiators:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                {data.differentiators.map((d: string, i: number) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {data.competitiveAdvantage && (
            <p className="text-slate-700"><span className="font-medium">Competitive Advantage:</span> {data.competitiveAdvantage}</p>
          )}
        </div>
      )

    case 'section_3_target_audience':
      return (
        <div className="space-y-4">
          {data.primary && <p className="text-lg font-medium text-slate-900">{data.primary}</p>}
          {data.demographics && (
            <div className="grid grid-cols-3 gap-4">
              {data.demographics.age && (
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-sm text-slate-500">Age Range</p>
                  <p className="font-semibold text-slate-900">{data.demographics.age}</p>
                </div>
              )}
              {data.demographics.income && (
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-sm text-slate-500">Income</p>
                  <p className="font-semibold text-slate-900">{data.demographics.income}</p>
                </div>
              )}
              {data.demographics.lifestyle && (
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-sm text-slate-500">Lifestyle</p>
                  <p className="font-semibold text-slate-900 text-sm">{data.demographics.lifestyle}</p>
                </div>
              )}
            </div>
          )}
          {data.psychographics && <p className="text-slate-700">{data.psychographics}</p>}
        </div>
      )

    case 'section_4_personas':
      return (
        <div className="space-y-4">
          {data.personas?.map((persona: any, i: number) => (
            <div key={i} className="bg-slate-50 rounded-lg p-4">
              <h5 className="font-semibold text-slate-900 mb-1">{persona.name}</h5>
              <p className="text-slate-600 text-sm mb-2">{persona.description}</p>
              {persona.needs && <p className="text-slate-700 text-sm"><span className="font-medium">Needs:</span> {persona.needs}</p>}
            </div>
          ))}
        </div>
      )

    case 'section_5_name_story':
      return (
        <div className="space-y-4">
          {data.name && <h4 className="text-2xl font-bold text-slate-900">{data.name}</h4>}
          {data.meaning && <p className="text-slate-700">{data.meaning}</p>}
          {data.story && (
            <div className="bg-amber-50 rounded-lg p-4 border-l-4 border-amber-400">
              <p className="text-amber-900 italic">{data.story}</p>
            </div>
          )}
        </div>
      )

    case 'section_6_logo':
      return (
        <div className="space-y-4">
          {data.concept && (
            <div>
              <p className="font-medium text-slate-700 mb-1">Concept:</p>
              <p className="text-slate-900">{data.concept}</p>
            </div>
          )}
          {data.style && <p className="text-slate-700"><span className="font-medium">Style:</span> {data.style}</p>}
          {data.variations && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Logo Versions:</p>
              <div className="flex flex-wrap gap-2">
                {data.variations.map((v: string, i: number) => (
                  <span key={i} className="px-3 py-1 bg-slate-100 rounded-full text-sm text-slate-700">{v}</span>
                ))}
              </div>
            </div>
          )}
          
          {/* Show all generated logo variations */}
          {data.logoVariations && data.logoVariations.length > 0 ? (
            <div>
              <p className="font-medium text-slate-700 mb-2">Generated Logo Icons (click to view full size):</p>
              <p className="text-xs text-slate-500 mb-3">Icons only - add your brand name text using your typography</p>
              <div className="grid grid-cols-4 gap-4">
                {data.logoVariations.map((url: string, i: number) => (
                  <div 
                    key={i} 
                    className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all hover:scale-105 ${
                      url === data.logoUrl ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'
                    }`}
                    onClick={() => window.open(url, '_blank')}
                  >
                    <img src={url} alt={`Logo variation ${i + 1}`} className="w-full aspect-square object-contain bg-white" />
                    {url === data.logoUrl && (
                      <div className="absolute top-1 right-1 bg-indigo-500 text-white text-xs px-2 py-0.5 rounded">
                        Primary
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : data.logoUrl ? (
            <div>
              <p className="font-medium text-slate-700 mb-2">Generated Logo Icon:</p>
              <img 
                src={data.logoUrl} 
                alt="Logo" 
                className="max-w-[200px] rounded-lg border bg-white p-4 cursor-pointer hover:scale-105 transition-transform" 
                onClick={() => window.open(data.logoUrl, '_blank')}
              />
            </div>
          ) : null}
        </div>
      )

    case 'section_7_typography':
      return (
        <div className="space-y-4">
          {data.primaryFont && (
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">Primary Font</p>
              <p className="text-2xl font-bold text-slate-900" style={{ fontFamily: data.primaryFont.name }}>{data.primaryFont.name}</p>
              <p className="text-slate-600 text-sm mt-1">{data.primaryFont.usage}</p>
            </div>
          )}
          {data.secondaryFont && (
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">Secondary Font</p>
              <p className="text-xl text-slate-900">{data.secondaryFont.name}</p>
              <p className="text-slate-600 text-sm mt-1">{data.secondaryFont.usage}</p>
            </div>
          )}
          {data.hierarchy && <p className="text-slate-700">{data.hierarchy}</p>}
        </div>
      )

    case 'section_8_colors':
      return (
        <div className="space-y-4">
          {data.palette && <p className="text-slate-700 mb-4">{data.palette}</p>}
          {data.primary && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Primary Colors:</p>
              <div className="flex gap-4">
                {data.primary.map((c: any, i: number) => (
                  <div key={i} className="text-center">
                    <div 
                      className="w-16 h-16 rounded-lg shadow-md mb-2"
                      style={{ backgroundColor: c.hex }}
                    />
                    <p className="text-sm font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.hex}</p>
                    {c.usage && <p className="text-xs text-slate-400 mt-1">{c.usage}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.secondary && (
            <div>
              <p className="font-medium text-slate-700 mb-2 mt-4">Secondary Colors:</p>
              <div className="flex gap-4">
                {data.secondary.map((c: any, i: number) => (
                  <div key={i} className="text-center">
                    <div 
                      className="w-12 h-12 rounded-lg shadow-md mb-2 border"
                      style={{ backgroundColor: c.hex }}
                    />
                    <p className="text-xs font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.hex}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )

    case 'section_9_design_elements':
      return (
        <div className="space-y-4">
          {data.patterns && <p className="text-slate-700"><span className="font-medium">Patterns:</span> {data.patterns}</p>}
          {data.textures && <p className="text-slate-700"><span className="font-medium">Textures:</span> {data.textures}</p>}
          {data.iconography && <p className="text-slate-700"><span className="font-medium">Iconography:</span> {data.iconography}</p>}
          {data.photography && <p className="text-slate-700"><span className="font-medium">Photography Style:</span> {data.photography}</p>}
        </div>
      )

    case 'section_10_photo_yep':
      return (
        <div className="space-y-4">
          {data.description && <p className="text-slate-900 font-medium">{data.description}</p>}
          {data.mood && (
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-green-700"><span className="font-medium">Mood:</span> {data.mood}</p>
            </div>
          )}
          {data.examples && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Examples of good photos:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                {data.examples.map((ex: string, i: number) => <li key={i}>{ex}</li>)}
              </ul>
            </div>
          )}
        </div>
      )

    case 'section_11_photo_nope':
      return (
        <div className="space-y-4">
          {data.description && <p className="text-slate-900 font-medium">{data.description}</p>}
          {data.reasoning && (
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-red-700">{data.reasoning}</p>
            </div>
          )}
          {data.examples && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Photos to avoid:</p>
              <ul className="list-disc list-inside space-y-1 text-red-600">
                {data.examples.map((ex: string, i: number) => <li key={i}>{ex}</li>)}
              </ul>
            </div>
          )}
        </div>
      )

    case 'section_12_implementation':
      return (
        <div className="space-y-4">
          {data.signage && <p className="text-slate-700"><span className="font-medium">Signage:</span> {data.signage}</p>}
          {data.collateral && <p className="text-slate-700"><span className="font-medium">Collateral:</span> {data.collateral}</p>}
          {data.digital && <p className="text-slate-700"><span className="font-medium">Digital:</span> {data.digital}</p>}
          {data.environment && <p className="text-slate-700"><span className="font-medium">Environment:</span> {data.environment}</p>}
        </div>
      )

    default:
      return (
        <pre className="text-sm text-slate-600 bg-slate-50 p-4 rounded-lg overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )
  }
}

const BRAND_SECTION_KEYS = [
  'section_1_introduction',
  'section_2_positioning',
  'section_3_target_audience',
  'section_4_personas',
  'section_5_name_story',
  'section_6_logo',
  'section_7_typography',
  'section_8_colors',
  'section_9_design_elements',
  'section_10_photo_yep',
  'section_11_photo_nope',
  'section_12_implementation',
] as const

function countApprovedSections(brandAsset: any) {
  return BRAND_SECTION_KEYS.filter((key) => Boolean(brandAsset?.[key])).length
}

function getBrandStatusWarnings(brandAsset: any) {
  const warnings: string[] = []
  const logoUrl = brandAsset?.section_6_logo?.primary_url || brandAsset?.section_6_logo?.logoUrl

  if (logoUrl === '/placeholder-logo.png') {
    warnings.push(
      'Logo generation fell back to a placeholder. You can keep using the brand book and regenerate visual assets later.'
    )
  }

  if (brandAsset?.generation_status === 'complete' && !brandAsset?.brand_book_pdf_url) {
    warnings.push(
      'All sections are approved, but the final downloadable export is not ready yet. Retry export from the completion flow if needed.'
    )
  }

  return warnings
}

export default function BrandBookViewerPage({ 
  params 
}: { 
  params: Promise<{ propertyId: string }> 
}) {
  const { propertyId } = use(params)
  const router = useRouter()
  const [brandAsset, setBrandAsset] = useState<any>(null)
  const [property, setProperty] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [generatingImages, setGeneratingImages] = useState<string | null>(null) // 'logo' | 'moodboard' | 'photos'
  const [embeddingToKB, setEmbeddingToKB] = useState(false)
  const [embeddedToKB, setEmbeddedToKB] = useState(false)
  const [allCompetitors, setAllCompetitors] = useState<any[]>([])
  const [loadingCompetitors, setLoadingCompetitors] = useState(false)

  useEffect(() => {
    fetchBrandAsset()
  }, [propertyId])

  useEffect(() => {
    if (brandAsset?.competitive_analysis?.competitorIds?.length > 0) {
      fetchAllCompetitors()
    }
  }, [brandAsset])

  async function fetchBrandAsset() {
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      // Fetch brand asset
      const { data: brand, error: brandError } = await supabase
        .from('property_brand_assets')
        .select('*')
        .eq('property_id', propertyId)
        .single()

      if (brandError && brandError.code !== 'PGRST116') {
        console.error('Brand fetch error:', brandError)
      }

      // Fetch property info
      const { data: prop } = await supabase
        .from('properties')
        .select('id, name')
        .eq('id', propertyId)
        .single()

      setBrandAsset(brand)
      setProperty(prop)
    } catch (err) {
      console.error('Failed to fetch brand asset:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchAllCompetitors() {
    if (!brandAsset) return
    
    setLoadingCompetitors(true)
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      // Fetch ALL competitors for this property with full details
      const { data: competitors } = await supabase
        .from('competitors')
        .select(`
          id,
          name,
          address,
          website_url,
          phone,
          property_type,
          units_count,
          year_built,
          amenities,
          photos,
          last_scraped_at,
          brand_intel:competitor_brand_intelligence(
            brand_voice,
            brand_personality,
            positioning_statement,
            target_audience,
            unique_selling_points,
            highlighted_amenities,
            active_specials,
            lifestyle_focus
          )
        `)
        .eq('property_id', propertyId)
        .eq('is_active', true)
        .order('name')

      if (competitors) {
        // Transform to BrandForgeCompetitor format
        const enrichedCompetitors = competitors.map(c => {
          const intel = Array.isArray(c.brand_intel) ? c.brand_intel[0] : c.brand_intel
          return {
            id: c.id,
            name: c.name,
            address: c.address,
            websiteUrl: c.website_url,
            phone: c.phone,
            propertyType: c.property_type,
            unitsCount: c.units_count,
            yearBuilt: c.year_built,
            amenities: c.amenities || [],
            photos: c.photos || [],
            lastScrapedAt: c.last_scraped_at,
            brandVoice: intel?.brand_voice || 'Not analyzed',
            personality: intel?.brand_personality || 'Not analyzed',
            positioning: intel?.positioning_statement || 'Not analyzed',
            targetAudience: intel?.target_audience || 'Not analyzed',
            usps: intel?.unique_selling_points || [],
            highlightedAmenities: intel?.highlighted_amenities || [],
            activeSpecials: intel?.active_specials || [],
            lifestyleFocus: intel?.lifestyle_focus || []
          }
        })
        
        setAllCompetitors(enrichedCompetitors)
      }
    } catch (err) {
      console.error('Failed to fetch competitors:', err)
    } finally {
      setLoadingCompetitors(false)
    }
  }

  async function embedToKnowledgeBase() {
    if (!brandAsset) return
    setEmbeddingToKB(true)

    try {
      const res = await fetch('/api/brandforge/embed-to-kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandAssetId: brandAsset.id,
          propertyId
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Embedding failed')
      }

      const result = await res.json()
      setEmbeddedToKB(true)
      alert(`Success! ${result.embeddedChunks} chunks embedded to knowledge base.`)
    } catch (err) {
      console.error('KB embedding failed:', err)
      alert(err instanceof Error ? err.message : 'Embedding failed')
    } finally {
      setEmbeddingToKB(false)
    }
  }

  async function generateImages(type: 'logo' | 'moodboard' | 'photo_examples') {
    if (!brandAsset) return
    setGeneratingImages(type)

    try {
      const res = await fetch('/api/brandforge/generate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandAssetId: brandAsset.id,
          propertyId,
          type,
          brandData: brandAsset
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Image generation failed')
      }

      // Refresh brand asset to get updated URLs
      await fetchBrandAsset()
    } catch (err) {
      console.error('Image generation failed:', err)
      alert(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setGeneratingImages(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    )
  }

  const sections = brandAsset ? [
    { key: 'section_1_introduction', title: 'Introduction', icon: Sparkles },
    { key: 'section_2_positioning', title: 'Positioning', icon: Target },
    { key: 'section_3_target_audience', title: 'Target Audience', icon: Users },
    { key: 'section_4_personas', title: 'Personas', icon: Users },
    { key: 'section_5_name_story', title: 'Brand Name & Story', icon: Lightbulb },
    { key: 'section_6_logo', title: 'Logo', icon: PenTool },
    { key: 'section_7_typography', title: 'Typography', icon: Type },
    { key: 'section_8_colors', title: 'Color Palette', icon: Palette },
    { key: 'section_9_design_elements', title: 'Design Elements', icon: PenTool },
    { key: 'section_10_photo_yep', title: 'Photo Guidelines (Yep)', icon: Camera },
    { key: 'section_11_photo_nope', title: 'Photo Guidelines (Nope)', icon: Camera },
    { key: 'section_12_implementation', title: 'Implementation', icon: FileText },
  ] : []

  const completedCount = countApprovedSections(brandAsset)
  const isComplete = completedCount >= 12
  const statusWarnings = getBrandStatusWarnings(brandAsset)

  return (
    <div className="max-w-5xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              {brandAsset?.section_5_name_story?.name || property?.name || 'Brand Book'}
            </h1>
            <p className="text-slate-600">
              {brandAsset?.section_1_introduction?.tagline || 'Comprehensive brand guidelines'}
            </p>
          </div>
          <div className="flex gap-2">
            {brandAsset && (
              <button
                onClick={embedToKnowledgeBase}
                disabled={embeddingToKB || embeddedToKB}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  embeddedToKB 
                    ? 'bg-green-100 text-green-700 cursor-default'
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                } disabled:opacity-50`}
              >
                {embeddingToKB ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Embedding...
                  </>
                ) : embeddedToKB ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Added to KB
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Add to Knowledge Base
                  </>
                )}
              </button>
            )}
            {brandAsset?.brand_book_pdf_url && (
              <a
                href={brandAsset.brand_book_pdf_url}
                download
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Brand Export
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {!brandAsset ? (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-12 text-center">
          <Sparkles className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-900 mb-2">
            No Brand Book Yet
          </h3>
          <p className="text-slate-600 mb-6">
            Generate a comprehensive brand book using BrandForge AI
          </p>
          <button
            onClick={() => router.push(`/dashboard/brandforge/${propertyId}/create`)}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Generate Brand Book
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress indicator */}
          <div className="rounded-xl p-6 text-white bg-gradient-to-r from-indigo-600 to-purple-600">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  {isComplete ? <CheckCircle className="w-6 h-6" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-xl font-bold">
                    {isComplete ? 'Brand Book Complete!' : 'Brand Book Progress'}
                  </h2>
                  <p className="text-white/80 text-sm">
                    {isComplete 
                      ? 'All 12 sections generated' 
                      : `${completedCount} of 12 sections complete`
                    }
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold">{completedCount}</span>
                <span className="text-xl text-white/70">/12</span>
              </div>
            </div>
            
            {/* Progress bar with color gradient based on completion */}
            <div className="w-full bg-black/30 rounded-full h-4 overflow-hidden">
              <div 
                className={`h-4 rounded-full transition-all duration-500 ${
                  completedCount === 0 ? 'bg-slate-400' :
                  completedCount <= 3 ? 'bg-gradient-to-r from-red-500 to-orange-500' :
                  completedCount <= 6 ? 'bg-gradient-to-r from-orange-500 to-yellow-500' :
                  completedCount <= 9 ? 'bg-gradient-to-r from-yellow-500 to-lime-500' :
                  completedCount < 12 ? 'bg-gradient-to-r from-lime-500 to-green-500' :
                  'bg-gradient-to-r from-green-500 to-emerald-500'
                }`}
                style={{ width: `${(completedCount / 12) * 100}%` }} 
              />
            </div>
            
            {/* Step markers */}
            <div className="flex justify-between mt-2 px-0.5">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i < completedCount 
                      ? 'bg-white' 
                      : 'bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          {statusWarnings.length > 0 && (
            <div className="space-y-2">
              {statusWarnings.map((warning) => (
                <div
                  key={warning}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Brand Strategy Summary - Key info at a glance */}
          {brandAsset.conversation_summary && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <h3 className="font-semibold text-amber-900 mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5" />
                Brand Strategy Summary
              </h3>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-amber-600 font-medium">Brand Name</p>
                  <p className="text-amber-900">{brandAsset.conversation_summary.brandName}</p>
                </div>
                <div>
                  <p className="text-amber-600 font-medium">Tagline</p>
                  <p className="text-amber-900">{brandAsset.conversation_summary.tagline}</p>
                </div>
                <div>
                  <p className="text-amber-600 font-medium">Target Audience</p>
                  <p className="text-amber-900">{brandAsset.conversation_summary.targetAudience}</p>
                </div>
              </div>
            </div>
          )}

          {/* Competitive Research Section */}
          {brandAsset.competitive_analysis && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === 'competitive' ? null : 'competitive')}
                className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
              >
                <div className="p-2 rounded-lg bg-blue-100">
                  <Target className="w-5 h-5 text-blue-600" />
                </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">Competitive Research & Market Positioning</h3>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {allCompetitors.length || brandAsset.competitive_analysis.competitorCount || 0} competitors analyzed
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">The market intelligence that informed this brand strategy</p>
                  </div>
                <svg 
                  className={`w-5 h-5 text-slate-400 transition-transform ${expandedSection === 'competitive' ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expandedSection === 'competitive' && (
                <div className="px-6 pb-6 border-t border-slate-100">
                  <div className="pt-4 space-y-6">
                    
                    {/* Market Overview Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-indigo-600">{allCompetitors.length || brandAsset.competitive_analysis.competitorCount || 0}</p>
                        <p className="text-xs text-slate-600 mt-1">Competitors Analyzed</p>
                      </div>
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-green-600">{brandAsset.competitive_analysis.marketGaps?.length || 0}</p>
                        <p className="text-xs text-slate-600 mt-1">Market Gaps Found</p>
                      </div>
                      <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-amber-600">{brandAsset.competitive_analysis.recommendations?.length || 0}</p>
                        <p className="text-xs text-slate-600 mt-1">Strategic Recommendations</p>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-purple-600">High</p>
                        <p className="text-xs text-slate-600 mt-1">Differentiation Potential</p>
                      </div>
                    </div>

                    {/* Brand Voice Distribution */}
                    {brandAsset.competitive_analysis.competitors?.length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                          <Palette className="w-4 h-4 text-purple-600" />
                          Competitive Brand Voice Landscape
                        </h4>
                        <div className="bg-slate-50 rounded-lg p-4">
                          <div className="flex flex-wrap gap-2 mb-4">
                            {(() => {
                              const voices: Record<string, number> = {}
                              brandAsset.competitive_analysis.competitors.forEach((c: any) => {
                                if (c.brandVoice) {
                                  voices[c.brandVoice] = (voices[c.brandVoice] || 0) + 1
                                }
                              })
                              return Object.entries(voices).map(([voice, count]) => (
                                <div key={voice} className="flex items-center gap-2 bg-white rounded-full px-3 py-1 border">
                                  <span className="text-sm font-medium text-slate-700 capitalize">{voice}</span>
                                  <span className="text-xs bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">{count}</span>
                                </div>
                              ))
                            })()}
                          </div>
                          <p className="text-sm text-slate-600">
                            <span className="font-medium">Your Position:</span> By adopting a <span className="text-indigo-600 font-medium">{brandAsset.conversation_summary?.brandPersonality || 'unique'}</span> brand voice, 
                            you differentiate from the competitive landscape dominated by more conventional positioning.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Market Gaps - Enhanced */}
                    {brandAsset.competitive_analysis.marketGaps?.length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                          <Lightbulb className="w-4 h-4 text-green-600" />
                          Market Opportunities Identified
                        </h4>
                        <div className="space-y-3">
                          {brandAsset.competitive_analysis.marketGaps.map((gap: string, i: number) => (
                            <div key={i} className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <span className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                                  {i + 1}
                                </span>
                                <div className="flex-1">
                                  <p className="font-medium text-green-900">{gap}</p>
                                  <p className="text-sm text-green-700 mt-1">
                                    {i === 0 && "This represents a significant whitespace in the market that your brand can own."}
                                    {i === 1 && "Competitors are not emphasizing this, creating an opportunity for differentiation."}
                                    {i === 2 && "Early mover advantage available in this positioning territory."}
                                  </p>
                                </div>
                                <div className="bg-green-600 text-white text-xs px-2 py-1 rounded-full">
                                  High Impact
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Strategic Recommendations - Enhanced */}
                    {brandAsset.competitive_analysis.recommendations?.length > 0 && (
                      <div>
                        <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-600" />
                          Strategic Recommendations Applied to Brand
                        </h4>
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                          <div className="space-y-3">
                            {brandAsset.competitive_analysis.recommendations.map((rec: string, i: number) => (
                              <div key={i} className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-amber-900">{rec}</p>
                                  <p className="text-xs text-amber-700 mt-1">
                                    → Applied in: {['Brand Positioning', 'Visual Identity', 'Messaging Strategy'][i % 3]}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Competitors Analyzed - Rich Cards */}
                    {(() => {
                      // Use allCompetitors if we have them (fresh from DB), otherwise fall back to stored data
                      const competitorsToDisplay = allCompetitors.length > 0 
                        ? allCompetitors 
                        : brandAsset.competitive_analysis.competitors || []
                      
                      if (competitorsToDisplay.length === 0) return null

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                              <Building2 className="w-5 h-5 text-indigo-600" />
                              Competitor Deep Dive
                              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                                {competitorsToDisplay.length} {competitorsToDisplay.length === 1 ? 'Competitor' : 'Competitors'}
                              </span>
                            </h4>
                            {loadingCompetitors && (
                              <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading full competitor details...
                              </div>
                            )}
                          </div>
                          <div className="grid md:grid-cols-2 gap-5">
                            {competitorsToDisplay.map((comp: any, idx: number) => (
                              <BrandForgeCompetitorCard 
                                key={comp.id || `competitor-${idx}`} 
                                competitor={{
                                  id: comp.id || `comp-${idx}`,
                                  name: comp.name || 'Unknown Competitor',
                                  address: comp.address || null,
                                  websiteUrl: comp.websiteUrl || null,
                                  phone: comp.phone || null,
                                  propertyType: comp.propertyType || 'apartment',
                                  unitsCount: comp.unitsCount || null,
                                  yearBuilt: comp.yearBuilt || null,
                                  amenities: comp.amenities || [],
                                  photos: comp.photos || [],
                                  lastScrapedAt: comp.lastScrapedAt || null,
                                  brandVoice: comp.brandVoice || 'Not analyzed',
                                  personality: comp.personality || 'Not analyzed',
                                  positioning: comp.positioning || 'Not analyzed',
                                  targetAudience: comp.targetAudience || 'Not analyzed',
                                  usps: comp.usps || [],
                                  highlightedAmenities: comp.highlightedAmenities || [],
                                  activeSpecials: comp.activeSpecials || [],
                                  lifestyleFocus: comp.lifestyleFocus || []
                                }} 
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Positioning Map */}
                    <div>
                      <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                        <Target className="w-4 h-4 text-blue-600" />
                        Market Positioning Map
                      </h4>
                      <div className="bg-slate-50 rounded-lg p-6 relative" style={{ height: '300px' }}>
                        {/* Axes */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-full h-px bg-slate-300"></div>
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-px h-full bg-slate-300"></div>
                        </div>
                        
                        {/* Axis Labels */}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-slate-500 font-medium">Premium</div>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-slate-500 font-medium">Value</div>
                        <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">Traditional</div>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">Modern</div>
                        
                        {/* Competitor Dots */}
                        {brandAsset.competitive_analysis.competitors?.slice(0, 3).map((comp: any, i: number) => (
                          <div 
                            key={i}
                            className="absolute w-4 h-4 bg-slate-400 rounded-full border-2 border-white shadow-sm"
                            style={{
                              left: `${30 + i * 20}%`,
                              top: `${40 + (i % 2) * 20}%`,
                            }}
                            title={comp.name}
                          >
                            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-slate-600">
                              {comp.name?.split(' ').slice(0, 2).join(' ')}
                            </div>
                          </div>
                        ))}
                        
                        {/* Your Brand - Highlighted */}
                        <div 
                          className="absolute w-6 h-6 bg-indigo-600 rounded-full border-3 border-white shadow-lg flex items-center justify-center"
                          style={{ right: '25%', top: '25%' }}
                        >
                          <Sparkles className="w-3 h-3 text-white" />
                          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-indigo-600">
                            {brandAsset.conversation_summary?.brandName || 'Your Brand'}
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 mt-3 text-center">
                        Your brand occupies a unique position: <span className="font-medium text-indigo-600">Premium + Modern</span> with family-friendly warmth
                      </p>
                    </div>

                  </div>
                </div>
              )}
            </div>
          )}

          {/* Brand Strategy Conversation */}
          {brandAsset.gemini_conversation_history && brandAsset.gemini_conversation_history.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === 'conversation' ? null : 'conversation')}
                className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
              >
                <div className="p-2 rounded-lg bg-purple-100">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">Brand Strategy Conversation</h3>
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                      {brandAsset.gemini_conversation_history.length} messages
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">The AI-guided discovery that shaped this brand</p>
                </div>
                <svg 
                  className={`w-5 h-5 text-slate-400 transition-transform ${expandedSection === 'conversation' ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expandedSection === 'conversation' && (
                <div className="px-6 pb-6 border-t border-slate-100">
                  <div className="pt-4 space-y-3 max-h-96 overflow-y-auto">
                    {brandAsset.gemini_conversation_history.map((msg: any, i: number) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            msg.role === 'user'
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-900'
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section Cards - Expandable */}
          <div className="space-y-4">
            {sections.map(({ key, title, icon: Icon }) => {
              const sectionData = brandAsset[key]
              const hasData = sectionData && Object.keys(sectionData).length > 0
              const isExpanded = expandedSection === key
              
              return (
                <div 
                  key={key}
                  className={`bg-white rounded-xl border overflow-hidden transition-all ${
                    hasData ? 'border-green-200' : 'border-slate-200'
                  }`}
                >
                  {/* Header - Clickable */}
                  <button
                    onClick={() => setExpandedSection(isExpanded ? null : key)}
                    className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className={`p-2 rounded-lg ${hasData ? 'bg-green-100' : 'bg-slate-100'}`}>
                      <Icon className={`w-5 h-5 ${hasData ? 'text-green-600' : 'text-slate-400'}`} />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{title}</h3>
                        {hasData && <CheckCircle className="w-4 h-4 text-green-500" />}
                      </div>
                    </div>
                    <svg 
                      className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && hasData && (
                    <div className="px-6 pb-6 border-t border-slate-100">
                      <div className="pt-4">
                        <SectionContent sectionKey={key} data={sectionData} />
                        
                        {/* Generate Logo Button - always show for regeneration */}
                        {key === 'section_6_logo' && (
                          <button
                            onClick={() => generateImages('logo')}
                            disabled={generatingImages !== null}
                            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {generatingImages === 'logo' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating 4 Logo Variations...
                              </>
                            ) : (
                              <>
                                <Wand2 className="w-4 h-4" />
                                {sectionData.logoUrl ? 'Regenerate Logo Icons' : 'Generate Logo with AI'}
                              </>
                            )}
                          </button>
                        )}
                        
                        {/* Generate Moodboard Button - always show for regeneration */}
                        {key === 'section_9_design_elements' && (
                          <button
                            onClick={() => generateImages('moodboard')}
                            disabled={generatingImages !== null}
                            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {generatingImages === 'moodboard' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating Moodboard (4 images)...
                              </>
                            ) : (
                              <>
                                <Wand2 className="w-4 h-4" />
                                {sectionData.moodboardUrls ? 'Regenerate Moodboard' : 'Generate Moodboard with AI'}
                              </>
                            )}
                          </button>
                        )}
                        
                        {/* Display Moodboard Images */}
                        {key === 'section_9_design_elements' && sectionData.moodboardUrls && (
                          <div className="mt-4">
                            <p className="font-medium text-slate-700 mb-2">Generated Moodboard:</p>
                            <div className="grid grid-cols-3 gap-2">
                              {sectionData.moodboardUrls.map((url: string, i: number) => (
                                <img 
                                  key={i} 
                                  src={url} 
                                  alt={`Moodboard ${i + 1}`}
                                  className="rounded-lg border shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                  onClick={() => window.open(url, '_blank')}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Generate Photo Examples Button - always show for regeneration */}
                        {key === 'section_10_photo_yep' && (
                          <button
                            onClick={() => generateImages('photo_examples')}
                            disabled={generatingImages !== null}
                            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {generatingImages === 'photo_examples' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating Photo Examples...
                              </>
                            ) : (
                              <>
                                <Wand2 className="w-4 h-4" />
                                {sectionData.generatedPhotos ? 'Regenerate Photos' : 'Generate Photo Examples with AI'}
                              </>
                            )}
                          </button>
                        )}
                        
                        {/* Display Photo Examples */}
                        {key === 'section_10_photo_yep' && sectionData.generatedPhotos && (
                          <div className="mt-4">
                            <p className="font-medium text-slate-700 mb-2">AI-Generated Photo Examples:</p>
                            <div className="grid grid-cols-2 gap-3">
                              {sectionData.generatedPhotos.map((url: string, i: number) => (
                                <img 
                                  key={i} 
                                  src={url} 
                                  alt={`Photo example ${i + 1}`}
                                  className="rounded-lg border shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                  onClick={() => window.open(url, '_blank')}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {isExpanded && !hasData && (
                    <div className="px-6 pb-6 border-t border-slate-100">
                      <p className="pt-4 text-slate-500 italic">This section has not been generated yet.</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

        </div>
      )}
    </div>
  )
}



