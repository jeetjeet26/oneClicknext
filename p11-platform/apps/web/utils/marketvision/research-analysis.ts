import type { CommunityModel } from '@/utils/community-model'
import type { ResearchProfile, ResearchComparison, ResearchResult, ResearchOffering } from './research-contracts'
const price=(offering:ResearchOffering,model:CommunityModel)=>model.priceBasis==='sale_price_usd'?offering.salePrice:model.priceBasis==='monthly_rent_usd'?offering.monthlyRent:null
const round=(value:number)=>Math.round(value*100)/100
/** Comparisons are configurations in the observed sample, never market valuation or closed-sale comparables. */
export function compareResearchProfiles(profiles:ResearchProfile[],model:CommunityModel):ResearchComparison[]{
  const subject=profiles.find(p=>p.entityKey==='subject');if(!subject)return []
  const rows:ResearchComparison[]=[]
  for(const competitor of profiles.filter(p=>p.entityKey!=='subject' && p.transaction===model.transaction)){
    for(const own of subject.offerings){
      const ownPrice=price(own,model)
      if(ownPrice===null || ownPrice<=0 || own.priceBasis!==model.priceBasis || own.bedroomsMin===null)continue
      const restricted=(o:ResearchOffering)=>/income[- ]restricted|below[- ]market|\bBMR\b|income eligibility/i.test(o.terms || '')
      if(restricted(own))continue
      const candidates=competitor.offerings.filter(other=>!restricted(other) && other.kind===own.kind && other.priceBasis===model.priceBasis && price(other,model)!==null && price(other,model)!>0 && other.bedroomsMin!==null && other.bedroomsMin<=own.bedroomsMin! && (other.bedroomsMax??other.bedroomsMin)>=own.bedroomsMin!)
      const best=candidates.sort((a,b)=>Math.abs((a.sqftMin??Infinity)-(own.sqftMin??0))-Math.abs((b.sqftMin??Infinity)-(own.sqftMin??0)) || a.name.localeCompare(b.name))[0]
      if(!best)continue
      const otherPrice=price(best,model)!
      const similar=subject.propertyType!==null && subject.propertyType===competitor.propertyType && own.sqftMin!==null && best.sqftMin!==null && Math.abs(own.sqftMin/best.sqftMin-1)<=0.15
      rows.push({competitorKey:competitor.entityKey,subjectPlan:own.name,competitorPlan:best.name,subjectPrice:ownPrice,competitorPrice:otherPrice,premiumPct:round((ownPrice/otherPrice-1)*100),subjectSqft:own.sqftMin,competitorSqft:best.sqftMin,subjectPricePerSqft:own.sqftMin?round(ownPrice/own.sqftMin):null,competitorPricePerSqft:best.sqftMin?round(otherPrice/best.sqftMin):null,basis:model.priceBasis as ResearchComparison['basis'],comparability:similar?'similar_configuration':'alternative_product',limitations:['Advertised prices from captured sources; not closed-sale prices or an appraisal.','Bedroom overlap and approximate size do not establish equal specifications, incentives, homesites or delivery dates.',...(own.terms?[`Subject terms: ${own.terms}`]:[]),...(best.terms?[`Competitor terms: ${best.terms}`]:[])],sourceIds:[...new Set([...own.evidence,...best.evidence].map(e=>e.sourceId))]})
    }
  }
  return rows
}
export function researchChanges(previous:ResearchResult|null,profiles:ResearchProfile[],model:CommunityModel):ResearchResult['changes']{
  if(!previous || previous.model.transaction!==model.transaction)return []
  const changes:ResearchResult['changes']=[]
  for(const profile of profiles){const old=previous.profiles.find(p=>p.entityKey===profile.entityKey);if(!old)continue
    for(const offering of profile.offerings){const before=old.offerings.find(o=>o.name===offering.name && o.kind===offering.kind && o.priceBasis===offering.priceBasis);if(!before)continue
      for(const field of ['salePrice','monthlyRent','availableCount'] as const){const prior=before[field],current=offering[field];if(prior!==null && current!==null && prior!==current)changes.push({entityKey:profile.entityKey,offering:offering.name,field,previous:prior,current,sourceIds:[...new Set([...before.evidence,...offering.evidence].filter(e=>e.field===field).map(e=>e.sourceId))]})}
    }
  }
  return changes
}
