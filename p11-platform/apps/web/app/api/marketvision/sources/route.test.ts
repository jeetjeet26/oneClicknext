import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),run:vi.fn(),extract:vi.fn(),runExtraction:vi.fn(),after:vi.fn()}))
vi.mock('next/server',async()=>({...await vi.importActual<object>('next/server'),after:mocks.after}))
vi.mock('@/utils/marketvision/decision-store',async()=>({...await vi.importActual<object>('@/utils/marketvision/decision-store'),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/source-store',()=>({sourceRpc:mocks.rpc,sourceExecutionStatus:()=>({paused:true}),runSource:mocks.run,requestCapturedExtraction:mocks.extract}))
vi.mock('@/utils/marketvision/extraction-store',()=>({runExtraction:mocks.runExtraction}))
import { GET, POST, PUT, PATCH } from './route'
import { MarketStoreError } from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111'
const request={requestId:id,propertyId:id,competitorId:id,expectedVersion:1,source:'website',reason:'Reviewed page source'}
const req=(method:string,body:unknown)=>new NextRequest('http://localhost/api/marketvision/sources',{method,body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue(id);mocks.rpc.mockResolvedValue({state:'queued',requestId:id});mocks.extract.mockResolvedValue({state:'queued',requestId:id})})
describe('retained source endpoints',()=>{
 it('saves current source intent before scheduling execution',async()=>{expect((await POST(req('POST',request))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('begin_marketvision_source',{p_id:id,p_property_id:id,p_actor_id:id,p_input:{competitorId:id,expectedVersion:1,source:'website',reason:'Reviewed page source'}});expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.run).not.toHaveBeenCalled()})
 it('does not dispatch an existing active or closed source request',async()=>{for(const state of ['busy','running','received','held','stopped']){mocks.after.mockClear();mocks.rpc.mockResolvedValue({state,requestId:id});await POST(req('POST',request));expect(mocks.after).not.toHaveBeenCalled()}})
 it('rejects arbitrary fetch overrides and missing exact source review',async()=>{expect((await POST(req('POST',{...request,url:'https://evil.com/'}))).status).toBe(400);expect((await PATCH(req('PATCH',{requestId:id,propertyId:id,competitorId:id,sourceId:id,expectedVersion:3,reason:'Extract source'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.extract).not.toHaveBeenCalled()})
 it('scopes reads and hides failures instead of returning empty history',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Source read unavailable'));const response=await GET(new NextRequest(`http://localhost/api/marketvision/sources?propertyId=${id}&competitorId=${id}`));expect(response.status).toBe(503);expect(mocks.auth).toHaveBeenCalledWith(id);expect(await response.json()).toEqual({error:'Source read unavailable'})})
 it('a stop cannot dispatch another fetch',async()=>{mocks.rpc.mockResolvedValue({state:'saved',requestState:'stopped'});await PUT(req('PUT',{requestId:id,propertyId:id,sourceId:id,expectedVersion:2,action:'stop',reason:'Stop source use'}));expect(mocks.after).not.toHaveBeenCalled()})
 it('only a queued recovery may dispatch the first fetch',async()=>{for(const state of ['running','held']){mocks.after.mockClear();mocks.rpc.mockResolvedValue({state:'saved',requestState:state});await PUT(req('PUT',{requestId:id,propertyId:id,sourceId:id,expectedVersion:2,action:'recover',reason:'Review source recovery'}));expect(mocks.after).not.toHaveBeenCalled()}})
 it('extracts from the server-retained page only after explicit scope confirmation',async()=>{const input={requestId:id,propertyId:id,competitorId:id,sourceId:id,expectedVersion:3,confirmedScope:true,reason:'Reviewed source scope'};expect((await PATCH(req('PATCH',input))).status).toBe(200);expect(mocks.extract).toHaveBeenCalledWith(input,id);expect(mocks.after).toHaveBeenCalledOnce()})
 it('denied access stops source changes before any fetch or model work',async()=>{mocks.auth.mockRejectedValue(new MarketStoreError('Forbidden',403));expect((await POST(req('POST',request))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled()})
})
