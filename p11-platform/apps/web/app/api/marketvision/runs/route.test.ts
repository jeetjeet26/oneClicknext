import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),source:vi.fn(),extraction:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:m.auth}))
vi.mock('@/utils/marketvision/monitoring-store',()=>({readMarketMonitoring:m.read}))
vi.mock('@/utils/marketvision/source-store',()=>({sourceExecutionStatus:m.source}))
vi.mock('@/utils/marketvision/extraction-store',()=>({extractionExecutionStatus:m.extraction}))
import {GET} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111',read=(query=`propertyId=${id}`)=>GET(new NextRequest(`http://localhost/?${query}`))
describe('complete market monitoring reads',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue('actor');m.read.mockResolvedValue({state:'ready',runs:[],counts:{all:0},workers:[]});m.source.mockReturnValue({paused:true});m.extraction.mockReturnValue({paused:true,configured:true})})
 it.each([401,403])('requires current property authorization %s',async status=>{m.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await read()).status).toBe(status);expect(m.read).not.toHaveBeenCalled()})
 it('states runtime availability separately from automatic activation',async()=>{const r=await read();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect((await r.json()).runtime).toEqual({sourcePaused:true,extractionPaused:true,extractionConfigured:true,automaticMonitoring:false});expect(m.read).toHaveBeenCalledWith({propertyId:id,actorId:'actor',filter:'all'})})
 it('preserves a saved cursor and filter',async()=>{await read(`propertyId=${id}&filter=attention&cursor=${id}`);expect(m.read).toHaveBeenCalledWith({propertyId:id,actorId:'actor',filter:'attention',cursor:id})})
 it('opens original request identity',async()=>{await read(`propertyId=${id}&requestId=${id}`);expect(m.read).toHaveBeenCalledWith({propertyId:id,actorId:'actor',filter:'all',requestId:id})})
 it.each([`propertyId=${id}&propertyId=${id}`,`propertyId=${id}&limit=2000`,`propertyId=${id}&filter=invalid`,`propertyId=${id}&requestId=${id}&cursor=${id}`])('rejects ambiguous or unbounded reads %s',async query=>{expect((await read(query)).status).toBe(400);expect(m.read).not.toHaveBeenCalled()})
 it('surfaces unavailable history instead of an empty success',async()=>{m.read.mockRejectedValue(new MarketStoreError('Read failed'));expect((await read()).status).toBe(503)})
})
