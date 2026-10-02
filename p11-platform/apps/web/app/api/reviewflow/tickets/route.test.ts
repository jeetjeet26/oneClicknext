import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const{auth,access,from}=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:auth}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from})}))
import {GET,DELETE,PATCH} from './route'
const propertyId='33333333-3333-4333-8333-333333333333'
const req=(query=`propertyId=${propertyId}`)=>new NextRequest(`http://localhost/api/reviewflow/tickets?${query}`)
function chain(data:unknown,error:unknown=null){const result={data,error},q={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn(),or:vi.fn(),single:vi.fn().mockResolvedValue(result),maybeSingle:vi.fn().mockResolvedValue(result),then:vi.fn()};for(const k of ['select','eq','order','limit','or'] as const)q[k].mockReturnValue(q);q.then.mockImplementation((r:(v:unknown)=>unknown)=>Promise.resolve(result).then(r));return q}
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({data:{user:{id:'operator'}},error:null});access.mockResolvedValue({authorized:true});from.mockImplementation((table:string)=>chain(table==='properties'?{org_id:'organization'}:[]))})
describe('ReviewFlow staff ticket API',()=>{
 it('requires access before reading any private ticket or property',async()=>{access.mockResolvedValue({authorized:false});expect((await GET(req())).status).toBe(403);expect(from).not.toHaveBeenCalled()})
 it('rejects unbounded filters and legacy unversioned mutations',async()=>{expect((await GET(req(`propertyId=${propertyId}&limit=10000`))).status).toBe(400);expect((await PATCH(new NextRequest('http://localhost/api/reviewflow/tickets',{method:'PATCH',body:JSON.stringify({id:'legacy',status:'resolved'})}))).status).toBe(400);expect(from).not.toHaveBeenCalled()})
 it('does not expose legacy cross-property source or cross-organization assignee links',async()=>{from.mockImplementation((table:string)=>chain(table==='properties'?{org_id:'organization'}:[{id:'ticket',reviews:{property_id:'elsewhere',review_text:'private'},assigned_user:{org_id:'elsewhere',full_name:'private'}}]));const r=await GET(req());expect(await r.json()).toEqual({tickets:[{id:'ticket',reviews:null,assigned_user:null}],nextCursor:null})})
 it('uses current real schema relations and keyset pagination',async()=>{const tickets=chain(Array.from({length:3},(_,i)=>({id:`ticket-${i}`,created_at:'2026-09-17'})));from.mockImplementation((table:string)=>table==='properties'?chain({org_id:'organization'}):tickets);const r=await GET(req(`propertyId=${propertyId}&status=open&limit=2`));expect(await r.json()).toMatchObject({nextCursor:'ticket-1'});expect(tickets.eq).toHaveBeenCalledWith('status','open');expect(tickets.select.mock.calls[0][0]).not.toMatch(/resolved_by|assigned_at/);expect(tickets.limit).toHaveBeenCalledWith(3)})
 it('keeps failed reads visible and retains historical tickets',async()=>{from.mockImplementation((table:string)=>table==='properties'?chain({org_id:'organization'}):chain(null,{message:'private failure'}));const r=await GET(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private failure');expect((await DELETE()).status).toBe(405)})
})
