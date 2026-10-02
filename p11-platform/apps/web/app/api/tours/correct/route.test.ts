import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {NextRequest} from 'next/server'
const mocks=vi.hoisted(() => ({auth:vi.fn(),find:vi.fn(),access:vi.fn(),correct:vi.fn(),rate:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mocks.access}))
vi.mock('@/utils/services/tour-outcomes',async original=>({...await original<object>(),findTourForOutcome:mocks.find,correctTourNoShow:mocks.correct}))
vi.mock('@/utils/services/rate-limiter',()=>({adminLimiter:{check:mocks.rate},getRateLimitKey:()=>'',rateLimitHeaders:()=>({})}))
import {POST} from './route'
const tourId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const body={tourId,requestId,reason:'Agent confirmed attendance'}
function request(value: unknown=body){return new Request('http://localhost/api/tours/correct',{method:'POST',body:JSON.stringify(value)}) as NextRequest}
describe('tour correction API',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();mocks.rate.mockReturnValue({allowed:true});mocks.auth.mockResolvedValue({data:{user:{id:'operator'}},error:null})
  mocks.find.mockResolvedValue({id:tourId,property_id:'property',lead_id:'lead',source:'tours'});mocks.access.mockResolvedValue({authorized:true})
  mocks.correct.mockResolvedValue({state:'applied',outcome:{notes:'Agent confirmed attendance',outcome_at:'2026-09-15T12:00:00Z',followup_state:'configured'},leadStatus:'toured',correction:{id:'correction',reason:body.reason,previousDelivery:'none'}})
 })
 it('requires authentication before reading tours',async()=>{
  mocks.auth.mockResolvedValue({data:{user:null}});expect((await POST(request())).status).toBe(401);expect(mocks.find).not.toHaveBeenCalled()
 })
 it('requires property access before correction',async()=>{
  mocks.access.mockResolvedValue({authorized:false});expect((await POST(request())).status).toBe(403);expect(mocks.correct).not.toHaveBeenCalled()
 })
 it.each([{...body,tourId:'bad'},{...body,requestId:'bad'},{...body,reason:'   '},{...body,reason:'x'.repeat(2001)},null])('rejects invalid correction input',async value=>{
  expect((await POST(request(value))).status).toBe(400);expect(mocks.correct).not.toHaveBeenCalled()
 })
 it('takes the actor from authentication, never the body',async()=>{
  const response=await POST(request({...body,actorId:'someone-else'}));expect(response.status).toBe(200)
  expect(mocks.correct).toHaveBeenCalledWith({...body,actorId:'operator',propertyId:'property',leadId:'lead',source:'tours'}, {})
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({tour:{id:tourId,status:'completed'},replayed:false,correction:{id:'correction'}})
 })
 it('replays a confirmed correction',async()=>{
  mocks.correct.mockResolvedValue({state:'replayed',outcome:{notes:body.reason},correction:{id:'original'}})
  expect(await (await POST(request())).json()).toMatchObject({replayed:true,correction:{id:'original'}})
 })
 it.each(['conflict','delivery_busy','delivery_review_required','history_conflict','request_conflict','not_due'])('surfaces %s without a success response',async state=>{
  mocks.correct.mockResolvedValue({state});const response=await POST(request());expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:state})
 })
 it('does not claim success after a storage failure',async()=>{
  mocks.correct.mockRejectedValue(new Error('rollback'));expect((await POST(request())).status).toBe(500)
 })
 it('returns missing tours without mutation',async()=>{
  mocks.find.mockResolvedValue(null);expect((await POST(request())).status).toBe(404);expect(mocks.correct).not.toHaveBeenCalled()
 })
})
