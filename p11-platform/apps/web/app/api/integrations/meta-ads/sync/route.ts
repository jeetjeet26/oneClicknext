/**
 * Meta Ads Performance Data Sync
 * Fetches campaign insights via Graph API and upserts to fact_marketing_performance
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const META_GRAPH_URL = 'https://graph.facebook.com/v19.0'
const FETCH_TIMEOUT_MS = 20000
const MAX_PAGES = 20

class AdSyncError extends Error {
  retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'AdSyncError'
    this.retryable = retryable
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function toMetaSyncError(error: unknown, fallback: string): AdSyncError {
  if (error instanceof AdSyncError) {
    return error
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase()
    const retryable =
      normalized.includes('timeout') ||
      normalized.includes('temporar') ||
      normalized.includes('rate limit') ||
      normalized.includes('too many requests') ||
      normalized.includes('fetch failed') ||
      normalized.includes('network') ||
      normalized.includes('meta ads api error 5')

    return new AdSyncError(error.message, retryable)
  }

  return new AdSyncError(fallback, true)
}

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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const response = await fetch(`${META_GRAPH_URL}/${actId}/insights?${params}`, { signal: controller.signal })
  clearTimeout(timeoutId)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new AdSyncError(
      `Meta Ads API error ${response.status}: ${JSON.stringify(errorData.error || errorData)}`,
      isRetryableStatus(response.status)
    )
  }

  const data = await response.json()
  const allResults: MetaCampaignInsight[] = [...(data.data || [])]

  // Handle pagination
  let nextUrl = data.paging?.next
  let pageCount = 0
  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount += 1
    const pageController = new AbortController()
    const pageTimeoutId = setTimeout(() => pageController.abort(), FETCH_TIMEOUT_MS)
    const pageResponse = await fetch(nextUrl, { signal: pageController.signal })
    clearTimeout(pageTimeoutId)
    if (!pageResponse.ok) break
    const pageData = await pageResponse.json()
    allResults.push(...(pageData.data || []))
    nextUrl = pageData.paging?.next
  }

  return allResults
}

async function markConnectionSyncFailure(
  connectionId: string,
  errorMessage: string
) {
  const supabase = createServiceClient()
  const { data: connection } = await supabase
    .from('ad_account_connections')
    .select('error_count')
    .eq('id', connectionId)
    .single()

  await supabase
    .from('ad_account_connections')
    .update({
      error_count: (connection?.error_count || 0) + 1,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
}

async function markConnectionSyncSuccess(
  connectionId: string,
  importedRows: number
) {
  const nowIso = new Date().toISOString()
  const payload: Record<string, string | number | null> = {
    last_synced_at: nowIso,
    error_count: 0,
    last_error: null,
    updated_at: nowIso,
  }

  if (importedRows > 0) {
    payload.last_imported_at = nowIso
  }

  await createServiceClient()
    .from('ad_account_connections')
    .update(payload)
    .eq('id', connectionId)
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
): Promise<{ synced: number; error?: string; retryable?: boolean }> {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN
    if (!accessToken) {
      throw new AdSyncError('META_ACCESS_TOKEN not configured', false)
    }

    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const insights = await fetchCampaignInsights(accessToken, accountId, startDate, endDate)

    if (insights.length === 0) {
      await markConnectionSyncSuccess(connectionId, 0)
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
    let upsertErrorMessage: string | null = null
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50)
      const { error } = await supabase
        .from('fact_marketing_performance')
        .upsert(batch, { onConflict: 'date,property_id,campaign_id' })

      if (error) {
        console.error('[Meta Ads Sync] Upsert error:', error)
        upsertErrorMessage = error.message
        break
      } else {
        synced += batch.length
      }
    }

    if (upsertErrorMessage) {
      await markConnectionSyncFailure(connectionId, upsertErrorMessage)
      return { synced, error: upsertErrorMessage, retryable: true }
    }

    await markConnectionSyncSuccess(connectionId, synced)

    return { synced }
  } catch (err) {
    const syncError = toMetaSyncError(err, 'Unknown error')
    const errorMsg = syncError.message
    console.error(`[Meta Ads Sync] Failed for account ${accountId}:`, errorMsg)
    await markConnectionSyncFailure(connectionId, errorMsg)
    return { synced: 0, error: errorMsg, retryable: syncError.retryable }
  }
}

// POST: Manual sync trigger (authenticated)
export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { connectionId, accountId, propertyId, daysBack } = await req.json()

    if (!connectionId || !accountId || !propertyId) {
      return NextResponse.json(
        { error: 'connectionId, accountId, and propertyId are required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await syncMetaAdsConnection(connectionId, accountId, propertyId, daysBack || 7)

    return NextResponse.json({
      success: !result.error,
      synced: result.synced,
      error: result.error,
      retryable: result.retryable ?? false,
    })
  } catch (error) {
    console.error('[Meta Ads Sync] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
