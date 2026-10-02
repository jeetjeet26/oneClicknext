import {describe,it,expect,vi}from 'vitest'
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:vi.fn()}))
import {currentApprovedReadiness,requireCurrentReadiness}from './publication'
const db=(data:unknown,error:unknown=null)=>({rpc:vi.fn().mockResolvedValue({data,error})})
describe('publication uses exact current recorded approval',()=>{
 it.each(['unavailable','sources_changed','scope_changed'])('holds %s',async state=>{expect(await currentApprovedReadiness('p',db({state}))).toBeNull();await expect(requireCurrentReadiness('p','s','hash',db({state}))).rejects.toThrow('explicitly review')})
 it('requires an exact property and passes snapshot and hash pins',async()=>{const client=db({state:'ready',propertyId:'p',snapshot:{id:'s',content_hash:'hash'}});expect((await requireCurrentReadiness('p','s','hash',client)).id).toBe('s');expect(client.rpc).toHaveBeenCalledWith('readiness_publication_snapshot',{p_property_id:'p',p_snapshot_id:'s',p_content_hash:'hash'});await expect(currentApprovedReadiness('p',db({state:'ready',propertyId:'other',snapshot:{}}))).rejects.toThrow('match')})
 it('missing or failed evidence never falls back to a legacy raw approval',async()=>{await expect(currentApprovedReadiness('p',db(null))).rejects.toThrow('verified');await expect(currentApprovedReadiness('p',db({},{}))).rejects.toThrow('verified')})
})
