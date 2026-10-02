import {beforeEach,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),review:vi.fn(),admin:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:d.admin}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/tour-calendar-review',async original=>({...await original<typeof import('@/utils/services/tour-calendar-review')>(),reviewCalendarChange:d.review}))
import {POST} from './route'
const body={action:'refresh',propertyId:'33333333-3333-3333-3333-333333333333',bookingId:'2f0081fa-f8dd-4a61-aabd-367b7919ba84'}
const call=(value:unknown=body)=>POST(new Request('http://localhost/api/lumaleasing/tours/calendar-review',{method:'POST',body:JSON.stringify(value)}) as NextRequest)
beforeEach(()=>{vi.resetAllMocks();d.user.mockResolvedValue({data:{user:{id:'verified-actor'}}});d.access.mockResolvedValue({authorized:true});d.admin.mockReturnValue('db');d.review.mockResolvedValue({state:'refreshed'})})
it('checks membership before privileged service access',async()=>{d.access.mockResolvedValue({authorized:false});expect((await call()).status).toBe(403);expect(d.admin).not.toHaveBeenCalled();expect(d.review).not.toHaveBeenCalled()})
it('requires authentication',async()=>{d.user.mockResolvedValue({data:{user:null}});expect((await call()).status).toBe(401);expect(d.review).not.toHaveBeenCalled()})
it('uses the verified actor and prohibits cached responses',async()=>{const result=await call();expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store');expect(d.review).toHaveBeenCalledWith('db','verified-actor',body)})
it('rejects client-supplied actor or evidence',async()=>{expect((await call({...body,actorId:'someone'})).status).toBe(400);expect(d.review).not.toHaveBeenCalled()})
it('returns a recoverable outage without exposing provider details',async()=>{d.review.mockRejectedValue(new Error('provider-token-secret'));const result=await call();expect(result.status).toBe(503);expect(await result.text()).not.toContain('provider-token-secret')})
it.each(['stale','provider_changed','binding_conflict','unsupported_change','delivery_busy','unavailable','calendar_review_required'])('returns a conflict for %s',async state=>{d.review.mockResolvedValue({state});expect((await call()).status).toBe(409)})
it('does not advertise an unknown result as success',async()=>{d.review.mockResolvedValue({state:'unknown'});expect((await call()).status).toBe(503)})
