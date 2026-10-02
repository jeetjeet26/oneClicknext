import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {operator,rpc}=vi.hoisted(()=>({operator:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/reviewflow/access',async()=>({...await vi.importActual('@/utils/reviewflow/access'),requireReviewOperator:operator}))
vi.mock('@/utils/reviewflow/analysis-store',async()=>({...await vi.importActual('@/utils/reviewflow/analysis-store'),reviewRpc:rpc}))
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {GET} from './route'
const property='33333333-3333-3333-3333-333333333333',cursor='55555555-5555-4555-8555-555555555555'
const req=(extra='')=>new NextRequest(`http://localhost/api/reviewflow/stats?propertyId=${property}${extra}`)
beforeEach(()=>{vi.resetAllMocks();operator.mockResolvedValue('actor');rpc.mockResolvedValue({state:'ready',total:1205})})
describe('complete stats workspace',()=>{
 it('checks sign-in and property access before the private aggregate read',async()=>{for(const status of [401,403]){operator.mockRejectedValue(new ReviewStoreError('Unavailable',status));expect((await GET(req())).status).toBe(status)}expect(rpc).not.toHaveBeenCalled()})
 it('honors membership revocation between session check and database read',async()=>{rpc.mockResolvedValue({state:'forbidden'});expect((await GET(req())).status).toBe(403)})
 it('preserves failed reads instead of returning partial counts or all-clear',async()=>{rpc.mockRejectedValue(new Error('private raw failure'));const r=await GET(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private raw');rpc.mockResolvedValue({state:'unknown'});expect((await GET(req())).status).toBe(503)})
 it('validates complete date-window requests',async()=>{for(const q of ['&days=-1','&days=366','&days=3x','&limit=1'])expect((await GET(req(q))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()})
 it('returns one complete server aggregate including null averages',async()=>{void cursor;const result={state:'ready',stats:{totalReviews:1205,avgRating:null}};rpc.mockResolvedValue(result);expect(await(await GET(req('&days=90'))).json()).toEqual(result);expect(rpc).toHaveBeenCalledWith('read_reviewflow_statistics',{p_property_id:property,p_actor_id:'actor',p_days:90})})
})
