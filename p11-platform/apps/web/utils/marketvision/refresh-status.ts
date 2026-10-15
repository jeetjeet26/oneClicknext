import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
export interface RefreshStatus {
  paused: boolean
  enabled: boolean
  cadence: string
  lastCompletedAt: string | null
  latestObservationAt: string | null
  attempts: Array<{id:string;startedAt:string;finishedAt:string|null;result:string;updated:number}>
}
// Only return this property's outcome. Cron summaries may contain other tenants.
export function propertyRefreshOutcome(summary: unknown, propertyId: string) {
  if (!summary || typeof summary !== 'object' || !('outcomes' in summary) || !Array.isArray(summary.outcomes)) return null
  const row = summary.outcomes.find((o:unknown) => o && typeof o === 'object' && 'propertyId' in o && o.propertyId === propertyId)
  if (!row) return null
  const updated = Number.isInteger(row.updated) && row.updated >= 0 ? row.updated : 0
  return {updated, result: row.receipt === 'unconfirmed' ? 'unconfirmed' : row.success === true ? 'complete' : updated > 0 ? 'partial' : row.receipt === 'failed' ? 'failed' : 'unconfirmed'}
}
export async function readRefreshStatus(propertyId: string): Promise<RefreshStatus> {
  const db = createServiceClient()
  const [config, runs, observation] = await Promise.all([
    db.from('scrape_config').select('is_enabled,scrape_frequency,last_run_at').eq('property_id',propertyId).maybeSingle(),
    db.from('cron_job_runs').select('id,started_at,completed_at,summary').eq('job_name','scrape-competitors').contains('summary',{outcomes:[{propertyId}]}).order('started_at',{ascending:false}).limit(10),
    db.from('competitors').select('last_scraped_at').eq('property_id',propertyId).eq('is_active',true).not('last_scraped_at','is',null).order('last_scraped_at',{ascending:false}).limit(1),
  ])
  if(config.error || runs.error || observation.error) throw new MarketStoreError('Scheduled refresh history could not be loaded.')
  return {paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true',enabled:config.data?.is_enabled??false,cadence:config.data?.scrape_frequency??'manual',lastCompletedAt:config.data?.last_run_at??null,latestObservationAt:observation.data?.[0]?.last_scraped_at??null,
    attempts:(runs.data??[]).flatMap(r=>{const outcome=propertyRefreshOutcome(r.summary,propertyId);return outcome?[{id:r.id,startedAt:r.started_at,finishedAt:r.completed_at,...outcome}]:[]})}
}
