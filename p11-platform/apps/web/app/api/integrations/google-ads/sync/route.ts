/**
 * Google Ads Performance Data Sync
 * Fetches campaign performance data via GAQL and upserts to fact_marketing_performance
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ADS_API_VERSION = 'v18'

async function getAccessToken(): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  const data = await response.json()
  return data.access_token
}

interface CampaignRow {
  campaign: { id: string; name: string }
  metrics: {
    impressions: string
    clicks: string
    costMicros: string
    conversions: string
  }
  segments: { date: string }
}

async function fetchCampaignPerformance(
  accessToken: string,
  customerId: string,
  loginCustomerId: string,
  startDate: string,
  endDate: string
): Promise<CampaignRow[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date DESC
  `

  const cleanCustomerId = customerId.replace(/-/g, '')
  const cleanLoginId = loginCustomerId.replace(/-/g, '')

  const response = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'login-customer-id': cleanLoginId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Ads API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const rows: CampaignRow[] = []

  // searchStream returns array of result batches
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (batch.results) {
        rows.push(...batch.results)
      }
    }
  }

  return rows
}

/**
 * Sync Google Ads performance data for a specific ad connection
 */
export async function syncGoogleAdsConnection(
  connectionId: string,
  accountId: string,
  propertyId: string,
  daysBack: number = 7
): Promise<{ synced: number; error?: string }> {
  try {
    const accessToken = await getAccessToken()
    const mccId = process.env.GOOGLE_ADS_CUSTOMER_ID!

    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const rows = await fetchCampaignPerformance(
      accessToken,
      accountId,
      mccId,
      startDate,
      endDate
    )

    if (rows.length === 0) {
      return { synced: 0 }
    }

    const supabase = createServiceClient()

    // Transform and upsert rows
    const records = rows.map(row => ({
      date: row.segments.date,
      property_id: propertyId,
      channel_id: 'google_ads',
      campaign_id: row.campaign.id,
      campaign_name: row.campaign.name,
      impressions: parseInt(row.metrics.impressions || '0'),
      clicks: parseInt(row.metrics.clicks || '0'),
      spend: parseFloat(row.metrics.costMicros || '0') / 1_000_000, // Convert micros to dollars
      conversions: parseInt(row.metrics.conversions || '0'),
      raw_source: 'google_ads_api',
    }))

    // Upsert in batches of 50
    let synced = 0
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50)
      const { error } = await supabase
        .from('fact_marketing_performance')
        .upsert(batch, { onConflict: 'date,property_id,campaign_id' })

      if (error) {
        console.error('[Google Ads Sync] Upsert error:', error)
      } else {
        synced += batch.length
      }
    }

    // Update last_sync_at on the connection
    await supabase
      .from('ad_account_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', connectionId)

    return { synced }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[Google Ads Sync] Failed for account ${accountId}:`, errorMsg)
    return { synced: 0, error: errorMsg }
  }
}

// POST: Manual sync trigger (authenticated)
export async function POST(req: NextRequest) {
  try {
    const { connectionId, accountId, propertyId, daysBack } = await req.json()

    if (!connectionId || !accountId || !propertyId) {
      return NextResponse.json(
        { error: 'connectionId, accountId, and propertyId are required' },
        { status: 400 }
      )
    }

    const result = await syncGoogleAdsConnection(connectionId, accountId, propertyId, daysBack || 7)

    return NextResponse.json({
      success: !result.error,
      synced: result.synced,
      error: result.error,
    })
  } catch (error) {
    console.error('[Google Ads Sync] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
