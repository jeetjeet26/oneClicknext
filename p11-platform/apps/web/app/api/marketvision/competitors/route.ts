/**
 * MarketVision 360 - Competitors API
 * Manage competitor properties for market intelligence
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { assertValidPropertyType } from '@/utils/property-types'

export interface Competitor {
  id: string
  propertyId: string
  name: string
  address: string | null
  addressJson: {
    street?: string
    city?: string
    state?: string
    zip?: string
    lat?: number
    lng?: number
  } | null
  websiteUrl: string | null
  phone: string | null
  unitsCount: number | null
  yearBuilt: number | null
  propertyType: string
  amenities: string[]
  photos: string[]
  ilsListings: Record<string, string>
  notes: string | null
  isActive: boolean
  lastScrapedAt: string | null
  createdAt: string
  updatedAt: string
  units?: CompetitorUnit[]
}

export interface CompetitorUnit {
  id: string
  competitorId: string
  unitType: string
  bedrooms: number
  bathrooms: number
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  deposit: number | null
  availableCount: number
  moveInSpecials: string | null
  lastUpdatedAt: string
}

// GET: List all competitors for a property
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const includeUnits = searchParams.get('includeUnits') === 'true'
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build query - include brand intelligence for highlighted amenities
    // NOTE: Supabase's typed select-string parser is whitespace sensitive in some setups,
    // so keep the select strings compact (no spaces after commas).
    const select = includeUnits
      ? '*,units:competitor_units(*),brand_intel:competitor_brand_intelligence(highlighted_amenities)'
      : '*,brand_intel:competitor_brand_intelligence(highlighted_amenities)'

    let query = supabase
      .from('competitors')
      .select(select)
      .eq('property_id', propertyId)
      .order('name', { ascending: true })

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    const { data: competitors, error } = await query

    if (error) {
      console.error('Error fetching competitors:', error)
      return NextResponse.json({ error: 'Failed to fetch competitors' }, { status: 500 })
    }

    return NextResponse.json({
      competitors: (competitors || []).map((c) => formatCompetitor(c as unknown as Record<string, unknown>)),
      count: competitors?.length || 0
    })
  } catch (error) {
    console.error('MarketVision Competitors GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Create a new competitor
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { 
      propertyId, 
      name, 
      address, 
      addressJson,
      websiteUrl, 
      phone, 
      unitsCount,
      yearBuilt,
      propertyType,
      amenities,
      ilsListings,
      notes,
      units // Optional: array of unit configurations
    } = body

    if (!propertyId || !name) {
      return NextResponse.json({ error: 'propertyId and name required' }, { status: 400 })
    }

    let validatedPropertyType: string | null
    try {
      validatedPropertyType = assertValidPropertyType(propertyType || 'multifamily')
    } catch {
      return NextResponse.json({ error: 'Invalid property type' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Helper to convert empty strings to null for integer fields
    const toIntOrNull = (val: unknown): number | null => {
      if (val === '' || val === null || val === undefined) return null
      const num = typeof val === 'string' ? parseInt(val, 10) : val
      return isNaN(num as number) ? null : num as number
    }

    // Insert competitor
    const { data: competitor, error } = await supabase
      .from('competitors')
      .insert({
        property_id: propertyId,
        name,
        address: address || null,
        address_json: addressJson || null,
        website_url: websiteUrl || null,
        phone: phone || null,
        units_count: toIntOrNull(unitsCount),
        year_built: toIntOrNull(yearBuilt),
        property_type: validatedPropertyType || 'multifamily',
        amenities: amenities || [],
        ils_listings: ilsListings || {},
        notes: notes || null
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating competitor:', error)
      return NextResponse.json({ error: 'Failed to create competitor' }, { status: 500 })
    }

    // If units provided, insert them
    if (units && Array.isArray(units) && units.length > 0) {
      const unitsToInsert = units.map(unit => ({
        competitor_id: competitor.id,
        unit_type: unit.unitType,
        bedrooms: unit.bedrooms || 0,
        bathrooms: unit.bathrooms || 1.0,
        sqft_min: unit.sqftMin || null,
        sqft_max: unit.sqftMax || null,
        rent_min: unit.rentMin || null,
        rent_max: unit.rentMax || null,
        deposit: unit.deposit || null,
        available_count: unit.availableCount || 0,
        move_in_specials: unit.moveInSpecials || null
      }))

      const { error: unitsError } = await supabase
        .from('competitor_units')
        .insert(unitsToInsert)

      if (unitsError) {
        console.error('Error inserting units:', unitsError)
        // Don't fail the whole request, just log
      }
    }

    // Create new competitor alert
    await supabase.from('market_alerts').insert({
      property_id: propertyId,
      competitor_id: competitor.id,
      alert_type: 'new_competitor',
      severity: 'info',
      title: `New competitor added: ${name}`,
      description: `${name} has been added to your competitive set`,
      data: { competitor_name: name }
    })

    return NextResponse.json({
      success: true,
      competitor: formatCompetitor(competitor)
    }, { status: 201 })
  } catch (error) {
    console.error('MarketVision Competitors POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT: Update a competitor
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Competitor id required' }, { status: 400 })
    }

    const { data: existingCompetitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', id)
      .single()

    if (!existingCompetitor || typeof existingCompetitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingCompetitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Helper to convert empty strings to null for integer fields
    const toIntOrNull = (val: unknown): number | null => {
      if (val === '' || val === null || val === undefined) return null
      const num = typeof val === 'string' ? parseInt(val, 10) : val
      return isNaN(num as number) ? null : num as number
    }

    // Convert camelCase to snake_case for update
    const dbUpdates: Record<string, unknown> = {}
    if (updates.name !== undefined) dbUpdates.name = updates.name
    if (updates.address !== undefined) dbUpdates.address = updates.address || null
    if (updates.addressJson !== undefined) dbUpdates.address_json = updates.addressJson
    if (updates.websiteUrl !== undefined) dbUpdates.website_url = updates.websiteUrl || null
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone || null
    if (updates.unitsCount !== undefined) dbUpdates.units_count = toIntOrNull(updates.unitsCount)
    if (updates.yearBuilt !== undefined) dbUpdates.year_built = toIntOrNull(updates.yearBuilt)
    if (updates.propertyType !== undefined) {
      try {
        dbUpdates.property_type = assertValidPropertyType(updates.propertyType || 'multifamily') || 'multifamily'
      } catch {
        return NextResponse.json({ error: 'Invalid property type' }, { status: 400 })
      }
    }
    if (updates.amenities !== undefined) dbUpdates.amenities = updates.amenities
    if (updates.photos !== undefined) dbUpdates.photos = updates.photos
    if (updates.ilsListings !== undefined) dbUpdates.ils_listings = updates.ilsListings
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes || null
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive

    const { data: competitor, error } = await supabase
      .from('competitors')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating competitor:', error)
      return NextResponse.json({ error: 'Failed to update competitor' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      competitor: formatCompetitor(competitor)
    })
  } catch (error) {
    console.error('MarketVision Competitors PUT Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Remove a competitor
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Competitor id required' }, { status: 400 })
    }

    const { data: existingCompetitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', id)
      .single()

    if (!existingCompetitor || typeof existingCompetitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingCompetitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('competitors')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting competitor:', error)
      return NextResponse.json({ error: 'Failed to delete competitor' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('MarketVision Competitors DELETE Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Format competitor from DB to API response
function formatCompetitor(data: Record<string, unknown>): Competitor {
  // Get amenities from main table or fall back to brand intelligence highlighted_amenities
  let amenities = (data.amenities as string[]) || []
  
  // If no amenities saved, use highlighted_amenities from brand intelligence
  if (amenities.length === 0 && data.brand_intel) {
    const brandIntel = data.brand_intel as { highlighted_amenities?: string[] } | null
    if (brandIntel?.highlighted_amenities && Array.isArray(brandIntel.highlighted_amenities)) {
      amenities = brandIntel.highlighted_amenities
    }
  }

  const formatted: Competitor = {
    id: data.id as string,
    propertyId: data.property_id as string,
    name: data.name as string,
    address: data.address as string | null,
    addressJson: data.address_json as Competitor['addressJson'],
    websiteUrl: data.website_url as string | null,
    phone: data.phone as string | null,
    unitsCount: data.units_count as number | null,
    yearBuilt: data.year_built as number | null,
    propertyType: data.property_type as string || 'multifamily',
    amenities,
    photos: (data.photos as string[]) || [],
    ilsListings: (data.ils_listings as Record<string, string>) || {},
    notes: data.notes as string | null,
    isActive: data.is_active as boolean,
    lastScrapedAt: data.last_scraped_at as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string
  }

  // Include units if present
  if (data.units && Array.isArray(data.units)) {
    formatted.units = data.units.map(formatUnit)
  }

  return formatted
}

function formatUnit(data: Record<string, unknown>): CompetitorUnit {
  return {
    id: data.id as string,
    competitorId: data.competitor_id as string,
    unitType: data.unit_type as string,
    bedrooms: data.bedrooms as number,
    bathrooms: data.bathrooms as number,
    sqftMin: data.sqft_min as number | null,
    sqftMax: data.sqft_max as number | null,
    rentMin: data.rent_min as number | null,
    rentMax: data.rent_max as number | null,
    deposit: data.deposit as number | null,
    availableCount: data.available_count as number || 0,
    moveInSpecials: data.move_in_specials as string | null,
    lastUpdatedAt: data.last_updated_at as string
  }
}

