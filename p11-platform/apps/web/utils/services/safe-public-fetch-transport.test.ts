import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}))
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}))
vi.mock('node:http',()=>({default:{request:mocks.request}}))
vi.mock('node:https',()=>({default:{request:mocks.request}}))
import { safePublicFetch, safePublicFetchWithMetadata } from './safe-public-fetch'
type Reply={status:number;headers?:Record<string,string>;body?:string}
let replies:Reply[]=[]
beforeEach(()=>{
 vi.clearAllMocks();replies=[];mocks.lookup.mockResolvedValue([{address:'1.1.1.1',family:4}])
 mocks.request.mockImplementation((_url:URL,_options:unknown,receive:(r:unknown)=>void)=>{
  const request=Object.assign(new EventEmitter(),{end:()=>{},destroy:(error:Error)=>{request.emit('error',error);request.emit('close')}})
  request.end=()=>queueMicrotask(()=>{
   const fixture=replies.shift()!;let destroyed=false
   const response=Object.assign(new EventEmitter(),{statusCode:fixture.status,headers:fixture.headers||{},destroy:(error?:Error)=>{destroyed=true;if(error)response.emit('error',error)}})
   receive(response);if(!destroyed){response.emit('data',Buffer.from(fixture.body||''));if(!destroyed)response.emit('end')};request.emit('close')
  })
  return request
 })
})
describe('bounded public transport receipts',()=>{
 it('retains the validated final URL after redirects and pins each socket lookup',async()=>{replies=[{status:302,headers:{location:'/current'}},{status:200,headers:{'content-type':'text/plain'},body:'Retained response'}];const result=await safePublicFetchWithMetadata('https://example.com/old');expect(result.finalUrl).toBe('https://example.com/current');expect(await result.response.text()).toBe('Retained response');expect(mocks.lookup).toHaveBeenCalledTimes(2);const options=mocks.request.mock.calls[1][1];const callback=vi.fn();options.lookup('ignored',{all:false},callback);expect(callback).toHaveBeenCalledWith(null,'1.1.1.1',4);expect(mocks.lookup).toHaveBeenCalledTimes(2)})
 it('preserves the Response contract for existing consumers',async()=>{replies=[{status:200,body:'Existing caller response'}];const response=await safePublicFetch('https://example.com');expect(response).toBeInstanceOf(Response);expect(await response.text()).toBe('Existing caller response')})
 it('rejects redirects to private destinations before opening that socket',async()=>{replies=[{status:302,headers:{location:'http://127.0.0.1/private'}}];await expect(safePublicFetchWithMetadata('https://example.com')).rejects.toThrow('non-public');expect(mocks.request).toHaveBeenCalledOnce()})
 it('enforces the byte limit while receiving an unbounded-length response',async()=>{replies=[{status:200,body:'01234567890123456789'}];await expect(safePublicFetchWithMetadata('https://example.com',{maxBytes:10})).rejects.toThrow('byte limit')})
})
