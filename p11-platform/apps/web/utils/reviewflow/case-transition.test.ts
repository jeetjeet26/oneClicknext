import {describe,it,expect,vi} from 'vitest'
import {transitionCaseForReview} from './cases'
describe('legacy response transition boundary',()=>{
 it.each(['resolved','dismissed'])('retains explicit %s case decisions when a response changes',async(status)=>{
  const update=vi.fn().mockReturnValue({eq:vi.fn().mockResolvedValue({error:null})}),insert=vi.fn().mockResolvedValue({error:null})
  const from=vi.fn((table:string)=>table==='reputation_case_events'?{insert}:{select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'case',property_id:'property',status,reopened_count:2}})})}),update})
  await transitionCaseForReview({from} as never,'review',{status:'triaged',eventType:'response_posted',actorProfileId:'operator'})
  expect(update).toHaveBeenCalledWith(expect.objectContaining({status}));expect(update.mock.calls[0][0]).not.toHaveProperty('reopened_count');expect(update.mock.calls[0][0]).not.toHaveProperty('resolved_at');expect(insert).toHaveBeenCalledWith(expect.objectContaining({payload:{fromStatus:status,toStatus:status}}))
 })
})
