import {expect,it} from 'vitest'
import {communityModel} from '@/utils/community-model'
import {hasLegacyResearchCitationFailure,retainSupportedResearchProfile,type ResearchProfile,type ResearchOffering} from './research-contracts'
import type {ResearchDocument} from './research-source'

const id='11111111-1111-4111-8111-111111111111'
const model=communityModel({property_type:'multifamily'})
const source:ResearchDocument={id,entityKey:'subject',url:'https://example.com/community',title:'Official source',fetchedAt:'2026-11-26T00:00:00Z',kind:'official',status:'captured',text:'A rooftop pool. Plan E1 rents from $2815 monthly.',contentHash:'hash',metadata:{parser:'test',transport:'test',partial:false}}
const base:ResearchProfile={entityKey:'subject',name:'Community',website:source.url,propertyType:'multifamily',transaction:'rental',offerings:[],facts:[],coverageGaps:[]}
const fact:ResearchProfile['facts'][number]={category:'amenities',statement:'The website advertises a rooftop pool.',kind:'source_claim',evidence:[{sourceId:id,quote:'A rooftop pool.'}]}
const offering:ResearchOffering={name:'E1',kind:'plan',priceBasis:'monthly_rent_usd',salePrice:null,monthlyRent:2815,bedroomsMin:null,bedroomsMax:null,bathroomsMin:null,bathroomsMax:null,sqftMin:null,sqftMax:null,availableCount:null,status:null,terms:null,evidence:[{field:'monthlyRent',sourceId:id,quote:'$2815 monthly'}]}

it('retains supported facts and prices when another claim contains an invented quotation',()=>{
 const result=retainSupportedResearchProfile({...base,facts:[fact,{...fact,statement:'Invented claim',evidence:[{sourceId:id,quote:'A private marina.'}]}],offerings:[offering]},[source],'subject',model)
 expect(result.facts).toEqual([fact]);expect(result.offerings).toEqual([offering]);expect(result.coverageGaps).toEqual([expect.stringContaining('1 extracted items were withheld')])
})
it('withholds unsupported prices and cross-community quotations without discarding independent valid facts',()=>{
 const result=retainSupportedResearchProfile({...base,facts:[fact,{...fact,evidence:[{sourceId:'22222222-2222-4222-8222-222222222222',quote:'A rooftop pool.'}]}],offerings:[{...offering,monthlyRent:2500}]},[source,{...source,id:'22222222-2222-4222-8222-222222222222',entityKey:'other'}],'subject',model)
 expect(result.facts).toEqual([fact]);expect(result.offerings).toEqual([]);expect(result.coverageGaps[0]).toContain('2 extracted items')
})
it('still rejects a changed entity or onboarding transaction',()=>{
 expect(()=>retainSupportedResearchProfile({...base,entityKey:'other'},[source],'subject',model)).toThrow('identity')
 expect(()=>retainSupportedResearchProfile({...base,transaction:'for_sale'},[source],'subject',model)).toThrow('transaction')
})
it('recovers old citation failures while leaving useful profiles and other failures alone',()=>{
 const failed={...base,coverageGaps:['A research quotation is absent from its retained entity source']}
 expect(hasLegacyResearchCitationFailure(failed)).toBe(true)
 expect(hasLegacyResearchCitationFailure({...failed,facts:[fact]})).toBe(false)
 expect(hasLegacyResearchCitationFailure({...base,coverageGaps:['No usable source pages were captured']})).toBe(false)
 const repaired=retainSupportedResearchProfile({...base,facts:[{...fact,evidence:[{sourceId:id,quote:'Unsupported'}]}]},[source],'subject',model)
 expect(hasLegacyResearchCitationFailure(repaired)).toBe(false)
})
