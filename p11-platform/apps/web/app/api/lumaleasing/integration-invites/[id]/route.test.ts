import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),revoke:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/integration-auth-invites',()=>({revokeIntegrationAuthInvite:d.revoke}))
import {DELETE} from './route'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555',id='66666666-6666-4666-8666-666666666666'
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.revoke.mockResolvedValue({state:'revoked',actionEventId:requestId})})
const invoke=(body:unknown={propertyId,requestId})=>DELETE(new NextRequest(`http://localhost/api/lumaleasing/integration-invites/${id}`,{method:'DELETE',body:JSON.stringify(body)}),{params:Promise.resolve({id})})
it('authenticates before looking up invitation authority',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await invoke()).status).toBe(401);expect(d.revoke).not.toHaveBeenCalled()})
it('requires a stable decision identity',async()=>{expect((await invoke({propertyId})).status).toBe(400);expect(d.revoke).not.toHaveBeenCalled()})
it('rejects another property',async()=>{d.access.mockResolvedValue({authorized:false});expect((await invoke()).status).toBe(403);expect(d.revoke).not.toHaveBeenCalled()})
it('returns the recorded revocation result',async()=>{const r=await invoke();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({state:'revoked',actionEventId:requestId});expect(d.revoke).toHaveBeenCalledWith({propertyId,actorId:'actor',inviteId:id,requestId})})
it('reports a used link without claiming revocation',async()=>{d.revoke.mockResolvedValue({state:'already_used',actionEventId:requestId});const r=await invoke();expect(r.status).toBe(409);expect(await r.json()).toMatchObject({success:false,state:'already_used',actionEventId:requestId})})
it('does not acknowledge an unconfirmed decision',async()=>{d.revoke.mockRejectedValue(new Error('Save unavailable'));expect((await invoke()).status).toBe(500)})
