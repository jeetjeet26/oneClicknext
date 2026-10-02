/** Automatic no-show detection records outcomes and queues only eligible follow-ups. */
import {createServiceClient} from '@/utils/supabase/admin'
import {tourOutcomeDb, type TourSchedule} from './tour-outcomes'

export type NoShowReview = {
  state: 'due' | 'upcoming' | 'backoff' | 'review' | 'backlog' | 'needs_timezone' | 'ambiguous_time' | 'needs_lead'
  attempts: number; nextTryAt: string | null; errorCode: string | null
}
export interface NoShowResult {
  processed: number; markedNoShow: number; followupsSent: number; followupsQueued: number
  needsSetup: number; needsTimezone: number; needsReview: number; backlog: number
  deferred: number; failed: number; errors: string[]
}
export async function processTourNoShows(): Promise<NoShowResult> {
  const db = tourOutcomeDb(createServiceClient())
  const {data, error} = await db.rpc('list_tour_noshow_candidates', {p_limit:100})
  if (error || !data) throw new Error('Unable to load pending tour outcomes')
  const candidates = data as unknown as {tours: (TourSchedule & {scheduleVersion:number})[]; needsTimezone:number;needsReview:number;backlog:number;deferred:number}
  if (!Array.isArray(candidates.tours) || ![candidates.needsTimezone,candidates.needsReview,candidates.backlog,candidates.deferred].every(value=>Number.isInteger(value)&&value>=0)) throw new Error('Invalid tour candidate result')
  const result: NoShowResult = {
    processed:0,markedNoShow:0,followupsSent:0,followupsQueued:0,needsSetup:0,failed:0,errors:[],
    needsTimezone:candidates.needsTimezone,needsReview:candidates.needsReview,backlog:candidates.backlog,deferred:candidates.deferred,
  }
  for (const tour of candidates.tours) {
    result.processed++
    try {
      if (!Number.isInteger(tour.scheduleVersion) || tour.scheduleVersion<1) throw new Error('Invalid schedule version')
      const saved=await db.rpc('process_tour_noshow_attempt',{
        p_property_id:tour.propertyId,p_lead_id:tour.leadId,p_source:tour.source,p_tour_id:tour.id,p_version:tour.scheduleVersion,
      })
      if (saved.error || !saved.data) throw new Error('Unconfirmed attempt')
      const outcome=saved.data as {state:string;outcome?:{followup_state:string}}
      switch (outcome.state) {
        case 'applied':
          if (!outcome.outcome) throw new Error('Unconfirmed outcome')
          result.markedNoShow++
          if (outcome.outcome.followup_state==='configured') result.followupsQueued++
          if (outcome.outcome.followup_state==='not_configured') result.needsSetup++
          break
        case 'needs_timezone': result.needsTimezone++; break
        case 'review': case 'ambiguous_time': case 'needs_lead': result.needsReview++; break
        case 'backoff': result.deferred++; break
        case 'backlog': result.backlog++; break
        case 'replayed': case 'legacy': case 'conflict': case 'upcoming': case 'not_due': case 'not_found': case 'stale': case 'skipped': break
        default: throw new Error('Unknown tour outcome response')
      }
    } catch {
      result.failed++
      result.errors.push(`Tour ${tour.id}: processing could not be confirmed. The next run will check its saved attempt.`)
    }
  }
  return result
}

export async function getNoShowReview(db:ReturnType<typeof createServiceClient>,propertyId:string,leadId:string) {
  const {data,error}=await tourOutcomeDb(db).rpc('tour_noshow_queue',{p_property_id:propertyId,p_lead_id:leadId})
  if (error || !Array.isArray(data)) throw new Error('Unable to load automatic tour review status')
  const rows=data as unknown as (TourSchedule & {automation:NoShowReview})[]
  return new Map(rows.map(row=>[`${row.source}/${row.id}`,row.automation]))
}
export async function getNoShowStats(propertyId:string):Promise<{
  totalNoShows:number;followupsSent:number;followupsQueued:number;needsSetup:number;rescheduled:number
}> {
  const {data,error}=await tourOutcomeDb(createServiceClient()).rpc('tour_noshow_stats',{p_property_id:propertyId})
  if (error || !data) throw new Error('Unable to load no-show statistics')
  return data as unknown as {totalNoShows:number;followupsSent:number;followupsQueued:number;needsSetup:number;rescheduled:number}
}
