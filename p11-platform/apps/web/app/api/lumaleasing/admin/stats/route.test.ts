import {beforeEach,expect,it,vi} from 'vitest'
import {InventoryError} from '@/utils/knowledge/inventory'
const actor=vi.fn(),rpc=vi.fn();vi.mock('@/utils/lumaleasing/conversation-store',()=>({conversationActor:actor,conversationRpc:rpc,InventoryError}))
const property='ee850000-0000-4000-8000-000000000201'
const request=(params='propertyId='+property)=>new Request('http://localhost/api/lumaleasing/admin/stats?'+params)
beforeEach(()=>{vi.clearAllMocks();actor.mockResolvedValue('actor');rpc.mockResolvedValue({state:'ready',propertyId:property,complete:true,totalSessions:1005,conversionRate:null,avgResponseTime:null,conversations:[]})})
it.each([401,403])('keeps authorization failure %s',async(status)=>{actor.mockRejectedValue(new InventoryError('Unavailable',status));const{GET}=await import('./route');expect((await GET(request())).status).toBe(status);expect(rpc).not.toHaveBeenCalled()})
it.each(['','propertyId=invalid','propertyId='+property+'&extra=1'])('rejects invalid selection %s',async(params)=>{const{GET}=await import('./route');expect((await GET(request(params))).status).toBe(400);expect(actor).not.toHaveBeenCalled()})
it('returns the native complete read and truthful unknowns privately',async()=>{const{GET}=await import('./route');const r=await GET(request());expect(r.status).toBe(200);expect(await r.json()).toMatchObject({complete:true,totalSessions:1005,conversionRate:null,avgResponseTime:null});expect(r.headers.get('cache-control')).toContain('no-store');expect(rpc).toHaveBeenCalledWith('read_luma_overview',{p_actor_id:'actor',p_property_id:property})})
it('storage failure cannot become zero metrics',async()=>{rpc.mockRejectedValue(new Error('Storage unavailable'));const{GET}=await import('./route');const r=await GET(request());expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('totalSessions')})
