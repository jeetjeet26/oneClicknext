import {createServiceClient} from '@/utils/supabase/admin'
import {reviewRpc,ReviewStoreError} from './analysis-store'
import {parseSavedManualIntake,parseSavedProviderIntake,INTAKE_MAX_BYTES} from './intake-parser'
import {executeSavedIntakeFetch,prepareIntakeFetch,type SavedIntakeFetch,type IntakeReceipt} from './intake-fetch'
import {intakeStates} from './intake-contracts'
type ObjectValue=Record<string,unknown>
export async function intakeRpc(name:string,args:ObjectValue){const result=await reviewRpc(name,args);if(!intakeStates.includes(String(result.state)))throw new ReviewStoreError(({forbidden:'This property is unavailable to your account.',manager_required:'A manager or admin must review source imports.',stale_connection:'Source settings changed. Reload the saved connection.',stale_request:'This import changed. Reload its saved status.',source_changed:'The saved source changed. Review its current settings before creating a new request.',request_conflict:'This decision differs from its saved request. Reload import history.',rebase_unavailable:'This source cannot be reused. Review its error and save a corrected source.',source_unavailable:'An enabled, reviewed source is required.',not_found:'Saved import unavailable.'} as Record<string,string>)[String(result.state)]||'This saved import requires review.',result.state==='forbidden'||result.state==='manager_required'?403:409);return result}
export async function requestIntake(id:string,propertyId:string,actorId:string|null,input:ObjectValue){
 if(typeof input.content==='string'&&Buffer.byteLength(input.content,'utf8')>INTAKE_MAX_BYTES)throw new ReviewStoreError('Import files must be at most 2 MB.',413)
 const db=createServiceClient();let fetchInput:SavedIntakeFetch|Record<string,never>={}
 if(input.kind==='source'){
  const prior=await db.from('reviewflow_intake_requests').select('id').eq('id',id).eq('property_id',propertyId).maybeSingle();if(prior.error)throw new ReviewStoreError('Import history could not be loaded.')
  if(!prior.data){const c=await db.from('review_platform_connections').select('platform,place_id,yelp_business_id,connection_type,version').eq('id',String(input.connectionId)).eq('property_id',propertyId).maybeSingle();if(c.error)throw new ReviewStoreError('Source settings could not be loaded.');if(!c.data)throw new ReviewStoreError('Saved source unavailable.',404);if(c.data.version!==input.connectionVersion)throw new ReviewStoreError('Source settings changed. Reload them.',409);try{fetchInput=prepareIntakeFetch({platform:c.data.platform,providerId:(c.data.platform==='google'?c.data.place_id:c.data.yelp_business_id)||'',method:c.data.connection_type||''})}catch{throw new ReviewStoreError('The source or collection service configuration needs review.',409)}}
 }
 return intakeRpc('begin_reviewflow_intake',{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_input:input,p_fetch_input:fetchInput})
}
export async function recoverIntake(id:string,propertyId:string){
 const {data:run,error}=await createServiceClient().from('reviewflow_intake_requests').select('*').eq('id',id).eq('property_id',propertyId).maybeSingle();if(error)throw new ReviewStoreError('Saved source result could not be loaded.');if(!run)throw new ReviewStoreError('Saved import unavailable.',404)
 if(run.state!=='result_ready')return{state:run.state,requestId:run.id}
 let normalized:ReturnType<typeof parseSavedManualIntake>|null=null,parseError:string|null=null
 try{const receipt=run.raw_result as unknown as IntakeReceipt;normalized=run.kind==='source'?parseSavedProviderIntake(run.fetch_input as unknown as SavedIntakeFetch,receipt):parseSavedManualIntake(run.kind as 'manual'|'csv',receipt.content||'')}catch(e){parseError=e instanceof Error?e.message:'The source does not match its saved contract.'}
 return intakeRpc('preview_reviewflow_intake',{p_id:id,p_result_hash:run.result_hash,p_normalized:normalized,p_error:parseError})
}
export async function runSavedIntake(id:string){
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return{state:'paused'}
 const claim=await reviewRpc('claim_reviewflow_intake',{p_id:id});if(claim.state!=='invoke_once')return claim
 const receipt=await executeSavedIntakeFetch(claim.fetchInput as SavedIntakeFetch,id),args={p_id:id,p_claim_token:claim.claimToken,p_result:receipt}
 let saved:ObjectValue;try{saved=await intakeRpc('record_reviewflow_intake_result',args)}catch{saved=await intakeRpc('record_reviewflow_intake_result',args)}
 // Retry persistence only. A claimed source fetch is never invoked a second time.
 if(saved.requestState==='result_ready')return recoverIntake(id,String(claim.propertyId));return saved
}
export function reviewScheduleKey(connection:{id:string;version:number;sync_frequency:string|null},now:Date){return `${connection.id}:${connection.version}:${now.toISOString().slice(0,connection.sync_frequency==='daily'?10:13).replace('T','-')}`}
