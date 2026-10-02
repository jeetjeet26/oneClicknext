import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),fetch:vi.fn(),extraction:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mocks.rpc})}))
vi.mock('./source-provider',()=>({acquirePublicSource:mocks.fetch}))
vi.mock('./extraction-store',()=>({requestExtraction:mocks.extraction}))
import { runSource, requestCapturedExtraction } from './source-store'
const id='11111111-1111-1111-1111-111111111111'
const receipt={status:'received',text:'Retained source'}
const ok=(data:unknown)=>({data,error:null})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');mocks.fetch.mockResolvedValue(receipt)})
afterEach(()=>vi.unstubAllEnvs())
describe('saved source execution',()=>{
 it('does not claim or fetch when paused',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');expect(await runSource(id)).toEqual({state:'paused'});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled()})
 it.each(['running','held','received','stopped'])('never repeats a %s source fetch',async state=>{mocks.rpc.mockResolvedValue(ok({state}));expect(await runSource(id)).toEqual({state});expect(mocks.fetch).not.toHaveBeenCalled()})
 it('retries only persistence of the same receipt after an interrupted acknowledgement',async()=>{mocks.rpc.mockResolvedValueOnce(ok({state:'fetch_once',sourceUrl:'https://example.com/',claimToken:id})).mockResolvedValueOnce({data:null,error:{code:'network'}}).mockResolvedValueOnce(ok({state:'replayed',requestState:'received'}));expect(await runSource(id)).toMatchObject({state:'replayed'});expect(mocks.fetch).toHaveBeenCalledOnce();expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[2])})
 it('binds extraction to server-retained source text and provenance',async()=>{mocks.rpc.mockResolvedValue(ok({state:'ready',request:{state:'received',version:3,source_snapshot:{version:7},receipt:{text:'Exact retained public source',finalUrl:'https://example.com/current/'}}}));mocks.extraction.mockResolvedValue({state:'queued',requestId:id});await requestCapturedExtraction({requestId:id,propertyId:id,competitorId:id,sourceId:id,expectedVersion:3,confirmedScope:true,reason:'Reviewed page scope'},id);expect(mocks.extraction).toHaveBeenCalledWith(expect.objectContaining({sourceVersion:7,sourceRequestId:id,confirmedSourceScope:true,content:'Exact retained public source',effectiveAt:null}),id)})
 it('rejects changed or unusable source receipts before any model request',async()=>{mocks.rpc.mockResolvedValue(ok({state:'ready',request:{state:'stopped',version:3,source_snapshot:{version:1},receipt:null}}));await expect(requestCapturedExtraction({requestId:id,propertyId:id,competitorId:id,sourceId:id,expectedVersion:3,confirmedScope:true,reason:'Reviewed page scope'},id)).rejects.toThrow('retained readable page');expect(mocks.extraction).not.toHaveBeenCalled()})
})
