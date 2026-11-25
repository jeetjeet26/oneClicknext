import { createServiceClient } from '@/utils/supabase/admin'
import type { ResearchResult,ResearchTarget } from './research-contracts'
/** Only sources for an unchanged community identity may enrich a competitor card. */
export async function readSavedResearchProfiles(propertyId:string,transaction:string|null,competitors:Array<{id:string;websiteUrl:string|null;propertyType:string|null}>){
  if(!transaction)return new Map<string,ResearchResult['profiles'][number]>()
  const {data,error}=await createServiceClient().from('marketvision_research_jobs').select('result,context').eq('property_id',propertyId).in('state',['completed','partial']).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('Saved research unavailable')
  if(!data)return new Map<string,ResearchResult['profiles'][number]>()
  const result=data.result as unknown as ResearchResult,context=data.context as unknown as {targets:ResearchTarget[]}
  if(result.version!==1 || transaction && result.model.transaction!==transaction)return new Map<string,ResearchResult['profiles'][number]>()
  return new Map(result.profiles.flatMap(profile=>{
    const competitor=competitors.find(c=>c.id===profile.entityKey),target=context.targets.find(t=>t.entityKey===profile.entityKey)
    return competitor && target && target.website===competitor.websiteUrl && target.propertyType===competitor.propertyType?[[competitor.id,profile] as const]:[]
  }))
}
