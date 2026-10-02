import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),read:vi.fn(),fetch:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/intake-store',async original=>({...await original<typeof import('@/utils/marketvision/intake-store')>(),intakeRpc:mocks.rpc,readIntake:mocks.read}))
import {GET,POST,PUT} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='11111111-1111-1111-1111-111111111111'
const req=(body:unknown,method='POST')=>new NextRequest('http://localhost/api/competitors/intake',{method,body:JSON.stringify(body)})
const input={propertyId,requestId,rawText:'  North (Test City): from $2000.  ',reason:'Review operator notes'}
const decision={propertyId,requestId,intakeId:requestId,expectedVersion:1,previewHash:'a'.repeat(64),action:'apply',reason:'Review all candidates',acknowledgeUnverified:true,candidates:[{id:requestId,action:'skip'}]}
describe('recorded competitor intake API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor');mocks.rpc.mockResolvedValue({state:'saved'});mocks.read.mockResolvedValue({state:'ready'});vi.stubGlobal('fetch',mocks.fetch)})
 it.each([401,403])('requires current access before reading or changing saved intake %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await POST(req(input))).status).toBe(status);expect((await PUT(req(decision,'PUT'))).status).toBe(status);expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}`))).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled()})
 it('saves exact input plus server-parsed suggestions without dispatching enrichment',async()=>{const res=await POST(req(input));expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('private, no-store');expect(mocks.rpc).toHaveBeenCalledWith('begin_marketvision_intake',expect.objectContaining({p_id:requestId,p_property_id:propertyId,p_actor_id:'actor',p_input:{rawText:input.rawText,reason:input.reason},p_preview:[expect.objectContaining({name:'North',sourceText:'North (Test City): from $2000.'})]}));expect(mocks.fetch).not.toHaveBeenCalled()})
 it.each(['preview','actorId','orgId','enrich','model','verified'])('rejects forged %s',async key=>{expect((await POST(req({...input,[key]:true}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects old unsaved automatic-intake callers',async()=>{expect((await POST(req({propertyId,rawText:input.rawText}))).status).toBe(400);expect(mocks.fetch).not.toHaveBeenCalled()})
 it('applies only the exact approved selection through the atomic decision',async()=>{expect((await PUT(req(decision,'PUT'))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('decide_marketvision_intake',expect.objectContaining({p_actor_id:'actor',p_input:{intakeId:requestId,expectedVersion:1,previewHash:decision.previewHash,action:'apply',reason:decision.reason,acknowledgeUnverified:true,candidates:decision.candidates}}))})
 it('rejects duplicates and injected unit facts',async()=>{expect((await PUT(req({...decision,candidates:[...decision.candidates,...decision.candidates]},'PUT'))).status).toBe(400);expect((await PUT(req({...decision,units:[]},'PUT'))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('preserves uncertainty for same-request recovery',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Could not confirm'));expect((await PUT(req(decision,'PUT'))).status).toBe(503)})
 it('reads legacy source notes explicitly without enrichment',async()=>{expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}&view=legacy&requestId=${requestId}`))).status).toBe(200);expect(mocks.read).toHaveBeenCalledWith(propertyId,'actor',requestId,undefined,true);expect(mocks.fetch).not.toHaveBeenCalled()})
 it.each([`propertyId=${propertyId}&propertyId=${propertyId}`,`propertyId=${propertyId}&requestId=${requestId}&cursor=${requestId}`,`propertyId=${propertyId}&batchId=${requestId}`,`propertyId=${propertyId}&limit=1000`])('rejects ambiguous or unbounded reads %s',async query=>{expect((await GET(new NextRequest(`http://localhost/?${query}`))).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled()})
})
