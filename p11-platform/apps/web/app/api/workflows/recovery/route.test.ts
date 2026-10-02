import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),history:vi.fn(),lead:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:d.lead};return q}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/workflow-delivery',()=>({workflowDb:(db:unknown)=>db,listWorkflowDeliveries:d.history}))
vi.mock('@/utils/services/delivery-history',async()=>({...await vi.importActual('@/utils/services/delivery-history'),readLeadDeliveryHistory:d.history}))
import {GET,POST} from './route'
const lead='11111111-1111-4111-8111-111111111111',channel='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333'
const input={leadId:lead,deliveryId:channel,requestId:request,resolution:'accepted',reason:'Provider history reviewed',providerId:'provider-receipt'}
const post=(body:unknown=input)=>POST(new NextRequest('http://localhost/api/workflows/recovery',{method:'POST',body:JSON.stringify(body)}))
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.lead.mockResolvedValue({data:{property_id:'property'}});d.rpc.mockResolvedValue({data:{state:'applied',deliveryState:'accepted'}});d.history.mockResolvedValue({work:[],total:0,nextCursor:null})})
it('requires authentication before fetching history',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await GET(new NextRequest(`http://localhost/api/workflows/recovery?leadId=${lead}`))).status).toBe(401);expect(d.lead).not.toHaveBeenCalled()})
it('requires property access on review writes',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post()).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it('requires a receipt to claim provider acceptance',async()=>{expect((await post({...input,providerId:undefined})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('derives operator identity from the session and uses the saved property',async()=>{expect((await post({...input,actorId:'forged'})).status).toBe(200);expect(d.rpc).toHaveBeenCalledWith('review_recorded_workflow_delivery',expect.objectContaining({p_actor_id:'actor',p_property_id:'property',p_request_id:request}))})
it('retains uncertain write acknowledgement for safe same-request retry',async()=>{d.rpc.mockResolvedValue({error:{message:'response lost'}});const response=await post();expect(response.status).toBe(500);expect((await response.json()).error).toContain('unconfirmed')})
it('accepts an idempotent replay without sending a message',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',deliveryState:'queued'}});expect((await post({...input,resolution:'not_sent',providerId:undefined})).status).toBe(200)})
it.each(['busy','conflict','not_attempted','request_conflict'])('reports %s as a recoverable conflict',async state=>{d.rpc.mockResolvedValue({data:{state}});expect((await post()).status).toBe(409)})
it('does not disguise a failed history query as an empty list',async()=>{d.history.mockRejectedValue(new Error('database offline'));expect((await GET(new NextRequest(`http://localhost/api/workflows/recovery?leadId=${lead}`))).status).toBe(500)})

it('passes the authenticated actor and cursor to the complete history reader',async()=>{const response=await GET(new NextRequest(`http://localhost/api/workflows/recovery?leadId=${lead}&cursor=saved-page`));expect(response.status).toBe(200);expect(d.history).toHaveBeenCalledWith(expect.objectContaining({leadId:lead,actorId:'actor',propertyId:'property',cursor:'saved-page'}),expect.anything());expect(response.headers.get('cache-control')).toBe('private, no-store')})
