import { createServiceClient } from '@/utils/supabase/admin'
import { AnalysisSnapshot } from './analysis'
import { MarketStoreError } from './decision-store'

export async function readMarketAnalysis(propertyId:string, actorId:string, days:number) {
  const {data,error}=await createServiceClient().rpc('read_marketvision_analysis',{p_property_id:propertyId,p_actor_id:actorId,p_days:days})
  if(error || !data)throw new MarketStoreError('Market evidence could not be loaded. Try again.')
  const state=(data as {state?:string}).state
  if(state==='forbidden')throw new MarketStoreError('This property is unavailable.',403)
  if(state!=='ready')throw new MarketStoreError('The complete market snapshot could not be loaded. No partial report was produced.')
  const result=AnalysisSnapshot.safeParse(data)
  if(!result.success)throw new MarketStoreError('Saved market evidence needs repair before this report can be displayed.')
  return result.data
}
