import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.auth}})}))
vi.mock('@/utils/crm/workspace',()=>({crmRpc:m.rpc}))
import {GET} from './route'
const property='33333333-3333-3333-3333-333333333333',req=(p=property)=>new NextRequest('http://local/api/crm/monitor?propertyId='+p)
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({data:{user:{id:'actor'}},error:null})})
describe('Receipt-backed CRM overview',()=>{
 it('rejects signed-out and malformed scope before reading',async()=>{expect((await GET(req('invalid'))).status).toBe(400);m.auth.mockResolvedValue({data:{user:null},error:null});expect((await GET(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled()})
 it('uses server identity and uncached current property results',async()=>{m.rpc.mockResolvedValue({state:'saved',counts:{confirmed:1,needs_reconciliation:2},legacyLeads:4});const r=await GET(req());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(m.rpc).toHaveBeenCalledWith('read_crm_monitor',{p_property_id:property,p_actor_id:'actor'});expect((await r.json()).counts.needs_reconciliation).toBe(2)})
 it('does not substitute zeros for missing permission or a failed read',async()=>{m.rpc.mockResolvedValue({state:'forbidden'});expect((await GET(req())).status).toBe(403);m.rpc.mockRejectedValue(new Error('private database detail'));const r=await GET(req());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('private database detail')})
})
