import { z } from 'zod'
import { TRANSACTIONS, type CommunityModel } from '@/utils/community-model'
import type { ResearchDocument } from './research-source'

export const researchCitation = z.object({sourceId:z.uuid(),quote:z.string().min(1).max(1500)})
const amount = z.number().min(0).max(1000000000).nullable()
export const researchOffering = z.object({
  name:z.string().min(1).max(250), kind:z.enum(['plan','homesite','rental_unit','service','commercial_space','stay']),
  priceBasis:z.enum(['sale_price_usd','monthly_rent_usd','unconfirmed']),
  salePrice:amount, monthlyRent:amount,
  bedroomsMin:amount,bedroomsMax:amount,bathroomsMin:amount,bathroomsMax:amount,sqftMin:amount,sqftMax:amount,
  availableCount:amount,status:z.string().max(250).nullable(),
  terms:z.string().max(2000).nullable(),
  evidence:z.array(researchCitation.extend({field:z.enum(['name','salePrice','monthlyRent','bedroomsMin','bedroomsMax','bathroomsMin','bathroomsMax','sqftMin','sqftMax','availableCount','status','terms'])})).min(1).max(40),
})
export const researchFact = z.object({
  category:z.enum(['specifications','amenities','ownership_costs','incentives','availability','location','positioning','conversion','reviews','ads','visuals','limitations']),
  statement:z.string().min(1).max(1500), kind:z.enum(['source_claim','interpretation']), evidence:z.array(researchCitation).min(1).max(8),
})
export const researchProfile = z.object({
  entityKey:z.string().min(1).max(100),name:z.string().min(1).max(250),website:z.string().url(),
  propertyType:z.string().max(100).nullable(),transaction:z.enum([...TRANSACTIONS,'unknown']),
  offerings:z.array(researchOffering).max(100),facts:z.array(researchFact).max(100),
  coverageGaps:z.array(z.string().max(1000)).max(30),
})
export const researchInsight = z.object({
  title:z.string().min(1).max(250),finding:z.string().min(1).max(2500),
  implication:z.string().min(1).max(2000),action:z.string().min(1).max(2000),
  evidence:z.array(researchCitation).min(1).max(12),
  confidence:z.enum(['strong','moderate','limited']),limitations:z.array(z.string().max(1000)).min(1).max(12),
})
export type ResearchProfile = z.infer<typeof researchProfile>
export type ResearchInsight = z.infer<typeof researchInsight>
export type ResearchOffering = z.infer<typeof researchOffering>
export interface ResearchTarget {entityKey:string;name:string;website:string;propertyType:string|null;competitorId:string|null;additionalSources:Array<{url:string;kind:ResearchDocument['kind']}>}
export interface ResearchComparison {
  competitorKey:string;subjectPlan:string;competitorPlan:string;subjectPrice:number;competitorPrice:number;premiumPct:number;
  subjectSqft:number|null;competitorSqft:number|null;subjectPricePerSqft:number|null;competitorPricePerSqft:number|null;
  basis:'sale_price_usd'|'monthly_rent_usd'; comparability:'similar_configuration'|'alternative_product';limitations:string[];sourceIds:string[]
}
export interface ResearchResult {
  version:1;model:CommunityModel;profiles:ResearchProfile[];insights:ResearchInsight[];comparisons:ResearchComparison[];
  changes:Array<{entityKey:string;offering:string;field:string;previous:number;current:number;sourceIds:string[]}>;
  sourceCount:number;failedSources:number;generatedAt:string;limitations:string[]
}
export function validateResearchCitations(citations:Array<z.infer<typeof researchCitation>>,documents:ResearchDocument[],entityKey?:string) {
  for (const citation of citations) {
    const source=documents.find(doc=>doc.id===citation.sourceId && doc.status==='captured' && (!entityKey || doc.entityKey===entityKey))
    if (!source || ![source.text,source.metadata.terms || ''].some(text=>text.includes(citation.quote))) throw new Error('A research quotation is absent from its retained entity source')
  }
}
export function validateResearchProfile(value:unknown,documents:ResearchDocument[],expectedKey:string,model:CommunityModel):ResearchProfile {
  const profile=researchProfile.parse(value)
  if (profile.entityKey!==expectedKey) throw new Error('Research entity identity changed')
  if(expectedKey==='subject' && profile.transaction!==model.transaction) throw new Error('Source text cannot override the onboarding transaction')
  for(const fact of profile.facts) validateResearchCitations(fact.evidence,documents,expectedKey)
  for(const offering of profile.offerings){
    validateResearchCitations(offering.evidence,documents,expectedKey)
    if (offering.salePrice!==null && (offering.priceBasis!=='sale_price_usd' || offering.monthlyRent!==null)) throw new Error('Sale and rental prices cannot be mixed')
    if (offering.salePrice===0) throw new Error('A zero or placeholder sale price is not an advertised asking price')
    if (offering.monthlyRent!==null && (offering.priceBasis!=='monthly_rent_usd' || offering.salePrice!==null)) throw new Error('Rental and sale prices cannot be mixed')
    if (profile.transaction==='for_sale' && offering.monthlyRent!==null || profile.transaction==='rental' && offering.salePrice!==null) throw new Error('Price does not match the entity transaction')
    for(const [key,value] of Object.entries(offering)){
      if(typeof value!=='number')continue
      const quotes=offering.evidence.filter(item=>item.field===key).map(item=>item.quote.replace(/,/g,''))
      const token=new RegExp(`(?<![\\d.])${String(value).replace('.','\\.')}(?![\\d.])`)
      if(!quotes.some(quote=>token.test(quote)))throw new Error(`Offering field ${key} lacks quoted numeric evidence`)
    }
    for(const [min,max] of [[offering.bedroomsMin,offering.bedroomsMax],[offering.bathroomsMin,offering.bathroomsMax],[offering.sqftMin,offering.sqftMax]])if(min!==null && max!==null && min>max)throw new Error('Offering range is reversed')
  }
  return profile
}
