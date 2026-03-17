import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'

type CampaignMetrics = {
  campaign_id: string
  campaign_name: string
  channel: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  first_date: string
  last_date: string
}

type CampaignTrend = {
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
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
  const campaignId = searchParams.get('campaignId') // Optional: for single campaign detail
  const channel = searchParams.get('channel') // Optional: filter by channel

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // If requesting a specific campaign's trend data
    if (campaignId) {
      let trendQuery = supabase
        .from('fact_marketing_performance')
        .select('date, impressions, clicks, spend, conversions')
        .eq('property_id', propertyId)
        .eq('campaign_id', campaignId)
        .order('date', { ascending: true })

      if (startDate) trendQuery = trendQuery.gte('date', startDate)
      if (endDate) trendQuery = trendQuery.lte('date', endDate)

      const { data: trendData, error: trendError } = await trendQuery

      if (trendError) {
        return NextResponse.json({ error: trendError.message }, { status: 500 })
      }

      const trends: CampaignTrend[] = (trendData || []).map(row => ({
        date: row.date,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend: Number(row.spend) || 0,
        conversions: Number(row.conversions) || 0,
      }))

      return NextResponse.json({ trends })
    }

    // Fetch all campaign data for the period
    let query = supabase
      .from('fact_marketing_performance')
      .select('*')
      .eq('property_id', propertyId)
      .order('date', { ascending: true })

    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    if (channel) query = query.eq('channel_id', channel)

    const { data, error } = await query

    if (error) {
      console.error('Error fetching campaign data:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Aggregate by campaign
    const campaignMap = new Map<string, {
      campaign_id: string
      campaign_name: string
      channel: string
      impressions: number
      clicks: number
      spend: number
      conversions: number
      first_date: string
      last_date: string
    }>()

    for (const row of data || []) {
      const key = row.campaign_id
      const existing = campaignMap.get(key) || {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name || row.campaign_id,
        channel: row.channel_id || 'unknown',
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        first_date: row.date,
        last_date: row.date,
      }

      existing.impressions += Number(row.impressions) || 0
      existing.clicks += Number(row.clicks) || 0
      existing.spend += Number(row.spend) || 0
      existing.conversions += Number(row.conversions) || 0
      
      if (row.date < existing.first_date) existing.first_date = row.date
      if (row.date > existing.last_date) existing.last_date = row.date

      campaignMap.set(key, existing)
    }

    // Calculate derived metrics
    const campaigns: CampaignMetrics[] = Array.from(campaignMap.values()).map(c => ({
      ...c,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
      cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
    }))

    // Sort by spend (highest first)
    campaigns.sort((a, b) => b.spend - a.spend)

    // Calculate totals
    const totals = {
      campaigns: campaigns.length,
      impressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
      clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
      spend: campaigns.reduce((sum, c) => sum + c.spend, 0),
      conversions: campaigns.reduce((sum, c) => sum + c.conversions, 0),
      avgCtr: 0,
      avgCpc: 0,
      avgCpa: 0,
    }

    totals.avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
    totals.avgCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
    totals.avgCpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0

    // Get unique channels for filtering
    const channels = [...new Set(campaigns.map(c => c.channel))]

    return NextResponse.json({
      campaigns,
      totals,
      channels,
      dateRange: {
        start: startDate,
        end: endDate,
      },
    })
  } catch (err) {
    console.error('Campaigns API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

