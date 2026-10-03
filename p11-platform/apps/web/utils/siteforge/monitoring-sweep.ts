import { createServiceClient } from '@/utils/supabase/admin'
import type { Tables } from '@/types/supabase'

export type MonitoringWebsite = Pick<Tables<'property_websites'>,
  'id' | 'org_id' | 'property_id' | 'production_artifact_id' | 'production_content_hash' |
  'production_url' | 'production_target_id' | 'pages_generated'>
const columns = 'id,org_id,property_id,production_artifact_id,production_content_hash,production_url,production_target_id,pages_generated'

/** Stable ID pages and a saved cursor prevent later sites from starving at a fixed limit. */
export async function visitMonitoringSweep(input: {
  token: string
  websiteId?: string | null
  deadline: number
  visit: (websites: MonitoringWebsite[]) => Promise<void>
  now?: () => number
}, service = createServiceClient()) {
  const now = input.now || Date.now
  if (input.websiteId) {
    const found = await service.from('property_websites').select(columns).eq('id', input.websiteId)
      .not('production_url', 'is', null).not('production_certified_at', 'is', null)
    if (found.error) throw new Error(`Monitoring target could not be loaded: ${found.error.message}`)
    await input.visit(found.data || [])
    return { claimed: true, coverageComplete: true, processed: found.data?.length || 0, nextCursor: null }
  }
  const claim = await service.rpc('claim_siteforge_monitoring_sweep', { p_token: input.token })
  if (claim.error || !claim.data || typeof claim.data !== 'object' || Array.isArray(claim.data))
    throw new Error(`Monitoring sweep could not be claimed: ${claim.error?.message || 'No claim'}`)
  const state = claim.data as { claimed: boolean; afterId?: string | null; throughId?: string | null }
  if (!state.claimed) return { claimed: false, coverageComplete: false, processed: 0, nextCursor: null }
  let cursor = state.afterId || null
  let processed = 0
  try {
    await input.visit([])
    while (true) {
      // A bounded page finishes before checkpointing. An interrupted page is safely revisited.
      if (now() >= input.deadline) return { claimed: true, coverageComplete: false, processed, nextCursor: cursor }
      let rows: MonitoringWebsite[] = []
      if (state.throughId) {
        let query = service.from('property_websites').select(columns)
          .not('production_url', 'is', null).not('production_certified_at', 'is', null)
          .lte('id', state.throughId).order('id', { ascending: true }).limit(8)
        if (cursor) query = query.gt('id', cursor)
        const page = await query
        if (page.error) throw new Error(`Monitoring page could not be loaded: ${page.error.message}`)
        rows = page.data || []
      }
      if (rows.length) {
        await input.visit(rows)
        cursor = rows[rows.length - 1].id
        processed += rows.length
      }
      const complete = rows.length < 8
      const saved = await service.rpc('checkpoint_siteforge_monitoring_sweep', {
        p_token: input.token, p_after_id: cursor, p_complete: complete,
      })
      if (saved.error) throw new Error(`Monitoring cursor could not be saved: ${saved.error.message}`)
      if (complete) return { claimed: true, coverageComplete: true, processed, nextCursor: null }
    }
  } finally {
    const released = await service.rpc('release_siteforge_monitoring_sweep', { p_token: input.token })
    if (released.error) throw new Error(`Monitoring lease release was not confirmed: ${released.error.message}`)
  }
}
