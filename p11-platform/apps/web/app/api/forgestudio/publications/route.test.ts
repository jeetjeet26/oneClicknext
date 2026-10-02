import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),save=vi.fn(),lookup=vi.fn(),queryResult=vi.fn(),filter=vi.fn()
function builder(){const q={select:()=>q,eq:(...args:unknown[])=>{filter(...args);return q},order:()=>q,limit:()=>q,or:()=>q,gte:()=>q,lte:()=>q,single:lookup,then:(yes:(v:unknown)=>unknown,no:(e:unknown)=>unknown)=>Promise.resolve(queryResult()).then(yes,no)};return q}
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:builder})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
vi.mock('@/utils/forgestudio/content-store',async load=>({...await load<typeof import('@/utils/forgestudio/content-store')>(),schedulePublications:save}))
const id='11111111-1111-4111-8111-111111111111'
const input={requestId:id,revisionId:id,contentHash:'a'.repeat(64),destinations:[{connectionId:id,variantId:id,scheduledFor:'2027-01-01T12:00:00Z',timezone:'UTC'}]}
const req=(body:unknown)=>new Request('http://localhost/api/forgestudio/publications',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'actual-actor'}},error:null});lookup.mockResolvedValue({data:{property_id:'actual-property'},error:null});access.mockResolvedValue({authorized:true});save.mockResolvedValue([{id:'saved-publication'}]);queryResult.mockReturnValue({data:[],error:null})})
describe('publication scheduling boundary',()=>{
 it('requires sign-in',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await (await import('./route')).POST(req(input))).status).toBe(401);expect(save).not.toHaveBeenCalled()})
 it('requires property access before the service write',async()=>{access.mockResolvedValue({authorized:false});expect((await (await import('./route')).POST(req(input))).status).toBe(403);expect(save).not.toHaveBeenCalled()})
 it.each(['requestId','contentHash','revisionId'])('rejects a missing %s',async field=>{expect((await (await import('./route')).POST(req({...input,[field]:undefined}))).status).toBe(400);expect(save).not.toHaveBeenCalled()})
 it.each(['variantId','timezone','scheduledFor'])('requires an exact destination %s',async field=>{expect((await (await import('./route')).POST(req({...input,destinations:[{...input.destinations[0],[field]:undefined}]}))).status).toBe(400);expect(save).not.toHaveBeenCalled()})
 it('derives the actor from the session and forwards stable review identity',async()=>{const result=await (await import('./route')).POST(req({...input,createdBy:'forged-actor',propertyId:'forged-property'}));expect(result.status).toBe(201);expect(save).toHaveBeenCalledWith({...input,createdBy:'actual-actor'})})
 it('returns a saved conflict without compensating writes',async()=>{const {ContentStoreError}=await import('@/utils/forgestudio/content-store');save.mockRejectedValueOnce(new ContentStoreError('The revision changed',409));expect((await (await import('./route')).POST(req(input))).status).toBe(409)})
})

describe('publication history pages',()=>{
 const get=(query:string)=>new Request('http://localhost/api/forgestudio/publications?'+query) as NextRequest
 it('rejects an invalid page before querying publication rows',async()=>{expect((await (await import('./route')).GET(get('propertyId=property&cursor=not-a-page'))).status).toBe(400);expect(queryResult).not.toHaveBeenCalled()})
 it('does not expose history from an unauthorized property',async()=>{access.mockResolvedValue({authorized:false});expect((await (await import('./route')).GET(get('propertyId=foreign'))).status).toBe(403);expect(queryResult).not.toHaveBeenCalled()})
 it('returns a next page when more than one hundred publications exist',async()=>{queryResult.mockReturnValue({data:Array.from({length:101},(_,i)=>({id:'row-'+i,scheduled_for:'2027-01-01T12:00:00Z'})),error:null});const response=await (await import('./route')).GET(get('propertyId=property'));expect(response.status).toBe(200);const value=await response.json();expect(value.publications).toHaveLength(100);expect(value.nextCursor).toBeTruthy();expect(JSON.parse(Buffer.from(value.nextCursor,'base64url').toString())).toEqual({at:'2027-01-01T12:00:00Z',id:'row-99'});expect(filter).toHaveBeenCalledWith('property_id','property')})
 it('does not turn a failed history query into an empty list',async()=>{queryResult.mockReturnValue({data:null,error:{message:'unavailable'}});expect((await (await import('./route')).GET(get('propertyId=property'))).status).toBe(500)})
})
