import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 2): Promise<Response> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options)
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts) {
        const delay = 1000 * attempt
        console.warn(`[Review Sync] Retry ${attempt}/${maxAttempts} after ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

// Vercel CRON - runs every hour
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/sync-reviews", "schedule": "0 * * * *" }] }

export async function GET(request: NextRequest) {
  // Verify CRON secret for security
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // In development, allow without auth
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // Get all active review platform connections that need syncing
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    
    const { data: connections, error: fetchError } = await supabase
      .from('review_platform_connections')
      .select(`
        *,
        properties (id, name, org_id)
      `)
      .eq('is_active', true)
      .in('sync_frequency', ['hourly', 'realtime'])
      .or(`last_sync_at.is.null,last_sync_at.lt.${oneHourAgo}`)
      .lt('error_count', 5) // Skip connections with too many errors
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(20)

    if (fetchError) {
      console.error('Error fetching connections:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No connections to sync',
        synced: 0
      })
    }

    const results: Array<{
      connectionId: string
      propertyId: string
      platform: string
      status: 'success' | 'failed'
      imported?: number
      error?: string
    }> = []

    for (const connection of connections) {
      try {
        const syncRes = await fetchWithRetry(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/reviewflow/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: connection.property_id,
            platform: connection.platform,
            connectionId: connection.id
          })
        })

        const syncData = await syncRes.json()

        if (syncRes.ok) {
          results.push({
            connectionId: connection.id,
            propertyId: connection.property_id,
            platform: connection.platform,
            status: 'success',
            imported: syncData.imported || 0
          })
        } else {
          results.push({
            connectionId: connection.id,
            propertyId: connection.property_id,
            platform: connection.platform,
            status: 'failed',
            error: syncData.error
          })
        }
      } catch (syncError) {
        console.error(`Error syncing connection ${connection.id}:`, syncError)
        results.push({
          connectionId: connection.id,
          propertyId: connection.property_id,
          platform: connection.platform,
          status: 'failed',
          error: syncError instanceof Error ? syncError.message : 'Unknown error'
        })
      }
    }

    const synced = results.filter(r => r.status === 'success').length
    const failed = results.filter(r => r.status === 'failed').length
    const totalImported = results.reduce((sum, r) => sum + (r.imported || 0), 0)

    return NextResponse.json({
      success: true,
      synced,
      failed,
      totalImported,
      results
    })

  } catch (error) {
    console.error('CRON sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CRON job failed' },
      { status: 500 }
    )
  }
}

