import {actionHistoryDb} from '@/utils/actions/history'
import type { Database, Json } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/utils/supabase/admin'

export type TourSource = 'tours' | 'tour_bookings'
export type TourOutcome = 'completed' | 'no_show'
export type OutcomeReceipt = {
  id: string; tour_id: string; tour_source: TourSource; outcome: TourOutcome
  recorded_at: string; outcome_at: string | null; notes: string | null; workflow_ids: string[]
  followup_state: 'configured' | 'not_configured' | 'suppressed' | 'legacy'
}
export type OutcomeResult = {
  state: 'applied' | 'replayed' | 'legacy' | 'forbidden' | 'request_conflict' | 'not_found' | 'conflict' | 'not_due' | 'needs_timezone' | 'delivery_busy' | 'delivery_review_required'
  outcome?: OutcomeReceipt
  status?: string
  leadStatus?: string
}
export type TourSchedule = {
  id: string; leadId: string; propertyId: string; source: TourSource; status: string
  date: string; time: string; startsAt: string | null; endsAt: string | null; timezone: string | null
}
type TourDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions' | 'Tables'> & {
  Tables: Database['public']['Tables'] & {tour_outcomes: {
    Row: OutcomeReceipt & {property_id: string; lead_id: string}
    Insert: never; Update: never; Relationships: []
  }; tour_outcome_corrections: {
    Row: {id: string; property_id: string; lead_id: string; tour_id: string; tour_source: TourSource; reason: string; recorded_at: string; previous_delivery: 'none' | 'sent' | 'unknown'}
    Insert: never; Update: never; Relationships: []
  }}
  Functions: Database['public']['Functions'] & {
    correct_tour_no_show: {Args: {p_property_id: string; p_lead_id: string; p_source: TourSource; p_tour_id: string; p_request_id: string; p_actor_id: string; p_reason: string}; Returns: Json}
    record_tour_outcome: { Args: { p_property_id: string; p_lead_id: string; p_source: TourSource; p_tour_id: string; p_outcome: TourOutcome; p_notes: string | null; p_automatic: boolean }; Returns: Json }
    process_tour_noshow_attempt: {Args: {p_property_id:string;p_lead_id:string;p_source:TourSource;p_tour_id:string;p_version:number}; Returns:Json}
    tour_noshow_queue: {Args: {p_property_id:string;p_lead_id:string}; Returns:Json[]}
    list_tour_noshow_candidates: { Args: {p_limit: number}; Returns: Json }
    tour_noshow_stats: { Args: {p_property_id: string}; Returns: Json }
  }
} }
export function tourOutcomeDb(db: SupabaseClient<Database>) {
  return db as unknown as SupabaseClient<TourDatabase>
}

export async function findTourForOutcome(db: SupabaseClient<Database>, id: string, leadId?: string) {
  // Check both sources; do not guess if a legacy identifier is ambiguous.
  const results = await Promise.all((['tours', 'tour_bookings'] as const).map(async source => {
    let query = db.from(source).select('id, lead_id, property_id, status').eq('id', id)
    if (leadId) query = query.eq('lead_id', leadId)
    const {data, error} = await query.maybeSingle()
    if (error) throw new Error('Unable to load tour')
    return data ? {...data, source} : null
  }))
  const matches = results.filter(result => result !== null)
  if (matches.length > 1) throw new Error('Ambiguous tour identifier')
  return matches[0] || null
}

export async function recordTourOutcome(input: {
  propertyId:string;leadId:string;source:TourSource;tourId:string;outcome:TourOutcome;notes?:string;actorId:string;requestId:string
},db=createServiceClient()):Promise<OutcomeResult> {
  const {data,error}=await actionHistoryDb(db).rpc('apply_recorded_tour_action',{
    p_property_id:input.propertyId,p_lead_id:input.leadId,p_source:input.source,p_tour_id:input.tourId,
    p_actor_id:input.actorId,p_request_id:input.requestId,p_action:'tour.outcome.recorded',p_input:{outcome:input.outcome,notes:input.notes??null},
  })
  if(error || !data)throw new Error('The tour outcome could not be confirmed. Retry the same request safely.')
  const result=data as unknown as OutcomeResult
  if(['applied','replayed','legacy'].includes(result.state)&&!result.outcome)throw new Error('The saved tour outcome could not be confirmed.')
  return result
}

