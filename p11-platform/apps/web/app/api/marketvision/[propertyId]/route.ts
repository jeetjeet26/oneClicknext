import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import {
  getMarketingChannelFilterValues,
  normalizeMarketingChannelId,
  normalizeMarketingChannels,
} from '@/utils/analytics/channel-identity';

type AdAccountConnection = {
  platform: string | null;
  account_id: string | null;
  is_active: boolean | null;
};

type PerformanceRow = {
  channel_id?: string | null;
  channel?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  spend?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  conversions?: number | null;
};

/**
 * GET /api/marketvision/[propertyId]
 * 
 * Fetch marketing performance data for a specific property.
 * Can pull from historical data (fact_marketing_performance) 
 * or trigger real-time MCP sync.
 * 
 * Query params:
 * - dateRange: "7d" | "30d" | "90d" | custom
 * - channels: "google_ads,meta_ads" (comma-separated)
 * - realtime: "true" to trigger MCP sync
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const supabase = await createClient();
  const { propertyId } = await params;
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const searchParams = request.nextUrl.searchParams;
  const dateRange = searchParams.get('dateRange') || '30d';
  const channels = normalizeMarketingChannels(
    searchParams.get('channels')?.split(',') || ['google_ads', 'meta_ads']
  );
  const channelFilters = getMarketingChannelFilterValues(channels);
  const realtime = searchParams.get('realtime') === 'true';
  
  try {
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (realtime) {
      return NextResponse.json(
        {
          error: 'Real-time MarketVision sync is not available from this endpoint yet.',
          nextAction:
            'Use POST /api/marketvision/import to start an import job, then poll GET /api/marketvision/import for job status.',
        },
        { status: 409 }
      );
    }

    // Calculate date filter
    const daysAgo = parseInt(dateRange.replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);
    
    // Get property info and ad account connections (using EXISTING schema)
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select(`
        id,
        name,
        ad_account_connections!inner (
          platform,
          account_id,
          is_active
        )
      `)
      .eq('id', propertyId)
      .single();
    
    if (propError || !property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }
    
    // Get account IDs by platform
    const adAccountConnections = Array.isArray(property.ad_account_connections)
      ? (property.ad_account_connections as AdAccountConnection[])
      : [];
    const googleAccount = adAccountConnections.find(
      (c) => c.platform === 'google_ads' && c.is_active === true
    );
    const metaAccount = adAccountConnections.find(
      (c) => c.platform === 'meta_ads' && c.is_active === true
    );
    
    // Fetch historical data from fact_marketing_performance
    const { data: performance, error: perfError } = await supabase
      .from('fact_marketing_performance')
      .select('*')
      .eq('property_id', propertyId)
      .in('channel_id', channelFilters)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: false });
    
    if (perfError) {
      return NextResponse.json(
        { error: 'Failed to fetch performance data' },
        { status: 500 }
      );
    }
    
    // Aggregate data by channel and campaign
    const aggregated = aggregatePerformance(performance || []);
    
    return NextResponse.json({
      property: {
        id: property.id,
        name: property.name,
        google_ads_account: googleAccount?.account_id,
        meta_ads_account: metaAccount?.account_id,
      },
      date_range: {
        start: startDate.toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
        days: daysAgo,
      },
      channels: aggregated.by_channel,
      campaigns: aggregated.by_campaign,
      totals: aggregated.totals,
      raw_data: performance,
    });
    
  } catch (error) {
    console.error('MarketVision API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Aggregate performance data for dashboard display
 */
function aggregatePerformance(data: PerformanceRow[]) {
  const by_channel: Record<string, {
    channel: string;
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
    campaigns: Set<string>;
  }> = {};
  const by_campaign: Record<string, {
    campaign_id: string;
    campaign_name: string;
    channel: string;
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
  }> = {};
  
  const totals = {
    spend: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
  };
  
  data.forEach(row => {
    // By channel (using channel_id from existing schema)
    const channel = normalizeMarketingChannelId(row.channel_id || row.channel || 'unknown');
    const campaignId = row.campaign_id || 'unknown';
    const campaignName = row.campaign_name || 'Unknown campaign';
    const channelBucket = by_channel[channel] ?? {
      channel,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      campaigns: new Set<string>(),
    };
    by_channel[channel] = channelBucket;
    channelBucket.spend += row.spend || 0;
    channelBucket.clicks += row.clicks || 0;
    channelBucket.impressions += row.impressions || 0;
    channelBucket.conversions += row.conversions || 0;
    channelBucket.campaigns.add(campaignId);
    
    // By campaign
    const campaignKey = `${channel}_${campaignId}`;
    if (!by_campaign[campaignKey]) {
      by_campaign[campaignKey] = {
        campaign_id: campaignId,
        campaign_name: campaignName,
        channel,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      };
    }
    by_campaign[campaignKey].spend += row.spend || 0;
    by_campaign[campaignKey].clicks += row.clicks || 0;
    by_campaign[campaignKey].impressions += row.impressions || 0;
    by_campaign[campaignKey].conversions += row.conversions || 0;
    
    // Totals
    totals.spend += row.spend || 0;
    totals.clicks += row.clicks || 0;
    totals.impressions += row.impressions || 0;
    totals.conversions += row.conversions || 0;
  });
  
  const byChannelOutput = Object.values(by_channel).map((channelRow) => {
    const { campaigns, ...rest } = channelRow;
    return {
      ...rest,
      campaign_count: campaigns.size,
    };
  });
  
  return {
    by_channel: byChannelOutput,
    by_campaign: Object.values(by_campaign),
    totals,
  };
}

