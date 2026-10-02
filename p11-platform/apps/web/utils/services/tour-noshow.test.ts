import {beforeEach, describe, expect, it, vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),attempt:vi.fn(),list:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mocks.rpc})}))
import {processTourNoShows,getNoShowStats,getNoShowReview} from './tour-noshow'
import {createServiceClient} from '@/utils/supabase/admin'
const tour={id:'one',leadId:'lead',propertyId:'property',source:'tours',scheduleVersion:2}
const candidates={tours:[tour,{...tour,id:'two',source:'tour_bookings'}],needsTimezone:0,needsReview:0,backlog:0,deferred:0}
describe('bounded no-show processing',()=>{
 beforeEach(()=>{
  vi.resetAllMocks()
  mocks.rpc.mockImplementation((name:string,args:unknown)=>name==='process_tour_noshow_attempt'?mocks.attempt(args):mocks.list())
  mocks.list.mockResolvedValue({data:candidates,error:null})
  mocks.attempt.mockResolvedValue({data:{state:'applied',outcome:{followup_state:'configured'}},error:null})
 })
 it('covers both sources and passes the observed schedule version without sending',async()=>{
  expect(await processTourNoShows()).toMatchObject({processed:2,markedNoShow:2,followupsQueued:2,followupsSent:0,failed:0})
  expect(mocks.attempt).toHaveBeenCalledWith(expect.objectContaining({p_source:'tour_bookings',p_version:2}))
 })
 it('continues independent tours after an unconfirmed transaction',async()=>{
  mocks.attempt.mockRejectedValueOnce(new Error('offline'))
  const result=await processTourNoShows();expect(result).toMatchObject({processed:2,markedNoShow:1,failed:1})
  expect(result.errors[0]).toContain('could not be confirmed')
 })
 it.each(['replayed','legacy','conflict','not_due','not_found','stale','skipped','upcoming'])('does not double count %s',async state=>{
  mocks.attempt.mockResolvedValue({data:{state}});expect(await processTourNoShows()).toMatchObject({markedNoShow:0,followupsQueued:0,failed:0})
 })
 it('surfaces held backlog and retries without processing them again',async()=>{
  mocks.list.mockResolvedValue({data:{...candidates,tours:[],needsTimezone:4,needsReview:2,backlog:7,deferred:3}})
  expect(await processTourNoShows()).toMatchObject({processed:0,needsTimezone:4,needsReview:2,backlog:7,deferred:3})
  expect(mocks.attempt).not.toHaveBeenCalled()
 })
 it.each([['backoff','deferred'],['review','needsReview'],['ambiguous_time','needsReview'],['needs_timezone','needsTimezone'],['backlog','backlog']])('reports %s separately',async(state,key)=>{
  mocks.attempt.mockResolvedValue({data:{state}});expect(await processTourNoShows()).toMatchObject({[key]:2,markedNoShow:0})
 })
 it('requires an applied outcome receipt',async()=>{
  mocks.attempt.mockResolvedValue({data:{state:'applied'}});expect(await processTourNoShows()).toMatchObject({markedNoShow:0,failed:2})
 })
 it('fails loudly when the candidate contract is unavailable',async()=>{
  mocks.list.mockResolvedValue({data:null,error:{message:'offline'}})
  await expect(processTourNoShows()).rejects.toThrow();expect(mocks.attempt).not.toHaveBeenCalled()
 })
 it('keeps review load failure distinct from no reviews',async()=>{
  mocks.list.mockResolvedValue({data:null,error:{message:'offline'}})
  await expect(getNoShowReview(createServiceClient(),'property','lead')).rejects.toThrow('Unable to load')
 })
 it('scopes readable review status to the authenticated property and lead',async()=>{
  mocks.list.mockResolvedValue({data:[{...tour,automation:{state:'review',attempts:3}}]})
  expect((await getNoShowReview(createServiceClient(),'property','lead')).get('tours/one')).toEqual({state:'review',attempts:3})
  expect(mocks.rpc).toHaveBeenCalledWith('tour_noshow_queue',{p_property_id:'property',p_lead_id:'lead'})
 })
 it('does not show unavailable statistics as zero',async()=>{
  mocks.list.mockResolvedValue({data:null,error:{message:'offline'}});await expect(getNoShowStats('property')).rejects.toThrow()
 })
})
