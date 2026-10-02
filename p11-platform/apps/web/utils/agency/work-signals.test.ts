import {expect,it} from 'vitest'
import {evidenceSchema,currentWork,needsAgencyReview,workExplanation,workSourceLabels,type WorkItem} from './contracts'
const id='11111111-1111-4111-8111-111111111111'
const legacy={ruleVersion:'recorded-failures-v1',propertyId:id,orgId:id,product:'marketvision',windowStart:'2026-09-24T00:00:00Z',capturedAt:'2026-09-24T12:00:00Z',confirmedCount:0,failedCount:0,observedCount:5,latestConfirmedAt:null,eventFingerprint:'',sourceHash:'a'.repeat(64),failures:[]}
const item:WorkItem={source:'market_source',id,category:'held',state:'held',version_token:'1',opened_at:null,changed_at:null}
const work={checkedSources:['market_source'],total:1,heldCount:1,unconfirmedCount:0,incidentCount:0,oldestOpenedAt:null,fingerprint:'test',items:[item]}
it('reads older saved review evidence without inventing current work',()=>{const e=evidenceSchema.parse(legacy);expect(currentWork(e)).toBeNull();expect(needsAgencyReview(e)).toBe(false)})
it('held work prompts review even when the only recent activity was a page view',()=>{const e=evidenceSchema.parse({...legacy,ruleVersion:'recorded-work-v2',currentWork:work});expect(needsAgencyReview(e)).toBe(true);expect(currentWork(e)?.total).toBe(1)})
it('does not accept partial new evidence as an empty healthy queue',()=>{expect(evidenceSchema.safeParse({...legacy,ruleVersion:'recorded-work-v2'}).success).toBe(false);expect(evidenceSchema.safeParse({...legacy,ruleVersion:'recorded-work-v2',currentWork:{...work,total:undefined}}).success).toBe(false)})
it('empty checked sources do not become a recommendation',()=>{expect(needsAgencyReview(evidenceSchema.parse({...legacy,ruleVersion:'recorded-work-v2',currentWork:{...work,total:0,heldCount:0,items:[]}}))).toBe(false)})
it('distinguishes manual preparation from reported uncertainty',()=>{expect(workExplanation({...item,source:'review_publication',state:'awaiting_confirmation'})).toContain('does not establish');expect(workExplanation({...item,source:'review_publication',state:'held'})).toContain('reported an uncertain')})
it('all selected sources have plain labels and no inferred retry',()=>{expect(Object.keys(workSourceLabels)).toHaveLength(19);expect(workExplanation({...item,source:'crm_transfer',category:'unconfirmed'})).toContain('before considering another attempt')})

it('reads version three while preserving explicit source coverage',()=>{const e=evidenceSchema.parse({...legacy,ruleVersion:'recorded-work-v3',currentWork:{...work,coverage:{checkedSources:['market_source'],scope:'native_work',detail:'Only saved states checked'}}});expect(currentWork(e)?.coverage?.scope).toBe('native_work');expect(needsAgencyReview(e)).toBe(true)})
