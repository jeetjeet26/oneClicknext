import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

/**
 * BrandForge: Competitive Analysis
 * Leverages MarketVision data-engine to analyze competitors for brand positioning
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { propertyId, address, propertyType, radiusMiles = 3, maxCompetitors = 10 } = await req.json()

    if (!propertyId || !address) {
      return NextResponse.json({ error: 'propertyId and address required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine directly for competitor discovery (bypasses API auth)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000) // 5 min timeout
    
    try {
      const discoveryRes = await fetch(`${DATA_ENGINE_URL}/scraper/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          radius_miles: radiusMiles,
          max_competitors: maxCompetitors,
          auto_add: true
        }),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)

      if (!discoveryRes.ok) {
        const errorText = await discoveryRes.text()
        console.error('Data engine discovery error:', errorText)
        // Don't fail - continue with existing competitors if any
      }
    } catch (fetchError) {
      clearTimeout(timeoutId)
      console.warn('Data engine not available, using existing competitors:', fetchError)
      // Continue - we'll use existing competitors from the database
    }

    // Brief wait for discovery to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get ALL competitors with full details and brand intelligence
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
      .limit(maxCompetitors)

    // Trigger brand intelligence scraping for competitors without analysis
    if (competitors && competitors.length > 0) {
      const unanalyzedCompetitors = competitors.filter(c => 
        !c.brand_intel || (Array.isArray(c.brand_intel) && c.brand_intel.length === 0) || (Array.isArray(c.brand_intel) && c.brand_intel[0] && !c.brand_intel[0].brand_voice)
      )
      
      if (unanalyzedCompetitors.length > 0) {
        // Trigger brand intelligence jobs (async, non-blocking)
        try {
          await fetch(`${DATA_ENGINE_URL}/scraper/brand-intelligence/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              property_id: propertyId,
              competitor_ids: unanalyzedCompetitors.map(c => c.id)
            })
          }).catch(err => {
            console.warn('Brand intelligence trigger failed (non-blocking):', err)
          })
        } catch (err) {
          console.warn('Could not trigger brand intelligence (non-blocking):', err)
        }
      }
    }

    // Analyze market gaps
    const brandVoices = competitors?.map(c => {
      const intel = Array.isArray(c.brand_intel) ? c.brand_intel[0] : c.brand_intel
      return intel?.brand_voice
    }).filter(Boolean) || []
    const positionings = competitors?.map(c => {
      const intel = Array.isArray(c.brand_intel) ? c.brand_intel[0] : c.brand_intel
      return intel?.positioning_statement
    }).filter(Boolean) || []
    
    // Simple gap analysis
    const voiceFrequency: Record<string, number> = {}
    brandVoices.forEach(voice => {
      voiceFrequency[voice] = (voiceFrequency[voice] || 0) + 1
    })

    const marketGaps = []
    if (!brandVoices.includes('modern') && !brandVoices.includes('innovative')) {
      marketGaps.push('Modern, tech-forward positioning underrepresented')
    }
    if (!brandVoices.includes('value') && !brandVoices.includes('affordable')) {
      marketGaps.push('Value-conscious positioning available')
    }
    if (!brandVoices.includes('community')) {
      marketGaps.push('Community-focused positioning opportunity')
    }

    // Generate strategic recommendations based on analysis
    const recommendations: string[] = []
    
    if (marketGaps.length > 0) {
      recommendations.push(`Position your brand to fill identified market gaps - ${marketGaps[0].toLowerCase()}`)
    }
    
    const mostCommonVoice = Object.entries(voiceFrequency).sort((a, b) => b[1] - a[1])[0]
    if (mostCommonVoice) {
      recommendations.push(`Avoid saturated positioning: "${mostCommonVoice[0]}" is used by ${mostCommonVoice[1]} competitors`)
    }
    
    recommendations.push('Develop a distinctive visual identity that contrasts with competitor color schemes')
    recommendations.push('Focus messaging on unique amenities or experiences competitors don\'t offer')
    
    if (competitors && competitors.length > 5) {
      recommendations.push('Consider niche targeting - the market is competitive with many established brands')
    } else {
      recommendations.push('Opportunity for bold positioning - fewer established competitors in immediate area')
    }

    const analysis = {
      competitors: competitors?.map(c => {
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
      }) || [],
      competitorCount: competitors?.length || 0,
      marketGaps,
      recommendations,
      competitorIds: competitors?.map(c => c.id) || []
    }

    return NextResponse.json({
      success: true,
      analysis
    })

  } catch (error) {
    console.error('BrandForge Analysis Error:', error)
    return NextResponse.json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}


