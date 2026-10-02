import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/handoff-store',()=>({handoffRpc:mocks.rpc}))
import {POST,PUT,GET} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='11111111-1111-1111-1111-111111111111'
const req=(body:unknown,method='POST')=>new NextRequest('http://localhost/api/marketvision/handoffs',{method,body:JSON.stringify(body)})
const prepare={propertyId,requestId,briefId:requestId,expectedVersion:2,recommendationId:requestId,expectedReviewId:requestId,title:'Review verified amenities',objective:'Review approved property differentiators',channel:'facebook',format:'image',reason:'Reviewed comparison draft'}
const decision={propertyId,requestId,handoffId:requestId,expectedVersion:1,draftHash:'a'.repeat(64),decision:'approve',reason:'Approve exact draft'}
describe('saved handoff routes',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor');mocks.rpc.mockResolvedValue({state:'saved'})})
 it.each([401,403])('checks current authorization before source access %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await POST(req(prepare))).status).toBe(status);expect((await PUT(req(decision,'PUT'))).status).toBe(status);expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}`))).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each(['sourceFacts','recommendation','confidence','executionPayload','actorId','orgId'])('rejects forged %s',async key=>{expect((await POST(req({...prepare,[key]:{fake:true}}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('preserves request, review and report identity',async()=>{const response=await POST(req(prepare));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');const input=Object.fromEntries(Object.entries(prepare).filter(([key])=>!(['propertyId','requestId'].includes(key))));expect(mocks.rpc).toHaveBeenCalledWith('prepare_marketvision_handoff',{p_id:requestId,p_property_id:propertyId,p_actor_id:'actor',p_input:input})})
 it.each(['approve','reject','withdraw'])('records %s through the same atomic contract',async value=>{expect((await PUT(req({...decision,decision:value},'PUT'))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('decide_marketvision_handoff',expect.objectContaining({p_input:{handoffId:requestId,expectedVersion:1,draftHash:decision.draftHash,decision:value,reason:decision.reason}}))})
 it.each([{draftHash:undefined},{expectedVersion:0},{decision:'modify'},{reason:'x'},{draft:{title:'different'}}])('rejects incomplete or mutable approval %j',async change=>{expect((await PUT(req({...decision,...change},'PUT'))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each([{channel:'instagram',format:'text'},{channel:'tiktok',format:'image'},{channel:'unknown',format:'image'}])('rejects incompatible destinations %j',async value=>{expect((await POST(req({...prepare,...value}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('reads one exact handoff within both property and brief scope',async()=>{expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}&briefId=${requestId}&handoffId=${requestId}`))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('read_marketvision_handoffs',{p_property_id:propertyId,p_actor_id:'actor',p_brief_id:requestId,p_handoff_id:requestId,p_cursor:null})})
 it.each([`propertyId=${propertyId}&propertyId=${propertyId}`,`propertyId=${propertyId}&handoffId=${requestId}&cursor=${requestId}`,`propertyId=${propertyId}&limit=999`])('rejects ambiguous or unbounded reads %s',async query=>{expect((await GET(new NextRequest(`http://localhost/?${query}`))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('surfaces uncertain writes for same-identity recovery',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Could not confirm'));expect((await PUT(req(decision,'PUT'))).status).toBe(503)})
})
