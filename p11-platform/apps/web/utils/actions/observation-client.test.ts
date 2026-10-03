import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const fetchMock=vi.fn()
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset()})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
const event={id:'id',episodeId:'episode',propertyId:'property',expectedActorId:'actor',path:'/dashboard/leads'}
it('retries the exact observation after a lost response and validates its receipt',async()=>{
 const c=await import('./observation-client');fetchMock.mockRejectedValueOnce(new TypeError('lost')).mockResolvedValue({ok:true,status:200,json:async()=>({state:'replayed',eventId:'id'})})
 c.recordPageObservation(event);await vi.runAllTimersAsync();expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls.map(call=>JSON.parse(call[1].body).id)).toEqual(['id','id']);expect(c.failedObservations()).toBe(0)
})
it('bounds automatic retries and retains failed identity for explicit retry',async()=>{
 const c=await import('./observation-client');fetchMock.mockRejectedValue(new TypeError('offline'));c.recordPageObservation(event);await vi.runAllTimersAsync();expect(fetchMock).toHaveBeenCalledTimes(3);expect(c.failedObservations()).toBe(1)
 c.retryObservations('different-actor');await vi.runAllTimersAsync();expect(fetchMock).toHaveBeenCalledTimes(3)
 fetchMock.mockResolvedValue({ok:true,status:200,json:async()=>({state:'recorded',eventId:'id'})});c.retryObservations('actor');await vi.runAllTimersAsync();expect(c.failedObservations()).toBe(0)
})
it('does not treat an unrelated receipt as successful recording',async()=>{
 const c=await import('./observation-client');fetchMock.mockResolvedValue({ok:true,status:200,json:async()=>({state:'recorded',eventId:'other'})});c.recordPageObservation(event);await vi.runAllTimersAsync();expect(c.failedObservations()).toBe(1)
})
it('does not duplicate concurrent submissions and stops retrying authorization errors',async()=>{
 const c=await import('./observation-client');fetchMock.mockResolvedValue({ok:false,status:403,json:async()=>({error:'Forbidden'})});c.recordPageObservation(event);c.recordPageObservation(event);await vi.runAllTimersAsync();expect(fetchMock).toHaveBeenCalledOnce();expect(c.failedObservations()).toBe(1)
})

it('reports page observations dropped at the bounded queue limit separately from retryable failures',async()=>{
 const c=await import('./observation-client');fetchMock.mockResolvedValue({ok:false,status:503,json:async()=>({error:'offline'})})
 for(let i=0;i<101;i++)c.recordPageObservation({...event,id:`event-${i}`})
 expect(c.droppedObservations('actor')).toBe(1);expect(c.droppedObservations('different-actor')).toBe(0)
 await vi.runAllTimersAsync();expect(c.failedObservations('actor')).toBe(100);expect(c.failedObservations('different-actor')).toBe(0)
})
