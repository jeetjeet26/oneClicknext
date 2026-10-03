import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),read:vi.fn(),save:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.user}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/integration-replacement',()=>({readReplacementReview:d.read,requestReplacement:d.save,replacementMessages:{stale_review:'Reload the review.'}}))
import {GET,POST} from './route'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',body={propertyId,requestId,capability:'email',provider:'google',accountEmail:'next@example.invalid',revision:'a'.repeat(64),acknowledgeHistory:true}
const get=()=>new NextRequest(`http://localhost/api/lumaleasing/integration-replacement?propertyId=${propertyId}&capability=email`)
const post=(input:unknown=body)=>new NextRequest('http://localhost/api/lumaleasing/integration-replacement',{method:'POST',body:JSON.stringify(input)})
beforeEach(()=>{vi.clearAllMocks();d.user.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.read.mockResolvedValue({state:'review'});d.save.mockResolvedValue({state:'ready',replacementId:requestId,actionEventId:requestId})})
it('requires authentication for review and decision',async()=>{d.user.mockResolvedValue({data:{user:null}});expect((await GET(get())).status).toBe(401);expect((await POST(post())).status).toBe(401);expect(d.read).not.toHaveBeenCalled();expect(d.save).not.toHaveBeenCalled()})
it('checks property membership before reading or saving',async()=>{d.access.mockResolvedValue({authorized:false});expect((await GET(get())).status).toBe(403);expect((await POST(post())).status).toBe(403);expect(d.read).not.toHaveBeenCalled();expect(d.save).not.toHaveBeenCalled()})
it('returns private uncached review',async()=>{const response=await GET(get());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(d.read).toHaveBeenCalledWith(propertyId,'actor','email')})
it.each([{...body,acknowledgeHistory:false},{...body,accountEmail:'bad'},{...body,capability:'both'},{...body,revision:'bad'},{...body,actorId:'someone-else'}])('rejects incomplete or expanded decisions %#',async input=>{expect((await POST(post(input))).status).toBe(400);expect(d.save).not.toHaveBeenCalled()})
it('saves the operator decision before returning a scoped authorization entry',async()=>{const response=await POST(post()),data=await response.json();expect(response.status).toBe(200);expect(data.startUrl).toBe(`/api/lumaleasing/integrations/oauth/google/start?propertyId=${propertyId}&capabilities=email&replacementId=${requestId}`);expect(d.save).toHaveBeenCalledWith({...body,actorId:'actor'})})
it('returns a stale review as an explicit conflict',async()=>{d.save.mockResolvedValue({state:'stale_review'});const response=await POST(post());expect(response.status).toBe(409);expect((await response.json()).error).toContain('Reload');})
it('read and save errors do not expose internal details',async()=>{d.read.mockRejectedValue(new Error('SECRET'));d.save.mockRejectedValue(new Error('SECRET'));for(const r of [await GET(get()),await POST(post())]){expect(r.status).toBe(503);expect(await r.text()).not.toContain('SECRET')}})
