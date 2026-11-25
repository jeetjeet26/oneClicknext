import { describe,expect,it } from 'vitest'
import { communityModel } from '@/utils/community-model'
import { compareResearchProfiles,researchChanges } from './research-analysis'
import { validateResearchProfile,type ResearchProfile,type ResearchOffering,type ResearchResult } from './research-contracts'
import type { ResearchDocument } from './research-source'
const id='11111111-1111-4111-8111-111111111111'
const model=communityModel({property_type:'single_family',settings:{onboarding:{transaction:'for_sale'}}})
const offering=(name:string,price:number,kind:ResearchOffering['kind']='plan'):ResearchOffering=>({name,kind,priceBasis:'sale_price_usd',salePrice:price,monthlyRent:null,bedroomsMin:4,bedroomsMax:4,bathroomsMin:3,bathroomsMax:3,sqftMin:2019,sqftMax:2019,availableCount:null,status:null,terms:null,evidence:[{field:'salePrice',sourceId:id,quote:`$${price}`} ]})
const profile=(key:string,price:number,type='single_family'):ResearchProfile=>({entityKey:key,name:key,website:'https://example.com/community',propertyType:type,transaction:'for_sale',offerings:[offering(key,price)],facts:[],coverageGaps:[]})
describe('transaction-aware competitive analysis',()=>{
 it('computes the advertised premium from matched configurations without turning it into rent',()=>{
   const row=compareResearchProfiles([profile('subject',1350000),profile('competitor',1189990)],model)[0]
   expect(row).toMatchObject({premiumPct:13.45,basis:'sale_price_usd',comparability:'similar_configuration'})
 })
 it('separates alternative housing products and never matches a plan to a homesite',()=>{
   const other=profile('competitor',999990,'townhome')
   expect(compareResearchProfiles([profile('subject',1350000),other],model)[0].comparability).toBe('alternative_product')
   other.offerings[0].kind='homesite';expect(compareResearchProfiles([profile('subject',1350000),other],model)).toEqual([])
 })
 it('does not compare different transaction models or unmatched bedroom counts',()=>{
   const other=profile('competitor',999990);other.transaction='rental'
   expect(compareResearchProfiles([profile('subject',1350000),other],model)).toEqual([])
   other.transaction='for_sale';other.offerings[0].bedroomsMin=2;other.offerings[0].bedroomsMax=3
   expect(compareResearchProfiles([profile('subject',1350000),other],model)).toEqual([])
 })
 it('requires a previous observation of the same offering and basis for a price change',()=>{
   const previous={model,profiles:[profile('subject',1300000)]} as ResearchResult
   expect(researchChanges(previous,[profile('subject',1350000)],model)[0]).toMatchObject({field:'salePrice',previous:1300000,current:1350000})
   expect(researchChanges(previous,[profile('subject',1350000)],communityModel({property_type:'multifamily'}))).toEqual([])
 })
 it('rejects quotations from another entity and unsupported numeric claims',()=>{
   const doc:ResearchDocument={id,entityKey:'subject',url:'https://example.com',title:'Source',fetchedAt:'2026-11-25T00:00:00Z',kind:'official',status:'captured',text:'Plan A costs $1350000 with 4 beds, 3 baths and 2019 sq ft.',contentHash:'hash',metadata:{parser:'test',transport:'test',partial:false}}
   const value=profile('subject',1350000),o=value.offerings[0]
   o.evidence=['salePrice','bedroomsMin','bedroomsMax','bathroomsMin','bathroomsMax','sqftMin','sqftMax'].map(field=>({field:field as ResearchOffering['evidence'][number]['field'],sourceId:id,quote:doc.text}))
   expect(validateResearchProfile(value,[doc],'subject',model)).toBeTruthy()
   expect(()=>validateResearchProfile(value,[{...doc,entityKey:'other'}],'subject',model)).toThrow('quotation')
   o.salePrice=1400000;expect(()=>validateResearchProfile(value,[doc],'subject',model)).toThrow('numeric')
 })
})
