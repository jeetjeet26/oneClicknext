/**
 * MarketVision 360 - Market Analysis API
 * Get market positioning, trends, and competitive insights
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface MarketSummary {
  competitorCount: number
  avgRentByBedroom: Record<string, { min: number; max: number; avg: number }>
  totalUnitsTracked: number
  recentPriceChanges: number
  marketTrend: 'rising' | 'falling' | 'stable'
  lastUpdated: string
}

export interface CompetitorComparison {
  competitor: {
    id: string
    name: string
    address: string | null
  }
  units: {
    unitType: string
    bedrooms: number
    rentMin: number | null
    rentMax: number | null
    sqftMin: number | null
    sqftMax: number | null
    pricePerSqft: number | null
    availableCount: number
  }[]
  avgRent: number
  avgPricePerSqft: number | null
  amenities: string[]
}

export interface PriceTrend {
  date: string
  avgRent: number
  minRent: number
  maxRent: number
  dataPoints: number
}

// GET: Get market analysis data
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const analysisType = searchParams.get('type') || 'summary'
    const unitType = searchParams.get('unitType') // For filtering specific unit types (deprecated, use bedrooms)
    const bedrooms = searchParams.get('bedrooms') // For filtering by bedroom count
    const days = parseInt(searchParams.get('days') || '30') // For trend analysis

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Use bedrooms filter if provided, otherwise fall back to unitType for backward compatibility
    const filter = bedrooms || unitType

    switch (analysisType) {
      case 'summary':
        return await getMarketSummary(supabase, propertyId)
      case 'comparison':
        return await getCompetitorComparison(supabase, propertyId, filter, bedrooms !== null)
      case 'trends':
        return await getPriceTrends(supabase, propertyId, filter, bedrooms !== null, days)
      case 'position':
        return await getMarketPosition(supabase, propertyId, filter, bedrooms !== null)
      default:
        return NextResponse.json({ error: 'Invalid analysis type' }, { status: 400 })
    }
  } catch (error) {
    console.error('MarketVision Analysis Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Market Summary
async function getMarketSummary(supabase: Awaited<ReturnType<typeof createClient>>, propertyId: string) {
  // Get competitor count
  const { data: competitors } = await supabase
    .from('competitors')
    .select('id')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  const competitorIds = competitors?.map(c => c.id) || []

  // Get all units
  const { data: units } = await supabase
    .from('competitor_units')
    .select('*')
    .in('competitor_id', competitorIds.length > 0 ? competitorIds : ['00000000-0000-0000-0000-000000000000'])

  // Calculate averages by bedroom
  const avgRentByBedroom: Record<string, { min: number; max: number; avg: number; count: number }> = {}
  
  units?.forEach(unit => {
    const key = `${unit.bedrooms}BR`
    if (!avgRentByBedroom[key]) {
      avgRentByBedroom[key] = { min: Infinity, max: 0, avg: 0, count: 0 }
    }
    if (unit.rent_min) {
      avgRentByBedroom[key].min = Math.min(avgRentByBedroom[key].min, unit.rent_min)
      avgRentByBedroom[key].avg += unit.rent_min
      avgRentByBedroom[key].count++
    }
    if (unit.rent_max) {
      avgRentByBedroom[key].max = Math.max(avgRentByBedroom[key].max, unit.rent_max)
    }
  })

  // Calculate final averages
  Object.keys(avgRentByBedroom).forEach(key => {
    const data = avgRentByBedroom[key]
    if (data.count > 0) {
      data.avg = Math.round(data.avg / data.count)
    }
    if (data.min === Infinity) data.min = 0
  })

  // Get recent price changes (last 7 days)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const { data: priceChanges } = await supabase
    .from('market_alerts')
    .select('id')
    .eq('property_id', propertyId)
    .in('alert_type', ['price_drop', 'price_increase'])
    .gte('created_at', weekAgo.toISOString())

  // Determine market trend (simplified)
  const { data: recentAlerts } = await supabase
    .from('market_alerts')
    .select('alert_type')
    .eq('property_id', propertyId)
    .in('alert_type', ['price_drop', 'price_increase'])
    .gte('created_at', weekAgo.toISOString())

  let increases = 0
  let decreases = 0
  recentAlerts?.forEach(alert => {
    if (alert.alert_type === 'price_increase') increases++
    if (alert.alert_type === 'price_drop') decreases++
  })

  let marketTrend: 'rising' | 'falling' | 'stable' = 'stable'
  if (increases > decreases + 2) marketTrend = 'rising'
  if (decreases > increases + 2) marketTrend = 'falling'

  const summary: MarketSummary = {
    competitorCount: competitors?.length || 0,
    avgRentByBedroom: Object.fromEntries(
      Object.entries(avgRentByBedroom).map(([k, v]) => [k, { min: v.min, max: v.max, avg: v.avg }])
    ),
    totalUnitsTracked: units?.length || 0,
    recentPriceChanges: priceChanges?.length || 0,
    marketTrend,
    lastUpdated: new Date().toISOString()
  }

  return NextResponse.json({ summary })
}

// Competitor Comparison
async function getCompetitorComparison(
  supabase: Awaited<ReturnType<typeof createClient>>, 
  propertyId: string,
  filter: string | null,
  isBedrooms: boolean
) {
  // Get all competitors with their units
  const { data: competitors } = await supabase
    .from('competitors')
    .select(`
      id,
      name,
      address,
      amenities,
      units:competitor_units(*)
    `)
    .eq('property_id', propertyId)
    .eq('is_active', true)

  const comparisons: CompetitorComparison[] = (competitors || []).map(comp => {
    let units = comp.units || []
    
    // Filter by bedrooms or unit type if specified
    if (filter) {
      if (isBedrooms) {
        const bedroomCount = parseInt(filter)
        units = units.filter((u: Record<string, unknown>) => u.bedrooms === bedroomCount)
      } else {
        units = units.filter((u: Record<string, unknown>) => u.unit_type === filter)
      }
    }

    // Calculate averages
    const rents = units
      .filter((u: Record<string, unknown>) => u.rent_min)
      .map((u: Record<string, unknown>) => u.rent_min as number)
    const avgRent = rents.length > 0 ? rents.reduce((a, b) => a + b, 0) / rents.length : 0

    // Calculate price per sqft
    const pricesPerSqft = units
      .filter((u: Record<string, unknown>) => u.rent_min && u.sqft_min)
      .map((u: Record<string, unknown>) => (u.rent_min as number) / (u.sqft_min as number))
    const avgPricePerSqft = pricesPerSqft.length > 0 
      ? pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length 
      : null

    return {
      competitor: {
        id: comp.id,
        name: comp.name,
        address: comp.address
      },
      units: units.map((u: Record<string, unknown>) => ({
        unitType: u.unit_type as string,
        bedrooms: u.bedrooms as number,
        rentMin: u.rent_min as number | null,
        rentMax: u.rent_max as number | null,
        sqftMin: u.sqft_min as number | null,
        sqftMax: u.sqft_max as number | null,
        pricePerSqft: u.rent_min && u.sqft_min 
          ? Math.round(((u.rent_min as number) / (u.sqft_min as number)) * 100) / 100 
          : null,
        availableCount: u.available_count as number || 0
      })),
      avgRent: Math.round(avgRent),
      avgPricePerSqft: avgPricePerSqft ? Math.round(avgPricePerSqft * 100) / 100 : null,
      amenities: comp.amenities || []
    }
  })

  // Sort by average rent
  comparisons.sort((a, b) => a.avgRent - b.avgRent)

  return NextResponse.json({ comparisons })
}

// Price Trends
async function getPriceTrends(
  supabase: Awaited<ReturnType<typeof createClient>>, 
  propertyId: string,
  filter: string | null,
  isBedrooms: boolean,
  days: number
) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Get competitor IDs for this property
  const { data: competitors } = await supabase
    .from('competitors')
    .select('id')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  const competitorIds = competitors?.map(c => c.id) || []

  if (competitorIds.length === 0) {
    return NextResponse.json({ trends: [] })
  }

  // Get unit IDs, optionally filtered by bedrooms or unit type
  let unitsQuery = supabase
    .from('competitor_units')
    .select('id')
    .in('competitor_id', competitorIds)

  if (filter) {
    if (isBedrooms) {
      const bedroomCount = parseInt(filter)
      unitsQuery = unitsQuery.eq('bedrooms', bedroomCount)
    } else {
      unitsQuery = unitsQuery.eq('unit_type', filter)
    }
  }

  const { data: units } = await unitsQuery
  const unitIds = units?.map(u => u.id) || []

  if (unitIds.length === 0) {
    return NextResponse.json({ trends: [] })
  }

  // Get price history
  const { data: history } = await supabase
    .from('competitor_price_history')
    .select('*')
    .in('competitor_unit_id', unitIds)
    .gte('recorded_at', startDate.toISOString())
    .order('recorded_at', { ascending: true })

  // Group by date and calculate daily averages
  const dailyData: Record<string, { rents: number[]; mins: number[]; maxes: number[] }> = {}

  history?.forEach(record => {
    if (typeof record.recorded_at !== 'string') {
      return
    }

    const date = new Date(record.recorded_at).toISOString().split('T')[0]
    if (!dailyData[date]) {
      dailyData[date] = { rents: [], mins: [], maxes: [] }
    }
    if (record.rent_min) {
      dailyData[date].rents.push(record.rent_min)
      dailyData[date].mins.push(record.rent_min)
    }
    if (record.rent_max) {
      dailyData[date].maxes.push(record.rent_max)
    }
  })

  const trends: PriceTrend[] = Object.entries(dailyData)
    .map(([date, data]) => ({
      date,
      avgRent: data.rents.length > 0 
        ? Math.round(data.rents.reduce((a, b) => a + b, 0) / data.rents.length) 
        : 0,
      minRent: data.mins.length > 0 ? Math.min(...data.mins) : 0,
      maxRent: data.maxes.length > 0 ? Math.max(...data.maxes) : 0,
      dataPoints: data.rents.length
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ trends })
}

// Market Position
async function getMarketPosition(
  supabase: Awaited<ReturnType<typeof createClient>>, 
  propertyId: string,
  filter: string | null,
  isBedrooms: boolean
) {
  // Get all competitors with units
  const { data: competitors } = await supabase
    .from('competitors')
    .select(`
      id,
      name,
      units:competitor_units(unit_type, bedrooms, rent_min, rent_max, sqft_min)
    `)
    .eq('property_id', propertyId)
    .eq('is_active', true)

  // Calculate market statistics
  const allUnits: Array<{
    competitor: string
    unitType: string
    bedrooms: number
    rentMin: number
    rentMax: number
    sqftMin: number | null
  }> = []

  competitors?.forEach(comp => {
    (comp.units || []).forEach((u: Record<string, unknown>) => {
      if (u.rent_min) {
        // Apply filter based on type
        let matchesFilter = true
        if (filter) {
          if (isBedrooms) {
            const bedroomCount = parseInt(filter)
            matchesFilter = u.bedrooms === bedroomCount
          } else {
            matchesFilter = u.unit_type === filter
          }
        }
        
        if (matchesFilter) {
          allUnits.push({
            competitor: comp.name,
            unitType: u.unit_type as string,
            bedrooms: u.bedrooms as number,
            rentMin: u.rent_min as number,
            rentMax: (u.rent_max as number) || (u.rent_min as number),
            sqftMin: u.sqft_min as number | null
          })
        }
      }
    })
  })

  // Group by unit type
  const positionByType: Record<string, {
    unitType: string
    competitors: number
    avgRent: number
    minRent: number
    maxRent: number
    rentRange: { competitor: string; rent: number }[]
  }> = {}

  allUnits.forEach(unit => {
    const key = unit.unitType
    if (!positionByType[key]) {
      positionByType[key] = {
        unitType: key,
        competitors: 0,
        avgRent: 0,
        minRent: Infinity,
        maxRent: 0,
        rentRange: []
      }
    }
    positionByType[key].competitors++
    positionByType[key].avgRent += unit.rentMin
    positionByType[key].minRent = Math.min(positionByType[key].minRent, unit.rentMin)
    positionByType[key].maxRent = Math.max(positionByType[key].maxRent, unit.rentMax)
    positionByType[key].rentRange.push({
      competitor: unit.competitor,
      rent: unit.rentMin
    })
  })

  // Calculate averages and sort rent ranges
  Object.values(positionByType).forEach(pos => {
    pos.avgRent = Math.round(pos.avgRent / pos.competitors)
    if (pos.minRent === Infinity) pos.minRent = 0
    pos.rentRange.sort((a, b) => a.rent - b.rent)
  })

  return NextResponse.json({ 
    position: Object.values(positionByType),
    totalCompetitors: competitors?.length || 0,
    totalUnits: allUnits.length
  })
}

