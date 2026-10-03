import {beforeEach,describe,it,expect,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),read:vi.fn(),render:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/brief-store',()=>({briefRpc:mocks.rpc,readSavedBrief:mocks.read}))
vi.mock('@/utils/marketvision/brief-export',()=>({renderBriefExport:mocks.render}))
import {POST} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='11111111-1111-1111-1111-111111111111'
const req=(body:unknown)=>new Request('http://localhost/api/marketvision/brief/export',{method:'POST',body:JSON.stringify(body)})as NextRequest
const body={propertyId,requestId,briefId:requestId,expectedVersion:2,reason:'Review the exact report',format:'markdown'}
describe('recorded report export',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor');mocks.rpc.mockResolvedValue({state:'saved'});mocks.read.mockResolvedValue({state:'ready',report:{state:'ready',version:2,result:{exact:'stored report'}}});mocks.render.mockReturnValue('exact rendered bytes')})
 it.each([401,403])('requires current authorization %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await POST(req(body))).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects client-supplied evidence and content',async()=>{expect((await POST(req({...body,content:'forged',recommendation:{title:'fake'}}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('uses the exact report identity and decision contract',async()=>{const res=await POST(req(body));expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('private, no-store');expect(mocks.rpc).toHaveBeenCalledWith('export_marketvision_brief',expect.objectContaining({p_property_id:propertyId,p_actor_id:'actor',p_id:requestId,p_input:{briefId:requestId,expectedVersion:2,reason:body.reason,format:'markdown'}}));expect(mocks.render).toHaveBeenCalledWith({exact:'stored report'},'markdown');expect(mocks.rpc.mock.calls[0][1].p_content).toBe('exact rendered bytes')})
 it('does not confirm a failed write',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Cannot confirm'));expect((await POST(req(body))).status).toBe(503)})
 it('holds stale or unfinished reports',async()=>{mocks.read.mockResolvedValue({report:{state:'prepared',version:1,result:null}});expect((await POST(req(body))).status).toBe(409);expect(mocks.render).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()})
})
