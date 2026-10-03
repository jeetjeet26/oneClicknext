import {beforeEach,describe,it,expect,vi} from 'vitest'
const {rpc,build}=vi.hoisted(()=>({rpc:vi.fn(),build:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
vi.mock('./saved-brief',()=>({buildSavedBrief:build}))
import {completeSavedBrief,briefRpc} from './brief-store'
describe('saved report completion',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('reuses an already completed report without recomputing or writing',async()=>{rpc.mockResolvedValue({data:{state:'ready',report:{id:'r',state:'ready',version:2}},error:null});expect(await completeSavedBrief('p','a','r')).toEqual({state:'ready',requestId:'r',version:2});expect(rpc).toHaveBeenCalledTimes(1);expect(build).not.toHaveBeenCalled()})
 it('completes only the exact retained source, not live queries',async()=>{rpc.mockResolvedValueOnce({data:{state:'ready',report:{id:'r',state:'prepared',version:1,source_hash:'hash',source_snapshot:{exact:'saved'}}},error:null}).mockResolvedValueOnce({data:{state:'ready',requestId:'r',version:2},error:null});build.mockReturnValue({exact:'result'});await completeSavedBrief('p','a','r');expect(build).toHaveBeenCalledWith('r','hash',{exact:'saved'});expect(rpc).toHaveBeenLastCalledWith('complete_marketvision_brief',{p_id:'r',p_property_id:'p',p_actor_id:'a',p_source_hash:'hash',p_result:{exact:'result'}})})
 it('preserves failed evidence for repair',async()=>{rpc.mockResolvedValue({data:{state:'ready',report:{id:'r',state:'prepared'}},error:null});build.mockImplementation(()=>{throw Error('invalid')});await expect(completeSavedBrief('p','a','r')).rejects.toThrow('retained report evidence');expect(rpc).toHaveBeenCalledTimes(1)})
 it.each([['forbidden',403],['not_found',404],['stale_review',409],['snapshot_too_large',503]])('surfaces %s',async(state,status)=>{rpc.mockResolvedValue({data:{state},error:null});await expect(briefRpc('read',{})).rejects.toMatchObject({status})})
 it('never turns database failure into an empty history',async()=>{rpc.mockResolvedValue({data:null,error:{}});await expect(briefRpc('read',{})).rejects.toMatchObject({status:503})})
})
