import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({access:vi.fn(),auth:vi.fn(),single:vi.fn(),eq:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:mocks.from})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mocks.access}))
import {GET} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111',property='33333333-3333-3333-3333-333333333333',call=()=>GET(new NextRequest(`http://localhost/?propertyId=${property}`),{params:Promise.resolve({briefId:id})})
describe('exact saved draft read',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor');mocks.access.mockResolvedValue({authorized:true,orgId:'current-org'});const chain={select:()=>chain,eq:mocks.eq,maybeSingle:mocks.single};mocks.eq.mockReturnValue(chain);mocks.from.mockReturnValue(chain);mocks.single.mockResolvedValue({data:{id,title:'Reviewed draft'},error:null})})
 it('loads exact identity in current property without recent-list truncation',async()=>{const res=await call();expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('private, no-store');expect(mocks.eq.mock.calls).toEqual([['id',id],['property_id',property],['org_id','current-org']])})
 it.each([401,403])('requires current authorization %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await call()).status).toBe(status);expect(mocks.from).not.toHaveBeenCalled()})
 it('returns not found for missing or other-property drafts',async()=>{mocks.single.mockResolvedValue({data:null,error:null});expect((await call()).status).toBe(404)})
 it('does not hide database errors as empty drafts',async()=>{mocks.single.mockResolvedValue({data:null,error:{code:'failed'}});expect((await call()).status).toBe(503)})
})
