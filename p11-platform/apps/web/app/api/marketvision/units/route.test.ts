import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mock=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),manager:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mock.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mock.rpc,from:mock.from})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mock.access,validatePropertyManagerAccess:mock.manager}))
const propertyId='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555',competitorId='66666666-6666-4666-8666-666666666666'
function req(path:string,method='GET',body?:unknown){return new NextRequest(`http://localhost/api/marketvision/${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})})}
beforeEach(()=>{vi.clearAllMocks();mock.user.mockResolvedValue({data:{user:{id:'11111111-1111-1111-1111-111111111111'}},error:null});mock.access.mockResolvedValue({authorized:true});mock.manager.mockResolvedValue({authorized:true});mock.rpc.mockResolvedValue({data:{state:'saved',version:1},error:null})})
import {GET,POST,PUT,DELETE} from './route'
const values={unit_type:'A1',bedrooms:1,bathrooms:null,sqft_min:null,sqft_max:null,rent_min:0,rent_max:null,deposit:null,available_count:null,move_in_specials:null},body={propertyId,requestId,competitorId,action:'create',reason:'Reviewed local unit',values}
it('requires explicit property scope on unit reads',async()=>{expect((await GET(req(`units?competitorId=${competitorId}`))).status).toBe(400)})
it('requires authentication on scoped reads',async()=>{mock.user.mockResolvedValue({data:{user:null},error:null});expect((await GET(req(`units?propertyId=${propertyId}&competitorId=${competitorId}`))).status).toBe(401)})
it('requires current property access on changes',async()=>{mock.access.mockResolvedValue({authorized:false});expect((await POST(req('units','POST',body))).status).toBe(403)})
it('does not find another property unit by global ID',async()=>{mock.rpc.mockResolvedValue({data:{state:'ready',competitors:[]},error:null});expect((await GET(req(`units?propertyId=${propertyId}&competitorId=${competitorId}`))).status).toBe(404)})
it('preserves unknown fields and exact unit values on create',async()=>{expect((await POST(req('units','POST',body))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('save_marketvision_unit',expect.objectContaining({p_input:{action:'create',competitorId,reason:body.reason,values}}))})
it('rejects old updates without expected version and reason',async()=>{expect((await PUT(req('units','PUT',{id:requestId,rentMin:1200}))).status).toBe(400)})
it('returns conflict for stale unit removal',async()=>{mock.rpc.mockResolvedValue({data:{state:'stale_unit'},error:null});expect((await DELETE(req('units','DELETE',{...body,values:undefined,unitId:requestId,action:'remove',expectedVersion:1}))).status).toBe(409)})
it('returns visible read failure instead of an empty unit set',async()=>{mock.rpc.mockResolvedValue({data:null,error:{code:'XX000'}});expect((await GET(req(`units?propertyId=${propertyId}&competitorId=${competitorId}`))).status).toBe(503)})
