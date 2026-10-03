import {beforeEach,expect,it,vi}from 'vitest'
const rpc=vi.fn();vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}));vi.mock('@/utils/supabase/server',()=>({createClient:vi.fn()}));vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:vi.fn()}))
const args={p_property_id:'property',p_actor_id:'actor',p_id:'request'}
beforeEach(()=>vi.clearAllMocks())
it.each([{data:null,error:{message:'offline'}},{data:{state:'saved',propertyId:'different',actorId:'actor',id:'request'},error:null},{data:{state:'saved',propertyId:'property',actorId:'different',id:'request'},error:null},{data:{state:'saved',propertyId:'property',actorId:'actor',id:'different'},error:null}])('rejects unverifiable native response',async result=>{rpc.mockResolvedValue(result);const{searchRpc}=await import('./store');await expect(searchRpc('decide_console_search',args)).rejects.toThrow()})
it('preserves native scoped results',async()=>{const data={state:'saved',propertyId:'property',actorId:'actor',id:'request'};rpc.mockResolvedValue({data,error:null});const{searchRpc}=await import('./store');expect(await searchRpc('decide_console_search',args)).toEqual(data)})
