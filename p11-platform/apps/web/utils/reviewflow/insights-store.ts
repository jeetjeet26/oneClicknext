import {createServiceClient} from '@/utils/supabase/admin'
import {reviewRpc,ReviewStoreError} from './analysis-store'
import {computeIssueClusters,type ReviewForInsights,type AnalysisForInsights,type CaseForInsights} from './insights'
export type InsightSource={asOf:string;windowDays:number;reviews:ReviewForInsights[];analyses:AnalysisForInsights[];cases:CaseForInsights[];coverage:{dateFallbackReviews:number;staffReviewAnalyses:number;openPropertyCases:number;storedPropertyReviews:number}}
export async function readInsightPreview(propertyId:string,actorId:string,days:number,asOf=new Date().toISOString()){
 const snapshot=await reviewRpc('read_reviewflow_insight_source',{p_property_id:propertyId,p_actor_id:actorId,p_days:days,p_as_of:asOf},['ready'])
 const source=snapshot.source as InsightSource
 return{...computeIssueClusters({...source,now:new Date(source.asOf)}),asOf:source.asOf,sourceHash:String(snapshot.sourceHash),coverage:source.coverage}
}
export async function saveInsightReport(id:string,propertyId:string,actorId:string,input:{windowDays:number;asOf:string;sourceHash:string;reason:string}){
 const prior=await createServiceClient().from('reviewflow_insight_reports').select('id').eq('id',id).eq('property_id',propertyId).maybeSingle();if(prior.error)throw new ReviewStoreError('Saved reports could not be loaded.')
 if(prior.data)return reviewRpc('save_reviewflow_insight_report',{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_input:input,p_result:{}},['saved','replayed'])
 const preview=await readInsightPreview(propertyId,actorId,input.windowDays,input.asOf)
 if(preview.sourceHash!==input.sourceHash)throw new ReviewStoreError('The report source changed. Refresh insights and review the updated evidence before saving.',409)
 return reviewRpc('save_reviewflow_insight_report',{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_input:input,p_result:preview},['saved','replayed'])
}
