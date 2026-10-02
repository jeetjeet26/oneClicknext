import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {auth,access,from,renew}=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),from:vi.fn(),renew:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:auth}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyManagerAccess:access}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from})}))
vi.mock('@/utils/forgestudio/renewal',()=>({renewSocialConnection:renew}))
import {GET,POST} from './route'
const propertyId='33333333-3333-4333-8333-333333333333',requestId='55555555-5555-4555-8555-555555555555',connectionId='66666666-6666-4666-8666-666666666666'
const payload={propertyId,requestId,connectionId,expectedVersion:3,reason:'Renew reviewed access'}
const req=(body?:unknown)=>new NextRequest(`http://localhost/api/forgestudio/social/renewal?propertyId=${propertyId}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined)
function chain(data:unknown,error:unknown=null){const result={data,error},q={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn(),or:vi.fn(),maybeSingle:vi.fn().mockResolvedValue(result),then:vi.fn()};for(const k of ['select','eq','order','limit','or'] as const)q[k].mockReturnValue(q);q.then.mockImplementation((r:(v:unknown)=>unknown)=>Promise.resolve(result).then(r));return q}
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({data:{user:{id:'operator'}},error:null});access.mockResolvedValue({authorized:true});renew.mockResolvedValue({state:'saved',renewalState:'completed'})})
describe('saved renewal API',()=>{
 it('requires a current authenticated manager before any reads or renewals',async()=>{auth.mockResolvedValueOnce({data:{user:null},error:null});expect((await GET(req())).status).toBe(401);access.mockResolvedValue({authorized:false});expect((await GET(req())).status).toBe(403);expect((await POST(req(payload))).status).toBe(403);expect(from).not.toHaveBeenCalled();expect(renew).not.toHaveBeenCalled()})
 it('rejects unversioned and unexpected renewal inputs',async()=>{for(const body of [{...payload,expectedVersion:0},{...payload,reason:' '},{...payload,platform:'x'}])expect((await POST(req(body))).status).toBe(400);expect(renew).not.toHaveBeenCalled()})
 it('retains exact decision identity and reports pending exchange honestly',async()=>{renew.mockResolvedValue({state:'exchanging'});const r=await POST(req(payload));expect(r.status).toBe(202);expect(await r.json()).toEqual({state:'exchanging'});expect(renew).toHaveBeenCalledWith(payload,'operator')})
 it('returns a recoverable error for unconfirmed results',async()=>{renew.mockRejectedValue(new Error('private detail'));const r=await POST(req(payload));expect(r.status).toBe(503);expect(await r.text()).not.toContain('private detail')})
 it('reads only safe receipt metadata with bounded newest-first pagination',async()=>{const q=chain(Array.from({length:31},(_,i)=>({id:`receipt-${i}`,state:'completed'})));from.mockReturnValue(q);const r=await GET(req()),data=await r.json();expect(data.renewals).toHaveLength(30);expect(data.nextCursor).toBe('receipt-29');expect(q.select).toHaveBeenCalledWith('id,connection_id,connection_version,platform,state,reason,created_at,finished_at');expect(q.eq).toHaveBeenCalledWith('property_id',propertyId);expect(q.order).toHaveBeenCalledWith('created_at',{ascending:false})})
 it('scopes history cursor anchors to the same property',async()=>{const q=chain([]),anchor=chain(null);from.mockReturnValueOnce(q).mockReturnValueOnce(anchor);expect((await GET(new NextRequest(`${req().url}&cursor=${requestId}`))).status).toBe(409);expect(anchor.eq).toHaveBeenCalledWith('property_id',propertyId);expect(q.or).not.toHaveBeenCalled()})
 it('does not disguise a failed history read as no renewals',async()=>{from.mockReturnValue(chain(null,{message:'private error'}));const r=await GET(req());expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('renewals')})
})
