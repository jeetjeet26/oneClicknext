/**
 * MarketVision 360 - Apartments.com Scraping API
 * Trigger and manage apartments.com data scraping for competitors
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getApartmentsComUrl(ilsListings: unknown): string | null {
  const listings = asRecord(ilsListings)
  return typeof listings?.apartments_com === 'string' ? listings.apartments_com : null
}

// POST: Trigger apartments.com scraping
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { action, propertyId, competitorId, url, city, state, maxResults } = body

    if (!action) {
      return NextResponse.json({ error: 'action required' }, { status: 400 })
    }

    const propertyScopedActions = new Set(['refresh_batch', 'discover', 'find_listings'])
    const competitorScopedActions = new Set(['refresh_single', 'add_listing'])

    if (propertyScopedActions.has(action)) {
      if (!propertyId) {
        return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
      }
      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (competitorScopedActions.has(action)) {
      if (!competitorId) {
        return NextResponse.json({ error: 'competitorId required' }, { status: 400 })
      }
      const { data: competitor } = await supabase
        .from('competitors')
        .select('property_id')
        .eq('id', competitorId)
        .single()

      if (!competitor || typeof competitor.property_id !== 'string') {
        return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
      }

      const access = await validatePropertyAccess(user.id, competitor.property_id)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Route to appropriate action
    switch (action) {
      case 'refresh_single':
        return await refreshSingleCompetitor(supabase, competitorId, url)
      
      case 'refresh_batch':
        return await refreshBatchCompetitors(supabase, propertyId)
      
      case 'discover':
        return await discoverCompetitors(supabase, propertyId, city, state, maxResults)
      
      case 'add_listing':
        return await addListing(supabase, competitorId, url)
      
      case 'find_listings':
        return await findListingsForCompetitors(supabase, propertyId, body.autoScrape, body.city, body.state)
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Apartments.com API Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET: Get apartments.com scraping status/info for competitors
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const competitorId = searchParams.get('competitorId')

    if (competitorId) {
      // Get single competitor's apartments.com info
      const { data: competitor, error } = await supabase
        .from('competitors')
        .select('id, name, ils_listings, last_scraped_at, property_id')
        .eq('id', competitorId)
        .single()

      if (error) {
        return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
      }

      if (typeof competitor.property_id !== 'string') {
        return NextResponse.json({ error: 'Competitor property mapping is invalid' }, { status: 400 })
      }

      const access = await validatePropertyAccess(user.id, competitor.property_id)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const apartmentsComUrl = getApartmentsComUrl(competitor.ils_listings)
      
      return NextResponse.json({
        competitorId: competitor.id,
        name: competitor.name,
        hasApartmentsComListing: !!apartmentsComUrl,
        apartmentsComUrl,
        lastScrapedAt: competitor.last_scraped_at
      })
    }

    if (propertyId) {
      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Get all competitors with apartments.com status
      const { data: competitors, error } = await supabase
        .from('competitors')
        .select('id, name, ils_listings, last_scraped_at')
        .eq('property_id', propertyId)
        .eq('is_active', true)

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch competitors' }, { status: 500 })
      }

      const summary = {
        total: competitors?.length || 0,
        withApartmentsCom: 0,
        withoutApartmentsCom: 0,
        competitors: [] as Array<{
          id: string
          name: string
          hasApartmentsComListing: boolean
          apartmentsComUrl: string | null
          lastScrapedAt: string | null
        }>
      }

      for (const comp of competitors || []) {
        const apartmentsComUrl = getApartmentsComUrl(comp.ils_listings)
        const hasListing = Boolean(apartmentsComUrl)
        if (hasListing) {
          summary.withApartmentsCom++
        } else {
          summary.withoutApartmentsCom++
        }
        
        summary.competitors.push({
          id: comp.id,
          name: comp.name,
          hasApartmentsComListing: hasListing,
          apartmentsComUrl,
          lastScrapedAt: comp.last_scraped_at
        })
      }

      return NextResponse.json(summary)
    }

    return NextResponse.json({ error: 'propertyId or competitorId required' }, { status: 400 })
  } catch (error) {
    console.error('Apartments.com GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper functions

async function refreshSingleCompetitor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitorId: string,
  url?: string
) {
  if (!competitorId) {
    return NextResponse.json({ error: 'competitorId required' }, { status: 400 })
  }

  // Get competitor details
  const { data: competitor, error } = await supabase
    .from('competitors')
    .select('id, name, ils_listings, property_id')
    .eq('id', competitorId)
    .single()

  if (error || !competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }

  const apartmentsComUrl = url || getApartmentsComUrl(competitor.ils_listings)

  if (!apartmentsComUrl) {
    return NextResponse.json({ 
      error: 'No apartments.com URL for this competitor. Add one first.' 
    }, { status: 400 })
  }

  // Call data engine to scrape
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/apartments-com/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitor_id: competitorId,
        url: apartmentsComUrl
      })
    })

    if (response.ok) {
      const result = await response.json()
      return NextResponse.json({
        success: true,
        competitorId,
        competitorName: competitor.name,
        ...result
      })
    } else {
      // Fallback: Update last_scraped_at and return info
      // (Data engine might not be running)
      console.warn('Data engine not available, marking as attempted')
      
      await supabase
        .from('competitors')
        .update({ 
          last_scraped_at: new Date().toISOString(),
          ils_listings: { 
            ...(asRecord(competitor.ils_listings) ?? {}), 
            apartments_com: apartmentsComUrl 
          }
        })
        .eq('id', competitorId)

      return NextResponse.json({
        success: true,
        competitorId,
        competitorName: competitor.name,
        message: 'URL saved. Run data engine to scrape.',
        apartmentsComUrl
      })
    }
  } catch {
    // Data engine not available - save URL anyway
    if (url) {
      await supabase
        .from('competitors')
        .update({ 
          ils_listings: { 
            ...(asRecord(competitor.ils_listings) ?? {}), 
            apartments_com: url 
          }
        })
        .eq('id', competitorId)
    }

    return NextResponse.json({
      success: true,
      competitorId,
      competitorName: competitor.name,
      message: 'URL saved. Data engine not available for scraping.',
      apartmentsComUrl
    })
  }
}

async function refreshBatchCompetitors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string
) {
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  // Get competitors with apartments.com URLs
  const { data: competitors, error } = await supabase
    .from('competitors')
    .select('id, name, ils_listings')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch competitors' }, { status: 500 })
  }

  const competitorsWithUrls = competitors?.filter(c => Boolean(getApartmentsComUrl(c.ils_listings))) || []

  if (competitorsWithUrls.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No competitors with apartments.com URLs to refresh',
      refreshed: 0
    })
  }

  // Call data engine for batch refresh
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/apartments-com/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        competitor_ids: competitorsWithUrls.map(c => c.id)
      })
    })

    if (response.ok) {
      const result = await response.json()
      return NextResponse.json({
        success: true,
        propertyId,
        totalCompetitors: competitorsWithUrls.length,
        ...result
      })
    } else {
      return NextResponse.json({
        success: false,
        error: 'Data engine batch refresh failed',
        totalCompetitors: competitorsWithUrls.length
      }, { status: 500 })
    }
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Data engine not available',
      totalCompetitors: competitorsWithUrls.length,
      competitorIds: competitorsWithUrls.map(c => c.id)
    }, { status: 503 })
  }
}

async function discoverCompetitors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  city: string,
  state: string,
  maxResults?: number
) {
  if (!propertyId || !city || !state) {
    return NextResponse.json({ 
      error: 'propertyId, city, and state required' 
    }, { status: 400 })
  }

  // Call data engine for discovery
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/apartments-com/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        city,
        state,
        max_results: maxResults || 20
      })
    })

    if (response.ok) {
      const result = await response.json()
      return NextResponse.json({
        success: true,
        propertyId,
        city,
        state,
        ...result
      })
    } else {
      return NextResponse.json({
        success: false,
        error: 'Data engine discovery failed'
      }, { status: 500 })
    }
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Data engine not available for discovery'
    }, { status: 503 })
  }
}

async function addListing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitorId: string,
  url: string
) {
  if (!competitorId || !url) {
    return NextResponse.json({ 
      error: 'competitorId and url required' 
    }, { status: 400 })
  }

  // Validate URL
  if (!url.includes('apartments.com')) {
    return NextResponse.json({ 
      error: 'URL must be from apartments.com' 
    }, { status: 400 })
  }

  // Get competitor
  const { data: competitor, error } = await supabase
    .from('competitors')
    .select('id, name, ils_listings')
    .eq('id', competitorId)
    .single()

  if (error || !competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }

  // Update ILS listings
  const updatedListings = {
    ...(asRecord(competitor.ils_listings) ?? {}),
    apartments_com: url
  }

  const { error: updateError } = await supabase
    .from('competitors')
    .update({ ils_listings: updatedListings })
    .eq('id', competitorId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save URL' }, { status: 500 })
  }

  // Try to trigger scrape
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/apartments-com/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitor_id: competitorId,
        url
      })
    })

    if (response.ok) {
      const result = await response.json()
      return NextResponse.json({
        success: true,
        competitorId,
        competitorName: competitor.name,
        apartmentsComUrl: url,
        scraped: true,
        ...result
      })
    }
  } catch {
    // Data engine not available - that's OK, URL is saved
  }

  return NextResponse.json({
    success: true,
    competitorId,
    competitorName: competitor.name,
    apartmentsComUrl: url,
    scraped: false,
    message: 'URL saved. Scrape when data engine is available.'
  })
}

async function findListingsForCompetitors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  autoScrape: boolean = true,
  city?: string,
  state?: string
) {
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  // Call data engine to find listings
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/apartments-com/find-listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        auto_scrape: autoScrape,
        city: city || undefined,
        state: state || undefined
      })
    })

    if (response.ok) {
      const result = await response.json()
      return NextResponse.json({
        success: true,
        propertyId,
        ...result
      })
    } else {
      const errorText = await response.text()
      return NextResponse.json({
        success: false,
        error: 'Data engine error',
        details: errorText
      }, { status: 502 })
    }
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Data engine not available'
    }, { status: 503 })
  }
}

