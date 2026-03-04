/**
 * Ad Performance Sync Cron
 * Processes all active ad connections (Google Ads + Meta Ads)
 * Called by Vercel cron every 6 hours
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { syncGoogleAdsConnection } from '@/app/api/integrations/google-ads/sync/route'
import { syncMetaAdsConnection } from '@/app/api/integrations/meta-ads/sync/route'

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    // Fetch all active ad connections
    const { data: connections, error } = await supabase
      .from('ad_account_connections')
      .select('id, property_id, platform, account_id')
      .eq('is_active', true)

    if (error) {
      console.error('[Ad Sync Cron] Failed to fetch connections:', error)
      return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
    }

    if (!connections || connections.length === 0) {
      console.log('[Ad Sync Cron] No active ad connections to sync')
      return NextResponse.json({ message: 'No connections to sync', synced: 0 })
    }

    console.log(`[Ad Sync Cron] Processing ${connections.length} active connections`)

    const results: Array<{ platform: string; accountId: string; synced: number; error?: string }> = []

    for (const conn of connections) {
      let result: { synced: number; error?: string }

      switch (conn.platform) {
        case 'google_ads':
          result = await syncGoogleAdsConnection(conn.id, conn.account_id, conn.property_id)
          break
        case 'meta_ads':
          result = await syncMetaAdsConnection(conn.id, conn.account_id, conn.property_id)
          break
        default:
          result = { synced: 0, error: `Unsupported platform: ${conn.platform}` }
      }

      results.push({
        platform: conn.platform,
        accountId: conn.account_id,
        synced: result.synced,
        error: result.error,
      })
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const failures = results.filter(r => r.error)

    console.log(`[Ad Sync Cron] Complete: ${totalSynced} rows synced, ${failures.length} failures`)

    return NextResponse.json({
      success: true,
      totalConnections: connections.length,
      totalSynced,
      failures: failures.length,
      results,
    })
  } catch (err) {
    console.error('[Ad Sync Cron] Fatal error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
