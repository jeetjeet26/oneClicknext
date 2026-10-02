import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>d}))
import {readReplacementReview,requestReplacement} from './integration-replacement'
const input={propertyId:'property',actorId:'actor',requestId:'decision',provider:'google',capability:'email',accountEmail:'new@example.invalid',revision:'revision'}
const ready={state:'ready',replacementId:'decision',actionEventId:'decision',expiresAt:'2099-01-01T00:00:00Z'}
beforeEach(()=>vi.resetAllMocks())
it('loads a private reviewed snapshot',async()=>{d.rpc.mockResolvedValue({data:{state:'review',revision:'hash',connections:[],blockers:[]}});expect((await readReplacementReview('property','actor','email')).revision).toBe('hash');expect(d.rpc).toHaveBeenCalledWith('integration_replacement_review',{p_property_id:'property',p_actor_id:'actor',p_capability:'email'})})
it.each([{error:{message:'private details'}},{data:null},{data:{state:'forbidden'}},{data:{state:'review'}}])('read failures are explicit and reveal no raw database detail %#',async result=>{d.rpc.mockResolvedValue(result);await expect(readReplacementReview('property','actor','email')).rejects.toThrow('Replacement review is unavailable')})
it('recovers only the identical recorded decision after a lost acknowledgement',async()=>{d.rpc.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({data:{...ready,state:'replayed'}});expect((await requestReplacement(input)).state).toBe('replayed');expect(d.rpc).toHaveBeenCalledTimes(2);expect(d.rpc.mock.calls[0]).toEqual(d.rpc.mock.calls[1])})
it.each([{...ready,actionEventId:'other'},{...ready,replacementId:'other'},{...ready,expiresAt:'2000-01-01'},{...ready,expiresAt:'unconfirmed'},null])('does not claim success from incomplete or mismatched acknowledgements %#',async data=>{d.rpc.mockResolvedValue({data});await expect(requestReplacement(input)).rejects.toThrow('could not be confirmed');expect(d.rpc).toHaveBeenCalledTimes(2)})
it('returns stale reviews without automatic new decisions',async()=>{d.rpc.mockResolvedValue({data:{state:'stale_review'}});expect((await requestReplacement(input)).state).toBe('stale_review');expect(d.rpc).toHaveBeenCalledTimes(1)})
