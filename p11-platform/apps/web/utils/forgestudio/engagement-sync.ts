import {randomUUID} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import type {Tables} from '@/types/supabase'
import {decryptSecret} from './crypto'
import {getAdapter,type AdapterConnection,type EngagementMetrics} from './adapters'
import {ContentStoreError} from './content-store'
export const METRIC_KEYS=['impressions','reach','clicks','reactions','comments','shares','saves','video_views','video_completions'] as const
export type MetricKey=typeof METRIC_KEYS[number]
export type PublicationMetrics=Record<MetricKey,number|null>
type ObjectValue=Record<string,unknown>
export function normalizedMetrics(metrics:EngagementMetrics):PublicationMetrics{
 const values={impressions:metrics.impressions,reach:metrics.reach,clicks:metrics.clicks,reactions:metrics.reactions,comments:metrics.comments,shares:metrics.shares,saves:metrics.saves,video_views:metrics.videoViews,video_completions:metrics.videoCompletions}
 for(const value of Object.values(values))if(value!==undefined&&value!==null&&(!Number.isSafeInteger(value)||value<0||value>1_000_000_000_000))throw new Error('Provider returned an invalid metric count')
 return Object.fromEntries(METRIC_KEYS.map(key=>[key,values[key]??null])) as PublicationMetrics
}
const ratio=(numerator:number|null,denominator:number|null)=>numerator!==null&&denominator!==null&&denominator>0?numerator/denominator:null
export function calculatePublicationKpis(metrics:PublicationMetrics){
 const interactions=[metrics.reactions,metrics.comments,metrics.shares,metrics.saves],total=interactions.every((v):v is number=>v!==null)?interactions.reduce((sum,value)=>sum+value,0):null
 return {engagement_rate:ratio(total,metrics.impressions),click_through_rate:ratio(metrics.clicks,metrics.impressions),video_completion_rate:ratio(metrics.video_completions,metrics.video_views)}
}
export async function measurementRpc(name:string,args:ObjectValue,allowed?:string[]):Promise<ObjectValue>{
 const db=createServiceClient() as unknown as {rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>},result=await db.rpc(name,args)
 if(result.error||!result.data)throw new ContentStoreError('Measurement evidence could not be confirmed. Reload the saved result before continuing.',503)
 if(allowed&&!allowed.includes(String(result.data.state)))throw new ContentStoreError(({publication_unavailable:'A confirmed published post is required before recording results.',stale_measurement:'This observation was reviewed since you opened it. Reload its current review before deciding.',stale_attribution:'This attributed report changed. Reload before deciding.',forbidden:'Your current access does not allow this outcome decision.',request_conflict:'This request differs from its saved result. Reload the saved work.'} as Record<string,string>)[String(result.data.state)]||'The saved outcome evidence needs review.',result.data.state==='forbidden'?403:409)
 return result.data
}
function adapterConnection(row:Tables<'social_connections'>):AdapterConnection{
 if(!row.account_id||!row.property_id)throw new Error('Saved account identity unavailable')
 return {id:row.id,propertyId:row.property_id,platform:row.platform,accountId:row.account_id,accessToken:row.access_token?decryptSecret(row.access_token):null,refreshToken:row.refresh_token?decryptSecret(row.refresh_token):null,pageAccessToken:row.page_access_token?decryptSecret(row.page_access_token):null,tokenExpiresAt:row.token_expires_at,pageId:row.page_id}
}
export async function processSavedMeasurement(measurementId?:string):Promise<'synced'|'unsupported'|'failed'|'held'|'skipped'>{
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return 'skipped'
 const claimed=await measurementRpc('claim_forgestudio_measurement',measurementId?{p_id:measurementId}:{})
 if(claimed.state==='empty')return 'skipped'
 if(claimed.state==='held')return 'held'
 if(claimed.state!=='claimed')throw new Error('Measurement request could not be claimed')
 const run=claimed.measurement as Tables<'forgestudio_measurements'>,snapshot=run.snapshot as {publication:{platform:string;remotePostId:string}},adapter=getAdapter(snapshot.publication.platform)
 let result:ObjectValue
 if(!adapter?.fetchMetrics)result={status:'unsupported',code:'metrics_unsupported'}
 else{
  try{
   if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return 'skipped'
   const fetched=await adapter.fetchMetrics(adapterConnection(claimed.connection as Tables<'social_connections'>),snapshot.publication.remotePostId)
   result={status:'observed',metrics:normalizedMetrics(fetched),definition:'provider_reported_snapshot.v1',observedAt:new Date().toISOString(),providerPayload:fetched.providerPayload??{}}
  }catch{result={status:'failed',code:'provider_read_failed'}}
 }
 // Replay only the identical receipt if its database acknowledgement is lost.
 let failure:unknown
 for(let i=0;i<2;i++)try{const saved=await measurementRpc('finish_forgestudio_measurement',{p_id:run.id,p_claim_token:run.claim_token,p_result:result},['saved','replayed']);return saved.measurementState==='completed'?'synced':saved.measurementState==='unsupported'?'unsupported':saved.measurementState==='held'?'held':'failed'}catch(error){failure=error}
 throw failure
}
export async function requestPublicationMetrics(input:{requestId:string;publicationId:string;propertyId:string;actorId:string}){
 const saved=await measurementRpc('begin_forgestudio_measurement',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId,p_publication_id:input.publicationId},['saved','replayed'])
 // The saved request is returned immediately. The bounded worker reads it later.
 return {...saved,paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true'}
}
export async function syncPublicationMetrics(publication:Tables<'social_publications'>):Promise<'synced'|'unsupported'|'skipped'|'held'|'failed'>{
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true'||publication.status!=='published'||!publication.remote_post_id)return 'skipped'
 const id=randomUUID()
 const saved=await measurementRpc('begin_forgestudio_measurement',{p_id:id,p_property_id:publication.property_id,p_actor_id:null,p_publication_id:publication.id},['saved','replayed'])
 if(saved.measurementState==='held')return 'held'
 return processSavedMeasurement(String(saved.measurementId))
}
export async function syncRecentPublicationMetrics(input:{propertyId?:string;limit?:number}={}):Promise<{synced:number;unsupported:number;failed:number;held:number;paused?:boolean}>{
 const totals={synced:0,unsupported:0,failed:0,held:0}
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return {...totals,paused:true}
 const limit=Math.max(1,Math.min(input.limit??10,10)),db=createServiceClient()
 const {data:due,error}=await db.rpc('due_forgestudio_measurements',{p_limit:limit,...(input.propertyId?{p_property_id:input.propertyId}:{})})
 if(error)throw new Error('Published posts due for measurement could not be loaded')
 for(const publication of due??[])await measurementRpc('begin_forgestudio_measurement',{p_id:randomUUID(),p_property_id:publication.property_id,p_actor_id:null,p_publication_id:publication.id},['saved','replayed'])
 // Old pending requests run first, within any explicitly requested property.
 let pendingQuery=db.from('forgestudio_measurements').select('id').or(`state.eq.queued,and(state.eq.reading,lease_expires_at.lt.${new Date().toISOString()})`).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(limit)
 if(input.propertyId)pendingQuery=pendingQuery.eq('property_id',input.propertyId)
 const {data:pending,error:pendingError}=await pendingQuery
 if(pendingError)throw new Error('Pending measurement requests could not be loaded')
 for(const row of pending??[])try{const result=await processSavedMeasurement(row.id);if(result==='skipped'){if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')break;continue}totals[result]++}catch{totals.failed++}
 return totals
}
