import { readMarketingFacts, MarketingReadError } from '@/utils/analytics/read-marketing-facts'
import { campaignIdentity } from '@/utils/analytics/marketing-fact'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'
import { getMarketingChannelFilterValues, normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

type CampaignMetrics = {
  campaign_id: string
  source_account_id: string | null
  campaign_key: string
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
  const sourceAccountId = searchParams.get('sourceAccountId')
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
      const trendData = await readMarketingFacts(supabase, {
        propertyId, startDate, endDate, campaignId, sourceAccountId,
        channels: channel ? getMarketingChannelFilterValues([channel]) : undefined,
      })

      const identities = new Set((trendData || []).map(row => campaignIdentity(row.channel_id, row.source_account_id, row.campaign_id)))
      if (identities.size > 1) return NextResponse.json({ error: 'Choose the campaign account and channel to view its daily trend' }, { status: 409 })

      const trends: CampaignTrend[] = (trendData || []).map(row => ({
        date: row.date,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend: Number(row.spend) || 0,
        conversions: Number(row.conversions) || 0,
      }))

      return NextResponse.json({ trends })
    }

    const data = await readMarketingFacts(supabase, {
      propertyId, startDate, endDate,
      channels: channel ? getMarketingChannelFilterValues([channel]) : undefined,
    })

    // Aggregate by campaign
    const campaignMap = new Map<string, {
      campaign_id: string
      source_account_id: string | null
      campaign_key: string
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
      const key = campaignIdentity(row.channel_id, row.source_account_id, row.campaign_id)
      const existing = campaignMap.get(key) || {
        campaign_id: row.campaign_id,
        source_account_id: row.source_account_id,
        campaign_key: key,
        campaign_name: row.campaign_name || row.campaign_id,
        channel: normalizeMarketingChannelId(row.channel_id),
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
    if (err instanceof MarketingReadError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('Campaigns API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

