/**
 * MarketVision 360 - Competitor Units API
 * Manage unit types and pricing for competitors
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// GET: Get units for a competitor
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const competitorId = searchParams.get('competitorId')

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

    const { data: units, error } = await supabase
      .from('competitor_units')
      .select('*')
      .eq('competitor_id', competitorId)
      .order('bedrooms', { ascending: true })

    if (error) {
      console.error('Error fetching units:', error)
      return NextResponse.json({ error: 'Failed to fetch units' }, { status: 500 })
    }

    return NextResponse.json({
      units: units?.map(formatUnit) || [],
      count: units?.length || 0
    })
  } catch (error) {
    console.error('MarketVision Units GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Add unit to competitor
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { 
      competitorId,
      unitType,
      bedrooms,
      bathrooms,
      sqftMin,
      sqftMax,
      rentMin,
      rentMax,
      deposit,
      availableCount,
      moveInSpecials
    } = body

    if (!competitorId || !unitType) {
      return NextResponse.json({ error: 'competitorId and unitType required' }, { status: 400 })
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

    const { data: unit, error } = await supabase
      .from('competitor_units')
      .insert({
        competitor_id: competitorId,
        unit_type: unitType,
        bedrooms: bedrooms || 0,
        bathrooms: bathrooms || 1.0,
        sqft_min: sqftMin || null,
        sqft_max: sqftMax || null,
        rent_min: rentMin || null,
        rent_max: rentMax || null,
        deposit: deposit || null,
        available_count: availableCount || 0,
        move_in_specials: moveInSpecials || null
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating unit:', error)
      return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 })
    }

    // Record initial price in history
    if (rentMin || rentMax) {
      await supabase.from('competitor_price_history').insert({
        competitor_unit_id: unit.id,
        rent_min: rentMin || null,
        rent_max: rentMax || null,
        available_count: availableCount || 0,
        source: 'manual'
      })
    }

    return NextResponse.json({
      success: true,
      unit: formatUnit(unit)
    }, { status: 201 })
  } catch (error) {
    console.error('MarketVision Units POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT: Update unit (and record price history)
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
      return NextResponse.json({ error: 'Unit id required' }, { status: 400 })
    }

    const { data: existingUnit } = await supabase
      .from('competitor_units')
      .select('competitor_id')
      .eq('id', id)
      .single()

    if (!existingUnit || typeof existingUnit.competitor_id !== 'string') {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', existingUnit.competitor_id)
      .single()

    if (!competitor || typeof competitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, competitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get current unit to check for price changes
    const { data: currentUnit } = await supabase
      .from('competitor_units')
      .select('rent_min, rent_max, available_count')
      .eq('id', id)
      .single()

    // Build update object
    const dbUpdates: Record<string, unknown> = {
      last_updated_at: new Date().toISOString()
    }
    if (updates.unitType !== undefined) dbUpdates.unit_type = updates.unitType
    if (updates.bedrooms !== undefined) dbUpdates.bedrooms = updates.bedrooms
    if (updates.bathrooms !== undefined) dbUpdates.bathrooms = updates.bathrooms
    if (updates.sqftMin !== undefined) dbUpdates.sqft_min = updates.sqftMin
    if (updates.sqftMax !== undefined) dbUpdates.sqft_max = updates.sqftMax
    if (updates.rentMin !== undefined) dbUpdates.rent_min = updates.rentMin
    if (updates.rentMax !== undefined) dbUpdates.rent_max = updates.rentMax
    if (updates.deposit !== undefined) dbUpdates.deposit = updates.deposit
    if (updates.availableCount !== undefined) dbUpdates.available_count = updates.availableCount
    if (updates.moveInSpecials !== undefined) dbUpdates.move_in_specials = updates.moveInSpecials

    const { data: unit, error } = await supabase
      .from('competitor_units')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating unit:', error)
      return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 })
    }

    // Record price history if rent changed
    const priceChanged = 
      (updates.rentMin !== undefined && updates.rentMin !== currentUnit?.rent_min) ||
      (updates.rentMax !== undefined && updates.rentMax !== currentUnit?.rent_max)

    if (priceChanged || updates.availableCount !== currentUnit?.available_count) {
      await supabase.from('competitor_price_history').insert({
        competitor_unit_id: id,
        rent_min: updates.rentMin ?? currentUnit?.rent_min ?? null,
        rent_max: updates.rentMax ?? currentUnit?.rent_max ?? null,
        available_count: updates.availableCount ?? currentUnit?.available_count ?? 0,
        source: 'manual'
      })
    }

    return NextResponse.json({
      success: true,
      unit: formatUnit(unit)
    })
  } catch (error) {
    console.error('MarketVision Units PUT Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Remove unit
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
      return NextResponse.json({ error: 'Unit id required' }, { status: 400 })
    }

    const { data: existingUnit } = await supabase
      .from('competitor_units')
      .select('competitor_id')
      .eq('id', id)
      .single()

    if (!existingUnit || typeof existingUnit.competitor_id !== 'string') {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', existingUnit.competitor_id)
      .single()

    if (!competitor || typeof competitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, competitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('competitor_units')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting unit:', error)
      return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('MarketVision Units DELETE Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function formatUnit(data: Record<string, unknown>) {
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