export function outcomeFailure(result: OutcomeResult): {status: number; error: string} | null {
  switch (result.state) {
    case 'applied': case 'replayed': case 'legacy': return null
    case 'forbidden': return {status:403,error:'Forbidden'}
    case 'request_conflict': return {status:409,error:'This request was used for a different decision. Refresh the tour history.'}
    case 'not_found': return {status: 404, error: 'Tour not found'}
    case 'not_due': return {status: 409, error: 'This tour is not yet due for this outcome.'}
    case 'needs_timezone': return {status: 409, error: 'Set the property timezone before automatic no-show processing.'}
    case 'delivery_busy': return {status: 409, error: 'A tour message or calendar update is being processed. Please retry shortly.'}
    case 'delivery_review_required': return {status:409,error:'An earlier tour delivery attempt needs review before recording the outcome. No changes were saved.'}
    case 'conflict': return {status: 409, error: 'This tour already has a different final status.'}
    default: throw new Error('Unknown tour outcome response')
  }
}

export type TourCorrection = {
  id: string; reason: string; recordedAt: string; previousDelivery: 'none' | 'sent' | 'unknown'
  stoppedWorkflows?: number; reversedEvents?: number
}
export type CorrectionResult = Omit<OutcomeResult, 'state'> & {
  state: 'applied' | 'replayed' | 'not_found' | 'conflict' | 'not_due' | 'forbidden' | 'request_conflict' | 'delivery_busy' | 'delivery_review_required' | 'history_conflict'
  correction?: TourCorrection
}
export async function correctTourNoShow(input: {
  propertyId: string; leadId: string; source: TourSource; tourId: string; actorId: string; requestId: string; reason: string
}, db = createServiceClient()): Promise<CorrectionResult> {
  const {data, error} = await actionHistoryDb(db).rpc('apply_recorded_tour_action', {
    p_property_id: input.propertyId, p_lead_id: input.leadId, p_source: input.source, p_tour_id: input.tourId,
    p_actor_id: input.actorId, p_request_id: input.requestId, p_action:'tour.no_show.corrected',p_input:{reason:input.reason},
  })
  if (error || !data) throw new Error('The correction could not be saved. Retry to check the same request safely.')
  const result = data as unknown as CorrectionResult
  if (['applied','replayed'].includes(result.state) && (!result.outcome || !result.correction)) throw new Error('The saved correction could not be confirmed. Please retry.')
  return result
}
export function correctionFailure(result: CorrectionResult): {status: number; error: string} | null {
  switch (result.state) {
    case 'applied': case 'replayed': return null
    case 'not_found': return {status: 404, error: 'Tour not found'}
    case 'forbidden': return {status: 403, error: 'Forbidden'}
    case 'conflict': return {status: 409, error: 'Only a no-show can be corrected to completed. Refresh the tour history.'}
    case 'not_due': return {status: 409, error: 'This tour is scheduled for the future.'}
    case 'request_conflict': return {status: 409, error: 'This request was already used for a different correction. Refresh the tour history.'}
    case 'delivery_busy': return {status: 409, error: 'A tour message is being processed. Wait for it to finish, then retry.'}
    case 'delivery_review_required': return {status: 409, error: 'An earlier message attempt needs delivery review before this tour can be corrected. No changes were saved.'}
    case 'history_conflict': return {status: 409, error: 'The tour history has conflicting records and needs review. No changes were saved.'}
    default: throw new Error('Unknown correction response')
  }
}
export async function getTourOutcomeHistory(db: SupabaseClient<Database>, propertyId: string, leadId: string) {
  const [outcomes, corrections] = await Promise.all([
    tourOutcomeDb(db).from('tour_outcomes').select('tour_id,tour_source,notes').eq('property_id', propertyId).eq('lead_id', leadId),
    tourOutcomeDb(db).from('tour_outcome_corrections').select('id,tour_id,tour_source,reason,recorded_at,previous_delivery').eq('property_id', propertyId).eq('lead_id', leadId),
  ])
  if (outcomes.error || corrections.error) throw new Error('Unable to load tour outcome history')
  const byTour = new Map((corrections.data || []).map(item => [`${item.tour_source}/${item.tour_id}`, {
    id: item.id, reason: item.reason, recordedAt: item.recorded_at, previousDelivery: item.previous_delivery,
  }]))
  return (outcomes.data || []).map(item => ({...item, correction: byTour.get(`${item.tour_source}/${item.tour_id}`) ?? null}))
}
