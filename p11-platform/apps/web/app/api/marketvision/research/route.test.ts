import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),enqueue:vi.fn(),process:vi.fn(),after:vi.fn(),db:vi.fn()}))
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:m.after}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:m.auth}))
vi.mock('@/utils/marketvision/research-store',()=>({researchWorkspace:m.read,enqueueResearch:m.enqueue,processResearchJob:m.process}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:m.db}))
import {GET,POST} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111'
const read=(query=`propertyId=${id}`)=>GET(new NextRequest(`http://localhost/?${query}`))
const post=(body:unknown)=>POST(new NextRequest('http://localhost/',{method:'POST',body:JSON.stringify(body)}))
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue('actor');m.read.mockResolvedValue({propertyId:id,result:null});m.enqueue.mockResolvedValue({id,state:'queued'})})
it.each([401,403])('blocks unauthorized research reads and refreshes (%s)',async status=>{
  m.auth.mockRejectedValue(new MarketStoreError('Unavailable',status))
  expect((await read()).status).toBe(status)
  expect((await post({propertyId:id,action:'refresh'})).status).toBe(status)
  expect(m.read).not.toHaveBeenCalled();expect(m.enqueue).not.toHaveBeenCalled();expect(m.db).not.toHaveBeenCalled()
})
it.each(['propertyId=bad',`propertyId=${id}&propertyId=${id}`,`propertyId=${id}&all=true`])('rejects ambiguous research scope %s',async query=>{expect((await read(query)).status).toBe(400);expect(m.read).not.toHaveBeenCalled()})
it('rechecks access before returning private research',async()=>{const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(m.auth).toHaveBeenCalledTimes(2)})
it('discards saved evidence if access changes during the read',async()=>{m.auth.mockResolvedValueOnce('actor').mockRejectedValueOnce(new MarketStoreError('Unavailable',403));expect((await read()).status).toBe(403)})
it('queues only the authenticated community and defers provider work',async()=>{expect((await post({propertyId:id,action:'refresh'})).status).toBe(200);expect(m.enqueue).toHaveBeenCalledWith(id,'actor',true);expect(m.after).toHaveBeenCalledTimes(1);expect(m.process).not.toHaveBeenCalled()})
it('requires a specific job to stop',async()=>{expect((await post({propertyId:id,action:'stop'})).status).toBe(400);expect(m.db).not.toHaveBeenCalled()})
