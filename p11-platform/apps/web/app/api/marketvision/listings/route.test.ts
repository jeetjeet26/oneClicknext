import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async()=>{const actual=await vi.importActual<typeof import('@/utils/marketvision/decision-store')>('@/utils/marketvision/decision-store');return{...actual,requireMarketOperator:mocks.auth,marketRpc:mocks.rpc}})
import { GET, PUT } from './route'
import { MarketStoreError } from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222'
const input={requestId:id,propertyId:id,competitorId:other,expectedVersion:2,reason:'Reviewed source',action:'save',url:'https://www.apartments.com/community/abc/'}
const req=(body:unknown)=>new NextRequest('http://localhost/api/marketvision/listings',{method:'PUT',body:JSON.stringify(body)})
describe('saved listing routes',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue(id);mocks.rpc.mockResolvedValue({state:'saved',version:3})})
 it('records the exact reviewed change under current property access',async()=>{expect((await PUT(req(input))).status).toBe(200);expect(mocks.auth).toHaveBeenCalledWith(id);expect(mocks.rpc).toHaveBeenCalledWith('save_marketvision_listing',{p_id:id,p_property_id:id,p_actor_id:id,p_input:{competitorId:other,expectedVersion:2,reason:'Reviewed source',action:'save',url:input.url}})})
 it('reads the current scoped version without inferring provider verification',async()=>{mocks.rpc.mockResolvedValue({state:'ready',competitors:[{id:other,version:5,is_active:true,ils_listings:{apartments_com:input.url}}]});const r=await GET(new NextRequest(`http://localhost/api/marketvision/listings?propertyId=${id}&competitorId=${other}`));expect(await r.json()).toEqual({listing:{competitorId:other,version:5,isActive:true,url:input.url}})})
 it('rejects cross-property records',async()=>{mocks.rpc.mockResolvedValue({state:'ready',competitors:[]});expect((await GET(new NextRequest(`http://localhost/api/marketvision/listings?propertyId=${id}&competitorId=${other}`))).status).toBe(404)})
 it('a failed read cannot appear to have no saved listing',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Saved sources unavailable'));const r=await GET(new NextRequest(`http://localhost/api/marketvision/listings?propertyId=${id}&competitorId=${other}`));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'Saved sources unavailable'})})
 it('rejects old unversioned source writes',async()=>{expect((await PUT(req({action:'add_listing',competitorId:other,url:input.url}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('preserves access and stale conflicts',async()=>{mocks.auth.mockRejectedValue(new MarketStoreError('Forbidden',403));expect((await PUT(req(input))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();mocks.auth.mockResolvedValue(id);mocks.rpc.mockRejectedValue(new MarketStoreError('Competitor details changed',409));expect((await PUT(req(input))).status).toBe(409)})
})
