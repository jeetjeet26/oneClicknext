import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./engagement-sync',()=>({measurementRpc:rpc}))
import {recordAttributionEvent} from './attribution'
const base={trackingToken:'token',eventType:'lead' as const,anonymousSubject:'private-subject-123',occurredAt:'2026-09-17T12:00:00Z',metadata:{sourceSystem:'crm',sourceEventId:'private-event-id'}}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('ATTRIBUTION_HASH_SECRET','fixture-secret');rpc.mockResolvedValue({state:'saved',publicationId:'publication',eventId:'event',evidenceKind:'system_report',eventState:'active'})})
afterEach(()=>vi.unstubAllEnvs())
describe('reported attribution evidence',()=>{
 it('uses a stable source event identity across delivery times and hides raw subject identifiers',async()=>{await recordAttributionEvent(base);await recordAttributionEvent({...base,occurredAt:'2026-09-17T15:00:00Z'});const first=rpc.mock.calls[0][1],second=rpc.mock.calls[1][1];expect(first.p_source_event_hash).toBe(second.p_source_event_hash);expect(first.p_occurred_at).not.toBe(second.p_occurred_at);expect(JSON.stringify(rpc.mock.calls)).not.toContain('private-subject-123');expect(JSON.stringify(rpc.mock.calls)).not.toContain('private-event-id')})
 it('does not change source identity just because a different publication token is supplied',async()=>{await recordAttributionEvent(base);await recordAttributionEvent({...base,trackingToken:'another-token'});expect(rpc.mock.calls[0][1].p_source_event_hash).toBe(rpc.mock.calls[1][1].p_source_event_hash)})
 it('requires exact event time and source identity for a business outcome report',async()=>{await expect(recordAttributionEvent({...base,occurredAt:undefined})).rejects.toThrow(/exact source event/);await expect(recordAttributionEvent({...base,metadata:{}})).rejects.toThrow(/exact source event/);expect(rpc).not.toHaveBeenCalled()})
 it('enforces a server measurement window rather than accepting a caller-specific window',async()=>{await expect(recordAttributionEvent({...base,attributionWindowDays:90})).rejects.toThrow(/30-day/);expect(rpc).not.toHaveBeenCalled()})
 it('surfaces changed source evidence as a conflict rather than a duplicate conversion',async()=>{rpc.mockResolvedValue({state:'source_event_conflict'});await expect(recordAttributionEvent(base)).rejects.toThrow(/different saved attribution/)})
 it('does not call a replayed business report newly recorded',async()=>{rpc.mockResolvedValue({state:'replayed',publicationId:'publication',eventId:'event',evidenceKind:'system_report',eventState:'excluded'});expect((await recordAttributionEvent(base)).recorded).toBe(false)})
 it('keeps redirect observations in their privacy bucket without asserting landing-page views',async()=>{await recordAttributionEvent({...base,eventType:'landing_view',metadata:undefined});expect(rpc).toHaveBeenCalledWith('record_forgestudio_attribution',expect.objectContaining({p_event_type:'landing_view',p_source_system:'tracked_redirect',p_subject_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}))})
})
