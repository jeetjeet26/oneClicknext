import {describe,it,expect} from 'vitest'
import {dataReviewDecision,dataReviewRead} from './data-review-contracts'
const id='12345678-1234-1234-1234-123456789012',base={id,propertyId:id,expectedActorId:id}
describe('exact data review decisions',()=>{
 it.each(['2026-02-30','2026-13-01','2026-9-01','garbage'])('rejects invalid calendar date %s',startDate=>{expect(dataReviewDecision.safeParse({...base,operation:'save',startDate,endDate:'2026-09-30',sourceHash:'a'.repeat(64)}).success).toBe(false)})
 it('accepts exact source selection',()=>{expect(dataReviewDecision.safeParse({...base,operation:'save',startDate:'2026-09-01',endDate:'2026-09-30',sourceHash:'a'.repeat(64)}).success).toBe(true)})
 it.each(['exclude','restore'])('requires a reason and actual original identity for %s',operation=>{const input={...base,operation,reviewId:id,rowId:id,kind:'daily',reason:'Verified duplicate source'};expect(dataReviewDecision.safeParse(input).success).toBe(true);expect(dataReviewDecision.safeParse({...input,reason:'  '}).success).toBe(false);expect(dataReviewDecision.safeParse({...input,reason:'x'.repeat(2001)}).success).toBe(false);expect(dataReviewDecision.safeParse({...input,kind:'arbitrary_table'}).success).toBe(false);expect(dataReviewDecision.safeParse({...input,actorId:id}).success).toBe(false)})
 it('does not accept client-supplied original contents',()=>{expect(dataReviewDecision.safeParse({...base,operation:'export',reviewId:id,source:{rows:[]}}).success).toBe(false)})
 it.each(['received','verified','delivered','succeeded'])('cannot claim destination receipt %s',outcome=>{expect(dataReviewDecision.safeParse({...base,operation:'report',reviewId:id,exportId:id,artifactHash:'a'.repeat(64),outcome}).success).toBe(false)})
 it.each(['initiated','failed'])('accepts explicit browser observation %s',outcome=>{expect(dataReviewDecision.safeParse({...base,operation:'report',reviewId:id,exportId:id,artifactHash:'a'.repeat(64),outcome}).success).toBe(true)})
 it('accepts only a request identity for cancellation',()=>{expect(dataReviewDecision.safeParse({...base,operation:'cancel'}).success).toBe(true);expect(dataReviewDecision.safeParse({...base,operation:'cancel',rowId:id}).success).toBe(false)})
 it('bounds and validates page continuation',()=>{expect(dataReviewRead.safeParse({propertyId:id,offset:'25',hash:'b'.repeat(64)}).success).toBe(true);for(const offset of ['-1','2.5','1000001'])expect(dataReviewRead.safeParse({propertyId:id,offset}).success).toBe(false)})
})
