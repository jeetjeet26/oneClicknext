import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),read:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:mocks.auth}))
vi.mock('@/utils/marketvision/alert-store',()=>({alertRpc:mocks.rpc,readMarketAlerts:mocks.read}))
import {GET,POST,PUT} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='11111111-1111-1111-1111-111111111111'
const req=(body:unknown,method='PUT')=>new NextRequest('http://localhost/api/marketvision/alerts',{method,body:JSON.stringify(body)})
const review={propertyId,requestId,action:'dismiss',alerts:[{id:requestId,expectedVersion:1}],reason:'Reviewed duplicate alert'}
const create={propertyId,requestId,title:'Operator-reported discrepancy',description:null,severity:'warning',competitorId:null,reason:'Compare with current source evidence'}
describe('recorded alert routes',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue('actor');mocks.rpc.mockResolvedValue({state:'saved'});mocks.read.mockResolvedValue({state:'ready'})})
 it.each([401,403])('checks current property access before reads and mutations %s',async status=>{mocks.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}`))).status).toBe(status);expect((await PUT(req(review))).status).toBe(status);expect((await POST(req(create,'POST'))).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled()})
 it.each(['read_all','dismiss_all'])('rejects hidden property-wide action %s',async action=>{expect((await PUT(req({...review,action}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each([{alerts:[]},{alerts:[{id:requestId}]},{alerts:[{id:requestId,expectedVersion:1},{id:requestId,expectedVersion:1}]},{reason:''},{orgId:'forged'}])('rejects incomplete/forged review %j',async value=>{expect((await PUT(req({...review,...value}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each(['read','dismiss','restore'])('retains exact selection and actor for %s',async action=>{const res=await PUT(req({...review,action}));expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('private, no-store');expect(mocks.rpc).toHaveBeenCalledWith('review_marketvision_alerts',{p_id:requestId,p_property_id:propertyId,p_actor_id:'actor',p_input:{action,alerts:review.alerts,reason:review.reason}})})
 it('records manual alerts without caller-supplied provider evidence',async()=>{expect((await POST(req({...create,data:{verified:true}},'POST'))).status).toBe(400);expect((await POST(req(create,'POST'))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('create_marketvision_alert',expect.objectContaining({p_actor_id:'actor',p_input:{title:create.title,description:null,severity:'warning',competitorId:null,reason:create.reason}}))})
 it('keeps uncertain decisions recoverable under the same request',async()=>{mocks.rpc.mockRejectedValue(new MarketStoreError('Could not confirm'));expect((await PUT(req(review))).status).toBe(503)})
 it('reads a bounded exact property view and cursor',async()=>{expect((await GET(new NextRequest(`http://localhost/?propertyId=${propertyId}&view=dismissed&cursor=${requestId}&limit=50`))).status).toBe(200);expect(mocks.read).toHaveBeenCalledWith({p_property_id:propertyId,p_actor_id:'actor',p_view:'dismissed',p_cursor:requestId,p_limit:50})})
 it.each([`propertyId=${propertyId}&limit=1000`,`propertyId=${propertyId}&limit=NaN`,`propertyId=${propertyId}&propertyId=${propertyId}`,`propertyId=${propertyId}&unreadOnly=true`])('rejects unbounded or ambiguous view %s',async query=>{expect((await GET(new NextRequest(`http://localhost/?${query}`))).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled()})
})
