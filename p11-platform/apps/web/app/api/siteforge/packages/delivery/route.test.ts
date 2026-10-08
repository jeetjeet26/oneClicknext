import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({after:vi.fn(),operator:vi.fn(),request:vi.fn(),execute:vi.fn(),view:vi.fn(),reconcile:vi.fn()}))
vi.mock('next/server',async importOriginal=>({...await importOriginal<typeof import('next/server')>(),after:mocks.after}))
vi.mock('@/utils/siteforge/packages/store',()=>({requirePackageOperator:mocks.operator}))
vi.mock('@/utils/siteforge/packages/delivery',()=>({requestDelivery:mocks.request,executeDelivery:mocks.execute,deliveryView:mocks.view,reconcileDelivery:mocks.reconcile}))
import {POST,GET,PATCH} from './route'
import {PackageError} from '@/utils/siteforge/packages/contracts'
const propertyId='33333333-3333-3333-3333-333333333333'
const body={propertyId,requestId:'12345678-1234-4234-8234-123456789abc',jobId:'22345678-1234-4234-8234-123456789abc',targetId:'32345678-1234-4234-8234-123456789abc',kind:'preview',confirmed:true}
const request=(data:unknown,origin='https://console.test',method='POST')=>new NextRequest('https://console.test/api/siteforge/packages/delivery',{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)})
beforeEach(()=>{vi.clearAllMocks();mocks.operator.mockResolvedValue({id:'actor',orgId:'org'});mocks.request.mockResolvedValue({id:body.requestId,state:'running',created:true})})
describe('package delivery API',()=>{
 it('rejects cross-origin requests before authorizing or dispatching',async()=>{expect((await POST(request(body,'https://other.test'))).status).toBe(403);expect(mocks.operator).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled()})
 it('requires an explicit review confirmation',async()=>{expect((await POST(request({...body,confirmed:false}))).status).toBe(400);expect(mocks.request).not.toHaveBeenCalled()})
 it('checks property access before accepting work',async()=>{mocks.operator.mockRejectedValueOnce(new PackageError('Not authorized',403));expect((await POST(request(body))).status).toBe(403);expect(mocks.request).not.toHaveBeenCalled()})
 it('schedules only a newly saved release',async()=>{expect((await POST(request(body))).status).toBe(202);expect(mocks.after).toHaveBeenCalledTimes(1);mocks.request.mockResolvedValueOnce({id:body.requestId,state:'running',created:false});await POST(request(body));expect(mocks.after).toHaveBeenCalledTimes(1)})
 it('protects release history with property access',async()=>{mocks.operator.mockRejectedValueOnce(new PackageError('Sign in',401));expect((await GET(new NextRequest('https://console.test/api/siteforge/packages/delivery?propertyId='+propertyId))).status).toBe(401);expect(mocks.view).not.toHaveBeenCalled()})
 it('reconciliation never dispatches another installation',async()=>{mocks.reconcile.mockResolvedValue({state:'succeeded'});expect((await PATCH(request({propertyId,releaseId:body.requestId},undefined,'PATCH'))).status).toBe(200);expect(mocks.after).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled()})
})
