import {beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/utils/leadpulse/server',()=>({leadpulseRpc:rpc}))
import {trackEngagementEvent} from './engagement-tracker'
const input={leadId:'lead',propertyId:'property',eventType:'chat_started' as const,idempotencyKey:'conversation/source',origin:'lumaleasing' as const}
beforeEach(()=>vi.clearAllMocks())
it('uses one atomic command with source identity and no invented user',async()=>{rpc.mockResolvedValue({state:'applied'});await trackEngagementEvent(input);expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('record_lead_engagement',expect.objectContaining({p_request_key:'conversation/source',p_actor_id:null,p_origin:'lumaleasing'}))})
it('accepts confirmed replay without rescoring',async()=>{rpc.mockResolvedValue({state:'replayed'});await trackEngagementEvent(input);expect(rpc).toHaveBeenCalledTimes(1)})
it('throws when event and scoring transaction fails',async()=>{rpc.mockRejectedValue(new Error('transaction failed'));await expect(trackEngagementEvent(input)).rejects.toThrow('transaction failed');expect(rpc).toHaveBeenCalledTimes(1)})
it('does not treat mismatched source evidence as a successful replay',async()=>{rpc.mockResolvedValue({state:'request_conflict'});await expect(trackEngagementEvent(input)).rejects.toThrow('request_conflict')})
