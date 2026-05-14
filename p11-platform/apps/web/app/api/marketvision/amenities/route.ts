/**
 * MarketVision 360 - Amenities API
 * Returns aggregated amenities from scraped competitor data
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Base amenities list (used when no scraped data exists)
const BASE_AMENITIES = [
  'Pool', 'Fitness Center', 'Dog Park', 'Clubhouse', 'Business Center',
  'Package Lockers', 'EV Charging', 'Garage Parking', 'Covered Parking',
  'In-Unit Washer/Dryer', 'Balcony/Patio', 'Walk-In Closets', 'Stainless Appliances',
  'Granite Countertops', 'Hardwood Floors', 'Valet Trash', 'Gated Access',
  'Playground', 'Tennis Courts', 'Volleyball Court', 'Grilling Areas'
]

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Collect amenities from multiple sources
    const scrapedAmenities = new Set<string>()

    // 1. Get amenities from all competitors in this property's competitive set
    const { data: competitors } = await supabase
      .from('competitors')
      .select('id, amenities')
      .eq('property_id', propertyId)
      .eq('is_active', true)

    const competitorIds: string[] = []
    
    if (competitors) {
      for (const competitor of competitors) {
        competitorIds.push(competitor.id)
        if (competitor.amenities && Array.isArray(competitor.amenities)) {
          competitor.amenities.forEach((a) => {
            if (typeof a !== 'string') return
            if (a && a.trim()) scrapedAmenities.add(a.trim())
          })
        }
      }
    }

    // 2. Get highlighted amenities from brand intelligence scrapes
    const { data: brandIntel } = await supabase
      .from('competitor_brand_intelligence')
      .select('highlighted_amenities, competitor_id')
      .in('competitor_id', competitorIds)

    if (brandIntel) {
      for (const intel of brandIntel) {
        if (intel.highlighted_amenities && Array.isArray(intel.highlighted_amenities)) {
          intel.highlighted_amenities.forEach((a: string) => {
            if (a && a.trim()) scrapedAmenities.add(a.trim())
          })
        }
      }
    }

    // 3. Merge with base amenities (scraped ones first, then base)
    const allAmenities = new Set<string>(scrapedAmenities)
    BASE_AMENITIES.forEach(a => allAmenities.add(a))

    // Convert to array and sort
    const amenitiesList = Array.from(allAmenities).sort((a, b) => {
      // Scraped amenities first
      const aScraped = scrapedAmenities.has(a)
      const bScraped = scrapedAmenities.has(b)
      if (aScraped && !bScraped) return -1
      if (!aScraped && bScraped) return 1
      return a.localeCompare(b)
    })

    return NextResponse.json({
      amenities: amenitiesList,
      scrapedCount: scrapedAmenities.size,
      baseCount: BASE_AMENITIES.length,
      totalCount: amenitiesList.length
    })
  } catch (error) {
    console.error('MarketVision Amenities GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

