import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),queryResult=vi.fn(),filters=vi.fn(),selection=vi.fn()
function builder(){const q={select:(...a:unknown[])=>{selection(...a);return q},eq:(...a:unknown[])=>{filters(...a);return q},order:()=>q,limit:()=>q,or:()=>q,then:(yes:(v:unknown)=>unknown,no:(e:unknown)=>unknown)=>Promise.resolve(queryResult()).then(yes,no)};return q}
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:builder})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
const id='11111111-1111-4111-8111-111111111111'
const req=(query='')=>new Request('http://localhost/api/forgestudio/generations?propertyId='+id+query) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'user'}},error:null});access.mockResolvedValue({authorized:true,orgId:'organization'});queryResult.mockReturnValue({data:[],error:null})})
describe('generation history isolation',()=>{
 it('requires authentication before accessing private history',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await (await import('./route')).GET(req())).status).toBe(401);expect(queryResult).not.toHaveBeenCalled()})
 it('uses both current property and organization scope and omits raw input, credentials and claim token',async()=>{queryResult.mockReturnValue({data:[{id,state:'generating',raw_result_hash:'private-hash'}],error:null});const response=await (await import('./route')).GET(req());expect(response.status).toBe(200);expect(filters).toHaveBeenCalledWith('property_id',id);expect(filters).toHaveBeenCalledWith('org_id','organization');expect(selection.mock.calls[0][0]).not.toMatch(/claim_token|model_input|brief_snapshot|raw_result,/);expect((await response.json()).requests[0]).toEqual({id,state:'generating',hasSavedResult:true})})
 it('keeps earlier requests accessible with a stable page boundary',async()=>{queryResult.mockReturnValue({data:Array.from({length:51},(_,i)=>({id:'row-'+i,created_at:'2026-09-17T12:00:00Z',raw_result_hash:null})),error:null});const value=await (await (await import('./route')).GET(req())).json();expect(value.requests).toHaveLength(50);expect(JSON.parse(Buffer.from(value.nextCursor,'base64url').toString())).toEqual({at:'2026-09-17T12:00:00Z',id:'row-49'})})
 it('rejects invalid page input instead of querying another scope',async()=>{expect((await (await import('./route')).GET(req('&cursor=invalid'))).status).toBe(400);expect(queryResult).not.toHaveBeenCalled()})
 it('shows failed reads instead of an empty success',async()=>{queryResult.mockReturnValue({data:null,error:{message:'offline'}});expect((await (await import('./route')).GET(req())).status).toBe(503)})
})
