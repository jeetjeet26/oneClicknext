/**
 * Meta Ads Performance Data Sync
 * Fetches campaign insights via Graph API and upserts to fact_marketing_performance
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'

const META_GRAPH_URL = 'https://graph.facebook.com/v19.0'

interface MetaCampaignInsight {
  campaign_id: string
  campaign_name: string
  impressions: string
  clicks: string
  spend: string
  actions?: Array<{ action_type: string; value: string }>
  date_start: string
  date_stop: string
}

async function fetchCampaignInsights(
  accessToken: string,
  accountId: string,
  startDate: string,
  endDate: string
): Promise<MetaCampaignInsight[]> {
  // Ensure account ID has act_ prefix
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`

  const params = new URLSearchParams({
    fields: 'campaign_id,campaign_name,impressions,clicks,spend,actions',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    time_increment: '1', // Daily breakdown
    level: 'campaign',
    limit: '500',
    access_token: accessToken,
  })

  const response = await fetch(`${META_GRAPH_URL}/${actId}/insights?${params}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `Meta Ads API error ${response.status}: ${JSON.stringify(errorData.error || errorData)}`
    )
  }

  const data = await response.json()
  const allResults: MetaCampaignInsight[] = [...(data.data || [])]

  // Handle pagination
  let nextUrl = data.paging?.next
  while (nextUrl) {
    const pageResponse = await fetch(nextUrl)
    if (!pageResponse.ok) break
    const pageData = await pageResponse.json()
    allResults.push(...(pageData.data || []))
    nextUrl = pageData.paging?.next
  }

  return allResults
}

/**
 * Extract conversions count from Meta actions array
 */
function extractConversions(actions?: Array<{ action_type: string; value: string }>): number {
  if (!actions) return 0
  // Count leads, purchases, and complete_registrations as conversions
  const conversionTypes = ['lead', 'purchase', 'complete_registration', 'submit_application']
  return actions
    .filter(a => conversionTypes.includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0'), 0)
}

/**
 * Sync Meta Ads performance data for a specific ad connection
 */
export async function syncMetaAdsConnection(
  connectionId: string,
  accountId: string,
  propertyId: string,
  daysBack: number = 7
): Promise<{ synced: number; error?: string }> {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN
    if (!accessToken) {
      return { synced: 0, error: 'META_ACCESS_TOKEN not configured' }
    }

    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const insights = await fetchCampaignInsights(accessToken, accountId, startDate, endDate)

    if (insights.length === 0) {
      return { synced: 0 }
    }

    const supabase = createServiceClient()

    // Transform and upsert rows
    const records = insights.map(row => ({
      date: row.date_start,
      property_id: propertyId,
      channel_id: 'meta',
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      impressions: parseInt(row.impressions || '0'),
      clicks: parseInt(row.clicks || '0'),
      spend: parseFloat(row.spend || '0'),
      conversions: extractConversions(row.actions),
      raw_source: 'meta_ads_api',
    }))

    // Upsert in batches of 50
    let synced = 0
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50)
      const { error } = await supabase
        .from('fact_marketing_performance')
        .upsert(batch, { onConflict: 'date,property_id,campaign_id' })

      if (error) {
        console.error('[Meta Ads Sync] Upsert error:', error)
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
    console.error(`[Meta Ads Sync] Failed for account ${accountId}:`, errorMsg)
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

    const result = await syncMetaAdsConnection(connectionId, accountId, propertyId, daysBack || 7)

    return NextResponse.json({
      success: !result.error,
      synced: result.synced,
      error: result.error,
    })
  } catch (error) {
    console.error('[Meta Ads Sync] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
