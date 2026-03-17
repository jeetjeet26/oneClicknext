/**
 * Google Ads Performance Data Sync
 * Fetches campaign performance data via GAQL and upserts to fact_marketing_performance
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ADS_API_VERSION = 'v18'

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

function inferRetryableGoogleError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('timeout') ||
    normalized.includes('temporar') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('http 5') ||
    normalized.includes('api error 5') ||
    normalized.includes('token exchange failed: 5')
  )
}

function toAdSyncError(error: unknown, fallback: string): AdSyncError {
  if (error instanceof AdSyncError) {
    return error
  }

  if (error instanceof Error) {
    return new AdSyncError(error.message, inferRetryableGoogleError(error.message))
  }

  return new AdSyncError(fallback, true)
}

function requireGoogleAdsEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new AdSyncError(`${name} not configured`, false)
  }
  return value
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, init)
      if (res.ok || res.status < 500) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error('Fetch failed')
}

async function getAccessToken(): Promise<string> {
  const response = await fetchWithRetry(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireGoogleAdsEnv('GOOGLE_ADS_CLIENT_ID'),
      client_secret: requireGoogleAdsEnv('GOOGLE_ADS_CLIENT_SECRET'),
      refresh_token: requireGoogleAdsEnv('GOOGLE_ADS_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  }, 3)

  if (!response.ok) {
    throw new AdSyncError(`Token exchange failed: ${response.status}`, isRetryableStatus(response.status))
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
  const developerToken = requireGoogleAdsEnv('GOOGLE_ADS_DEVELOPER_TOKEN')
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

  const response = await fetchWithRetry(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'login-customer-id': cleanLoginId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
    3
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new AdSyncError(
      `Google Ads API error ${response.status}: ${errorText}`,
      isRetryableStatus(response.status)
    )
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
 * Sync Google Ads performance data for a specific ad connection
 */
export async function syncGoogleAdsConnection(
  connectionId: string,
  accountId: string,
  propertyId: string,
  daysBack: number = 7
): Promise<{ synced: number; error?: string; retryable?: boolean }> {
  try {
    const accessToken = await getAccessToken()
    const mccId = requireGoogleAdsEnv('GOOGLE_ADS_CUSTOMER_ID')

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
      await markConnectionSyncSuccess(connectionId, 0)
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
    let upsertErrorMessage: string | null = null
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50)
      const { error } = await supabase
        .from('fact_marketing_performance')
        .upsert(batch, { onConflict: 'date,property_id,campaign_id' })

      if (error) {
        console.error('[Google Ads Sync] Upsert error:', error)
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
    const syncError = toAdSyncError(err, 'Unknown error')
    const errorMsg = syncError.message
    console.error(`[Google Ads Sync] Failed for account ${accountId}:`, errorMsg)
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

    const result = await syncGoogleAdsConnection(connectionId, accountId, propertyId, daysBack || 7)

    return NextResponse.json({
      success: !result.error,
      synced: result.synced,
      error: result.error,
      retryable: result.retryable ?? false,
    })
  } catch (error) {
    console.error('[Google Ads Sync] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
