import {beforeEach,describe,it,expect,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),read:vi.fn(),complete:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/brief-store',()=>({briefRpc:mocks.rpc,readSavedBrief:mocks.read,completeSavedBrief:mocks.complete}))
import {GET,POST,PUT} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='11111111-1111-1111-1111-111111111111'
const req=(query='',body?:unknown)=>{const r=new Request(`http://localhost/api/marketvision/brief?propertyId=${propertyId}${query}`,body?{method:'POST',body:JSON.stringify(body)}:undefined)as NextRequest;Object.defineProperty(r,'nextUrl',{value:new URL(r.url)});return r}
describe('exact saved brief API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor')})
 it.each([401,403])('preserves authentication/access denial %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await GET(req())).status).toBe(status);expect(mocks.read).not.toHaveBeenCalled()})
 it('returns a real empty history and private caching',async()=>{mocks.read.mockResolvedValue({state:'ready',reports:[],nextCursor:null});const r=await GET(req());expect(r.headers.get('cache-control')).toBe('private, no-store');expect(await r.json()).toMatchObject({reports:[]})})
 it('omits raw private source snapshot from detail',async()=>{mocks.read.mockResolvedValue({state:'ready',report:{id:requestId,source_snapshot:{private:'source'},result:{saved:'result'}}});expect((await(await GET(req(`&requestId=${requestId}`))).json()).report).toEqual({id:requestId,result:{saved:'result'}})})
 it('saves identity and reason before computing the retained report',async()=>{mocks.rpc.mockResolvedValue({state:'prepared'});mocks.complete.mockResolvedValue({state:'ready',requestId});const r=await POST(req('',{propertyId,requestId,windowDays:30,reason:'Reviewed report scope'}));expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('begin_marketvision_brief',{p_id:requestId,p_property_id:propertyId,p_actor_id:'actor',p_input:{windowDays:30,reason:'Reviewed report scope'}});expect(mocks.complete).toHaveBeenCalledWith(propertyId,'actor',requestId)})
 it('records explicit recovery before completing the original request',async()=>{mocks.rpc.mockResolvedValue({state:'saved'});mocks.complete.mockResolvedValue({state:'ready'});await PUT(req('',{propertyId,requestId,briefId:requestId,expectedVersion:1,reason:'Complete exact retained source'}));expect(mocks.rpc).toHaveBeenCalledWith('recover_marketvision_brief',expect.objectContaining({p_input:{briefId:requestId,expectedVersion:1,reason:'Complete exact retained source'}}))})
 it.each([{windowDays:1.5},{windowDays:0},{windowDays:367},{source_snapshot:{}},{result:{}}])('rejects unsupported or forged input %j',async extra=>{expect((await POST(req('',{propertyId,requestId,windowDays:30,reason:'Review scope',...extra}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('keeps report failure visible',async()=>{mocks.read.mockRejectedValue(new MarketStoreError('Unavailable'));expect((await GET(req())).status).toBe(503)})
})
