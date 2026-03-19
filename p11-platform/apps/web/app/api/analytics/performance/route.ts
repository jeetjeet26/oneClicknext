import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

type PerformanceRow = {
  date: string
  channel_id: string | null
  impressions: number | string | null
  clicks: number | string | null
  spend: number | string | null
  conversions: number | string | null
}

// Helper to aggregate performance data
function aggregateData(data: PerformanceRow[]) {
  const dateMap = new Map<string, {
    date: string
    impressions: number
    clicks: number
    spend: number
    conversions: number
  }>()

  const channelTotals = new Map<string, {
    channel: string
    impressions: number
    clicks: number
    spend: number
    conversions: number
  }>()

  for (const row of data || []) {
    // Time series aggregation
    const existing = dateMap.get(row.date) || {
      date: row.date,
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
    }
    
    existing.impressions += Number(row.impressions) || 0
    existing.clicks += Number(row.clicks) || 0
    existing.spend += Number(row.spend) || 0
    existing.conversions += Number(row.conversions) || 0
    
    dateMap.set(row.date, existing)

    // Channel aggregation
    const channel = normalizeMarketingChannelId(row.channel_id)
    const channelData = channelTotals.get(channel) || {
      channel,
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
    }
    
    channelData.impressions += Number(row.impressions) || 0
    channelData.clicks += Number(row.clicks) || 0
    channelData.spend += Number(row.spend) || 0
    channelData.conversions += Number(row.conversions) || 0
    
    channelTotals.set(channel, channelData)
  }

  const timeSeries = Array.from(dateMap.values())
  const channels = Array.from(channelTotals.values()).map(c => ({
    ...c,
    cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
  }))

  // Calculate totals
  const totals = {
    impressions: channels.reduce((sum, c) => sum + c.impressions, 0),
    clicks: channels.reduce((sum, c) => sum + c.clicks, 0),
    spend: channels.reduce((sum, c) => sum + c.spend, 0),
    conversions: channels.reduce((sum, c) => sum + c.conversions, 0),
    ctr: 0,
    cpa: 0,
  }
  
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  totals.cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0

  return { timeSeries, channels, totals }
}

// Calculate percentage change between two values
function calculateChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const propertyId = searchParams.get('propertyId')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const compareEnabled = searchParams.get('compare') === 'true'

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Fetch current period data
    let currentQuery = supabase
      .from('fact_marketing_performance')
      .select('*')
      .eq('property_id', propertyId)
      .order('date', { ascending: true })

    if (startDate) {
      currentQuery = currentQuery.gte('date', startDate)
    }
    if (endDate) {
      currentQuery = currentQuery.lte('date', endDate)
    }

    const { data: currentData, error: currentError } = await currentQuery

    if (currentError) {
      console.error('Error fetching performance data:', currentError)
      return NextResponse.json({ error: currentError.message }, { status: 500 })
    }

    const current = aggregateData((currentData || []) as PerformanceRow[])

    // If comparison is enabled, fetch previous period data
    let comparison = null
    if (compareEnabled && startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      const periodLength = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
      
      const previousEnd = new Date(start)
      previousEnd.setDate(previousEnd.getDate() - 1)
      const previousStart = new Date(previousEnd)
      previousStart.setDate(previousStart.getDate() - periodLength + 1)
      
      const prevStartStr = previousStart.toISOString().split('T')[0]
      const prevEndStr = previousEnd.toISOString().split('T')[0]

      const { data: prevData, error: prevError } = await supabase
        .from('fact_marketing_performance')
        .select('*')
        .eq('property_id', propertyId)
        .gte('date', prevStartStr)
        .lte('date', prevEndStr)
        .order('date', { ascending: true })

      if (!prevError && prevData) {
        const previous = aggregateData(prevData as PerformanceRow[])
        
        comparison = {
          previousPeriod: {
            start: prevStartStr,
            end: prevEndStr,
          },
          totals: previous.totals,
          changes: {
            spend: calculateChange(current.totals.spend, previous.totals.spend),
            clicks: calculateChange(current.totals.clicks, previous.totals.clicks),
            impressions: calculateChange(current.totals.impressions, previous.totals.impressions),
            conversions: calculateChange(current.totals.conversions, previous.totals.conversions),
            ctr: calculateChange(current.totals.ctr, previous.totals.ctr),
            cpa: previous.totals.cpa > 0 
              ? calculateChange(current.totals.cpa, previous.totals.cpa) 
              : null,
          },
          channelChanges: current.channels.map(currentChannel => {
            const prevChannel = previous.channels.find(c => c.channel === currentChannel.channel)
            return {
              channel: currentChannel.channel,
              spend: calculateChange(currentChannel.spend, prevChannel?.spend || 0),
              clicks: calculateChange(currentChannel.clicks, prevChannel?.clicks || 0),
              impressions: calculateChange(currentChannel.impressions, prevChannel?.impressions || 0),
              conversions: calculateChange(currentChannel.conversions, prevChannel?.conversions || 0),
            }
          }),
        }
      }
    }

    return NextResponse.json({
      timeSeries: current.timeSeries,
      channels: current.channels,
      totals: current.totals,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      comparison,
    })
  } catch (err) {
    console.error('Analytics API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

