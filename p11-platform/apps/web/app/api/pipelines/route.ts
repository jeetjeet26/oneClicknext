import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { PipelineSnapshot } from '@/utils/pipelines/monitor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HISTORY_LIMIT = 50
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

    const propertyId = request.nextUrl.searchParams.get('property_id')
    if (!propertyId || !UUID.test(propertyId)) {
      return NextResponse.json({ error: 'A valid property_id is required.' }, { status: 400, headers })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })

    // Keep the signed-in client and RLS in addition to the explicit ownership check.
    // Provider metadata and global cron summaries do not belong in a property view.
    const [connections, runs] = await Promise.all([
      supabase.from('ad_account_connections')
        .select('id, platform, account_name, is_active, last_synced_at, last_error, error_count')
        .eq('property_id', propertyId).order('created_at', { ascending: false }),
      supabase.from('import_jobs')
        .select('id, channels, status, progress_pct, current_step, records_imported, error_message, started_at, completed_at, created_at')
        .eq('property_id', propertyId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    ])
    if (connections.error || runs.error || !Array.isArray(connections.data) || !Array.isArray(runs.data)) {
      return NextResponse.json({ error: 'Pipeline records are unavailable. Try refreshing.' }, { status: 503, headers })
    }
    const snapshot: PipelineSnapshot = {
      property_id: propertyId, connections: connections.data, runs: runs.data,
      checked_at: new Date().toISOString(), history_limit: HISTORY_LIMIT,
    }
    return NextResponse.json(snapshot, { headers })
  } catch {
    return NextResponse.json({ error: 'Pipeline records are unavailable. Try refreshing.' }, { status: 503, headers })
  }
}
