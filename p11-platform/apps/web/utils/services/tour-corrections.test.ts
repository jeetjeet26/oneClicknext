import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
import {correctTourNoShow,correctionFailure} from './tour-outcomes'
const input={propertyId:'property',leadId:'lead',source:'tours' as const,tourId:'tour',actorId:'actor',requestId:'request',reason:'Attended'}
describe('tour correction persistence',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('sends the complete scoped correction identity to one transaction',async()=>{
  rpc.mockResolvedValue({data:{state:'applied',outcome:{id:'outcome'},correction:{id:'receipt'}}})
  await correctTourNoShow(input)
  expect(rpc).toHaveBeenCalledWith('apply_recorded_tour_action',{p_property_id:'property',p_lead_id:'lead',p_source:'tours',p_tour_id:'tour',p_actor_id:'actor',p_request_id:'request',p_action:'tour.no_show.corrected',p_input:{reason:'Attended'}})
 })
 it.each([{data:null,error:null},{data:{state:'applied'},error:null},{data:{state:'applied',outcome:{}},error:null},{data:null,error:{message:'offline'}}])('rejects an unconfirmed correction',async response=>{
  rpc.mockResolvedValue(response);await expect(correctTourNoShow(input)).rejects.toThrow()
 })
 it('distinguishes unknown delivery from a currently running send',()=>{
  expect(correctionFailure({state:'delivery_busy'})?.error).toContain('being processed')
  expect(correctionFailure({state:'delivery_review_required'})?.error).toContain('delivery review')
 })
 it('retains forbidden/missing failures',()=>{
  expect(correctionFailure({state:'forbidden'})?.status).toBe(403)
  expect(correctionFailure({state:'not_found'})?.status).toBe(404)
 })
})
