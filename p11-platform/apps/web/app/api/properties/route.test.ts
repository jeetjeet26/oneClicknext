import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),profile:vi.fn(),list:vi.fn(),from:vi.fn(),scope:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from})}))
vi.mock('@/utils/services/request-context',()=>({createRequestContext:()=>({logStart:vi.fn(),logSuccess:vi.fn(),logError:vi.fn(),responseHeaders:{}})}))
vi.mock('@/utils/audit',()=>({logAuditEvent:vi.fn()}))
import {GET,POST,PATCH} from './route'
const get=()=>GET(new NextRequest('http://localhost/api/properties?orgId=forged'))
beforeEach(()=>{
 vi.resetAllMocks()
 d.auth.mockResolvedValue({data:{user:{id:'operator'}},error:null})
 d.profile.mockResolvedValue({data:{org_id:'trusted-org'},error:null})
 d.list.mockResolvedValue({data:[],error:null})
 d.from.mockImplementation((table:string)=>{
  const q={select:()=>q,eq:(...args:unknown[])=>{d.scope(table,...args);return q},single:d.profile,order:d.list}
  return q
 })
})
it('requires a signed-in operator',async()=>{d.auth.mockResolvedValue({data:{user:null},error:null});expect((await get()).status).toBe(401);expect(d.from).not.toHaveBeenCalled()})
it('does not turn a failed organization lookup into an empty property list',async()=>{d.profile.mockResolvedValue({data:null,error:{message:'Fixture database failure'}});const response=await get();expect(response.status).toBe(500);expect(await response.json()).not.toHaveProperty('properties');expect(d.list).not.toHaveBeenCalled()})
it('does not show an empty organization when the operator has no organization access',async()=>{d.profile.mockResolvedValue({data:{org_id:null},error:null});expect((await get()).status).toBe(403);expect(d.list).not.toHaveBeenCalled()})
it('returns a legitimate empty list only after a successful scoped lookup',async()=>{const response=await get();expect(response.status).toBe(200);expect(await response.json()).toEqual({properties:[]});expect(d.scope).toHaveBeenCalledWith('profiles','id','operator');expect(d.scope).toHaveBeenCalledWith('properties','org_id','trusted-org');expect(d.scope).not.toHaveBeenCalledWith('properties','org_id','forged')})
it('preserves failure when the property list itself is unavailable',async()=>{d.list.mockResolvedValue({data:null,error:{message:'Fixture list failure'}});expect((await get()).status).toBe(500)})

it('retires alternate unversioned create/edit writers while keeping authentication',async()=>{expect((await POST()).status).toBe(410);expect((await PATCH()).status).toBe(410);d.auth.mockResolvedValue({data:{user:null},error:null});expect((await POST()).status).toBe(401);expect((await PATCH()).status).toBe(401)})
