import {beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),sync:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc})}))
vi.mock('@/utils/property-units-kb-sync',()=>({syncPropertyUnitsToKnowledgeBase:d.sync}))
import {GET} from './route'
const property='33333333-3333-3333-3333-333333333333',hash='a'.repeat(64),params={params:Promise.resolve({id:property})}
const get=()=>GET(new Request('http://local'),params)
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'actor'}},error:null});d.rpc.mockResolvedValue({data:{state:'ready',propertyId:property,items:[{id:'floorplan',rent_min:0}],total:1,nextOffset:null,inventoryHash:hash},error:null})})
it('requires authentication and current native property access',async()=>{d.auth.mockResolvedValueOnce({data:{user:null},error:null});expect((await get()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled();d.rpc.mockResolvedValueOnce({data:{state:'forbidden'},error:null});expect((await get()).status).toBe(403)})
it('returns stored floorplans without synchronization, model calls or guessing missing values',async()=>{const fetcher=vi.spyOn(globalThis,'fetch');try{const r=await get();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({units:[{id:'floorplan',rent_min:0}],total:1});expect(d.sync).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()}finally{fetcher.mockRestore()}})
it('does not silently truncate an oversized compatibility collection',async()=>{d.rpc.mockResolvedValue({data:{state:'ready',propertyId:property,items:[],total:2001,nextOffset:2000,inventoryHash:hash},error:null});const r=await get();expect(r.status).toBe(422);expect(await r.json()).not.toHaveProperty('units')})
it('does not substitute an empty list after a failed read',async()=>{d.rpc.mockResolvedValue({data:null,error:{message:'fixture outage'}});expect((await get()).status).toBe(503)})
