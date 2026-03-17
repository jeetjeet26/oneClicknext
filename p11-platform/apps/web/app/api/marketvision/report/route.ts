/**
 * MarketVision 360 - Competitive Report Generation API
 * Generate comprehensive market analysis reports
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface MarketReport {
  generatedAt: string
  propertyName: string
  period: {
    start: string
    end: string
  }
  summary: {
    competitorCount: number
    avgMarketRent: number
    marketTrend: 'rising' | 'falling' | 'stable'
    priceChangesCount: number
  }
  competitorBreakdown: {
    name: string
    avgRent: number
    unitsTracked: number
    amenities: string[]
  }[]
  unitTypeAnalysis: {
    unitType: string
    avgRent: number
    minRent: number
    maxRent: number
    competitorsTracking: number
  }[]
  recentChanges: {
    competitor: string
    type: 'price_drop' | 'price_increase'
    oldValue: number
    newValue: number
    changePercent: number
    date: string
  }[]
  recommendations: string[]
}

// GET: Generate a competitive market report
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const format = searchParams.get('format') || 'json' // json, summary

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get property info
    const { data: property } = await supabase
      .from('properties')
      .select('name')
      .eq('id', propertyId)
      .single()

    // Get all competitors with units
    const { data: competitors } = await supabase
      .from('competitors')
      .select(`
        id,
        name,
        amenities,
        units:competitor_units(
          unit_type,
          bedrooms,
          rent_min,
          rent_max
        )
      `)
      .eq('property_id', propertyId)
      .eq('is_active', true)

    // Get recent price change alerts
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: alerts } = await supabase
      .from('market_alerts')
      .select(`
        alert_type,
        data,
        created_at,
        competitor:competitors(name)
      `)
      .eq('property_id', propertyId)
      .in('alert_type', ['price_drop', 'price_increase'])
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })

    // Calculate statistics
    const allUnits: { unitType: string; rentMin: number; rentMax: number; competitorName: string }[] = []
    const competitorBreakdown: MarketReport['competitorBreakdown'] = []

    competitors?.forEach(comp => {
      const units = comp.units || []
      const rents = units.filter((u: Record<string, unknown>) => u.rent_min).map((u: Record<string, unknown>) => u.rent_min as number)
      const avgRent = rents.length > 0 ? Math.round(rents.reduce((a, b) => a + b, 0) / rents.length) : 0

      competitorBreakdown.push({
        name: comp.name,
        avgRent,
        unitsTracked: units.length,
        amenities: comp.amenities || []
      })

      units.forEach((u: Record<string, unknown>) => {
        if (u.rent_min) {
          allUnits.push({
            unitType: u.unit_type as string,
            rentMin: u.rent_min as number,
            rentMax: (u.rent_max as number) || (u.rent_min as number),
            competitorName: comp.name
          })
        }
      })
    })

    // Sort by average rent
    competitorBreakdown.sort((a, b) => a.avgRent - b.avgRent)

    // Group by unit type
    const unitTypeMap: Record<string, { rents: number[]; mins: number[]; maxes: number[]; competitors: Set<string> }> = {}
    allUnits.forEach(u => {
      if (!unitTypeMap[u.unitType]) {
        unitTypeMap[u.unitType] = { rents: [], mins: [], maxes: [], competitors: new Set() }
      }
      unitTypeMap[u.unitType].rents.push(u.rentMin)
      unitTypeMap[u.unitType].mins.push(u.rentMin)
      unitTypeMap[u.unitType].maxes.push(u.rentMax)
      unitTypeMap[u.unitType].competitors.add(u.competitorName)
    })

    const unitTypeAnalysis: MarketReport['unitTypeAnalysis'] = Object.entries(unitTypeMap)
      .map(([unitType, data]) => ({
        unitType,
        avgRent: Math.round(data.rents.reduce((a, b) => a + b, 0) / data.rents.length),
        minRent: Math.min(...data.mins),
        maxRent: Math.max(...data.maxes),
        competitorsTracking: data.competitors.size
      }))
      .sort((a, b) => {
        const order = ['Studio', '1BR', '2BR', '3BR', '4BR+']
        return order.indexOf(a.unitType) - order.indexOf(b.unitType)
      })

    // Process recent changes
    const recentChanges: MarketReport['recentChanges'] = (alerts || [])
      .filter(a => a.data && (a.data as Record<string, unknown>).old_price && (a.data as Record<string, unknown>).new_price)
      .map(a => ({
        competitor: (() => {
          const c = a.competitor as unknown
          const competitorObj = Array.isArray(c) ? c[0] : c
          const competitorRecord = competitorObj as Record<string, unknown> | null
          return (typeof competitorRecord?.name === 'string' ? competitorRecord.name : 'Unknown')
        })(),
        type: a.alert_type as 'price_drop' | 'price_increase',
        oldValue: (a.data as Record<string, unknown>).old_price as number,
        newValue: (a.data as Record<string, unknown>).new_price as number,
        changePercent: (a.data as Record<string, unknown>).change_percent as number,
        date: a.created_at || new Date().toISOString()
      }))

    // Calculate market trend
    const increases = recentChanges.filter(c => c.type === 'price_increase').length
    const decreases = recentChanges.filter(c => c.type === 'price_drop').length
    let marketTrend: 'rising' | 'falling' | 'stable' = 'stable'
    if (increases > decreases + 2) marketTrend = 'rising'
    if (decreases > increases + 2) marketTrend = 'falling'

    // Calculate overall market average
    const avgMarketRent = allUnits.length > 0
      ? Math.round(allUnits.reduce((sum, u) => sum + u.rentMin, 0) / allUnits.length)
      : 0

    // Generate recommendations
    const recommendations: string[] = []

    if (competitorBreakdown.length > 0) {
      const lowestCompetitor = competitorBreakdown[0]
      const highestCompetitor = competitorBreakdown[competitorBreakdown.length - 1]
      
      if (lowestCompetitor.avgRent < avgMarketRent * 0.9) {
        recommendations.push(`${lowestCompetitor.name} is pricing significantly below market (${Math.round((1 - lowestCompetitor.avgRent / avgMarketRent) * 100)}% below average). Monitor for increased lead competition.`)
      }
      
      if (highestCompetitor.avgRent > avgMarketRent * 1.1) {
        recommendations.push(`${highestCompetitor.name} commands premium pricing (${Math.round((highestCompetitor.avgRent / avgMarketRent - 1) * 100)}% above average). Analyze their amenities and value proposition.`)
      }
    }

    if (marketTrend === 'rising') {
      recommendations.push('Market rents are trending upward. Consider gradual rent increases on renewals.')
    } else if (marketTrend === 'falling') {
      recommendations.push('Market rents are trending downward. Focus on retention and value-add improvements.')
    }

    if (recentChanges.filter(c => c.type === 'price_drop').length > 3) {
      recommendations.push('Multiple competitors have reduced rents recently. Evaluate concession strategies.')
    }

    const report: MarketReport = {
      generatedAt: new Date().toISOString(),
      propertyName: property?.name || 'Unknown Property',
      period: {
        start: thirtyDaysAgo.toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      summary: {
        competitorCount: competitors?.length || 0,
        avgMarketRent,
        marketTrend,
        priceChangesCount: recentChanges.length
      },
      competitorBreakdown,
      unitTypeAnalysis,
      recentChanges: recentChanges.slice(0, 10), // Top 10 recent changes
      recommendations
    }

    if (format === 'summary') {
      // Return condensed summary for quick display
      return NextResponse.json({
        summary: report.summary,
        topCompetitors: report.competitorBreakdown.slice(0, 5),
        recommendations: report.recommendations,
        generatedAt: report.generatedAt
      })
    }

    return NextResponse.json({ report })
  } catch (error) {
    console.error('MarketVision Report Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Store a generated market insight
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, insightType, periodStart, periodEnd, data } = body

    if (!propertyId || !insightType || !data) {
      return NextResponse.json({ error: 'propertyId, insightType, and data required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: insight, error } = await supabase
      .from('market_insights')
      .insert({
        property_id: propertyId,
        insight_type: insightType,
        period_start: periodStart,
        period_end: periodEnd,
        data,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      })
      .select()
      .single()

    if (error) {
      console.error('Error storing insight:', error)
      return NextResponse.json({ error: 'Failed to store insight' }, { status: 500 })
    }

    return NextResponse.json({ success: true, insight }, { status: 201 })
  } catch (error) {
    console.error('MarketVision Report POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

