import {beforeEach,it,expect,vi}from 'vitest'
const d=vi.hoisted(()=>({rpc:vi.fn(),user:vi.fn(),access:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc})}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.user}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
import {deliveryRpc,requireDeliveryActor}from './delivery-record-store'
beforeEach(()=>vi.clearAllMocks())
it('surfaces only allowlisted native validation messages and hides database details',async()=>{d.rpc.mockResolvedValueOnce({data:null,error:{message:'A reported pass needs dated evidence and a named tested source version'}}).mockResolvedValueOnce({data:null,error:{message:'Private source text or query failure'}});await expect(deliveryRpc('review_siteforge_delivery',{})).rejects.toMatchObject({status:400,message:'A reported pass needs dated evidence and a named tested source version'});await expect(deliveryRpc('review_siteforge_delivery',{})).rejects.toMatchObject({status:503,message:expect.not.stringContaining('Private source text')})})
it('checks the verified user and actual property access',async()=>{d.user.mockResolvedValue({data:{user:{id:'server-actor'}},error:null});d.access.mockResolvedValue({authorized:true});expect(await requireDeliveryActor('property')).toBe('server-actor');expect(d.access).toHaveBeenCalledWith('server-actor','property');d.access.mockResolvedValue({authorized:false});await expect(requireDeliveryActor('other')).rejects.toMatchObject({status:403});d.user.mockResolvedValue({data:{user:null},error:null});await expect(requireDeliveryActor('property')).rejects.toMatchObject({status:401})})
