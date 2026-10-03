import {beforeEach, describe, expect, it, vi} from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/utils/supabase/admin', () => ({createServiceClient: () => ({rpc})}))
import {recordTourOutcome, outcomeFailure, findTourForOutcome} from './tour-outcomes'
import type {createServiceClient} from '@/utils/supabase/admin'
const input = {actorId:'actor',requestId:'request',propertyId: 'property', leadId: 'lead', source: 'tour_bookings' as const, tourId: 'tour', outcome: 'completed' as const}
describe('tour outcomes', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses one transaction for the outcome and authenticated operator action', async () => {
    rpc.mockResolvedValue({data: {state: 'applied', outcome: {id: 'receipt'}}, error: null})
    await recordTourOutcome({...input, notes: 'Attended'})
    expect(rpc).toHaveBeenCalledWith('apply_recorded_tour_action', {p_property_id: 'property', p_lead_id: 'lead', p_source: 'tour_bookings', p_tour_id: 'tour',p_actor_id:'actor',p_request_id:'request',p_action:'tour.outcome.recorded',p_input:{outcome:'completed',notes:'Attended'}})
  })
  it.each([{data: null, error: null}, {data: null, error: {message: 'storage failed'}}, {data: {state: 'applied'}, error: null}])('rejects an unconfirmed write: %j', async response => {
    rpc.mockResolvedValue(response)
    await expect(recordTourOutcome(input)).rejects.toThrow()
  })
  it.each(['applied','replayed','legacy'] as const)('accepts %s receipts', state => expect(outcomeFailure({state})).toBeNull())
  it.each(['conflict','not_due','needs_timezone','delivery_busy','delivery_review_required'] as const)('reports %s as a recoverable conflict', state => expect(outcomeFailure({state})?.status).toBe(409))
  it('reports missing tours', () => expect(outcomeFailure({state: 'not_found'})?.status).toBe(404))
  it('refuses ambiguous identifiers instead of updating the wrong source', async () => {
    const query = {eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({data: {id: 'tour'}, error: null})}
    const db = {from: vi.fn(() => ({select: () => query}))} as unknown as ReturnType<typeof createServiceClient>
    await expect(findTourForOutcome(db, 'tour')).rejects.toThrow('Ambiguous')
  })
  it('never treats a database read error as a missing tour', async () => {
    const query = {eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({data: null, error: {message: 'offline'}})}
    const db = {from: vi.fn(() => ({select: () => query}))} as unknown as ReturnType<typeof createServiceClient>
    await expect(findTourForOutcome(db, 'tour')).rejects.toThrow('Unable')
  })
})
