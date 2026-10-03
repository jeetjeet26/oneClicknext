/** One durable write intent per publication. Unknown outcomes require review. */
import {randomUUID} from 'node:crypto'
import {requireDeliveryEnabled} from '@/utils/services/delivery-guard'
import {createServiceClient} from '@/utils/supabase/admin'
import type {Tables} from '@/types/supabase'
import {decryptSecret} from './crypto'
import {getAdapter,isChannelEnabled,type AdapterConnection,type AdapterVariant,type PublishOutcome} from './adapters'

export const PUBLICATION_JOB_DOMAIN='forgestudio.publication'
export type WorkerJobResult={jobId:string;publicationId:string|null;outcome:'published'|'reconciling'|'failed'|'skipped';error?:string}
export type WorkerRunResult={claimed:number;results:WorkerJobResult[]}
type Prepared={state:string;status?:string;fingerprint:string;publication:Tables<'social_publications'>;variant:Tables<'social_content_variants'>;connection:Tables<'social_connections'>;idempotencyKey?:string}
async function rpc(name:string,args:Record<string,unknown>):Promise<Prepared>{
 const client=createServiceClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Prepared|null;error:{message:string}|null}>}
 const {data,error}=await client.rpc(name,args)
 if(error||!data) throw new Error('Publication evidence could not be confirmed. Reload the saved result before continuing.')
 return data
}
function connectionInput(row:Tables<'social_connections'>,propertyId:string):AdapterConnection{
 if(!row.account_id)throw new Error('The connected account has no saved provider identity')
 return {id:row.id,propertyId,platform:row.platform,accountId:row.account_id,accessToken:row.access_token?decryptSecret(row.access_token):null,refreshToken:row.refresh_token?decryptSecret(row.refresh_token):null,pageAccessToken:row.page_access_token?decryptSecret(row.page_access_token):null,tokenExpiresAt:row.token_expires_at,pageId:row.page_id}
}
function variantInput(row:Tables<'social_content_variants'>):AdapterVariant{
 // Preserve the exact reviewed link. Tracking substitution must itself be reviewed.
 return {caption:row.caption,hashtags:row.hashtags,callToAction:row.call_to_action,linkUrl:row.link_url,mediaUrls:row.media_urls,altText:row.alt_text,contentFormat:row.content_format,platformOptions:(row.platform_options??{}) as Record<string,unknown>}
}
async function processJob(job:Tables<'shared_jobs'>,workerId:string):Promise<WorkerJobResult>{
 const claimId=randomUUID(),base={jobId:job.id,publicationId:job.subject_id}
 const args={p_job_id:job.id,p_worker:workerId,p_claim_id:claimId}
 // Persistence retry repeats only the identical receipt, never the provider call.
 async function finish(payload:Record<string,unknown>){
  let failure:unknown
  for(let i=0;i<2;i++){
   try {const result=await rpc('finish_forgestudio_publication_write',{...args,p_payload:payload});if(!['saved','replayed'].includes(result.state))throw new Error(`Publication result needs review (${result.state})`);return result}
   catch(error){failure=error}
  }
  throw failure
 }
 let prepared:Prepared,connection:AdapterConnection,variant:AdapterVariant
 try{
  prepared=await rpc('prepare_forgestudio_publication_write',{...args,p_fingerprint:null})
  if(prepared.state!=='prepared'){
   if(['write_already_recorded','lease_lost'].includes(prepared.state))return {...base,outcome:'reconciling',error:'A prior write or worker lease needs review. No new post was sent.'}
   throw new Error(`Publication held before sending (${prepared.state})`)
  }
  connection=connectionInput(prepared.connection,prepared.publication.property_id)
  variant=variantInput(prepared.variant)
  const adapter=getAdapter(prepared.publication.platform)
  if(!adapter||!isChannelEnabled(prepared.publication.platform))throw new Error('This channel is not enabled for publishing')
  // Preflight is local validation only; token renewal must be a separate saved flow.
  await adapter.preflight(connection,variant)
  requireDeliveryEnabled()
 }catch(error){
  const message=error instanceof Error?error.message:'Publication could not be prepared'
  await finish({kind:'blocked_before_send',reason:message}).catch(()=>undefined)
  return {...base,outcome:'failed',error:message}
 }
 // A lost intent acknowledgement cannot authorize a send. A subsequent worker
 // sees the unique saved intent and holds the publication.
 const intent=await rpc('prepare_forgestudio_publication_write',{...args,p_fingerprint:prepared.fingerprint})
 if(intent.state!=='proceed_once')return {...base,outcome:'reconciling',error:`Publication held (${intent.state})`}
 let outcome:PublishOutcome
 try{
  requireDeliveryEnabled()
  const adapter=getAdapter(prepared.publication.platform)!
  outcome=await adapter.publish(connection,variant,{idempotencyKey:intent.idempotencyKey!})
  if(!outcome?.providerPostId||!/^[a-zA-Z0-9_:.\-]{1,300}$/.test(outcome.providerPostId))throw new Error('Provider response did not identify a saved post')
 }catch{
  // Provider errors, including 5xx and malformed acknowledgements, can occur
  // after a remote write. Never infer permission to resend from an exception.
  const message='The provider result is uncertain. Review the destination before taking another action.'
  await finish({kind:'provider_uncertain',reason:message}).catch(()=>undefined)
  return {...base,outcome:'reconciling',error:message}
 }
 // Database errors are deliberately outside the provider catch: an actual
 // acknowledgement must never be rewritten as a failed, retryable send.
 try{
  const result=await finish({kind:'provider_acknowledged',providerPostId:outcome.providerPostId,providerPostUrl:outcome.providerPostUrl})
  return {...base,outcome:result.status==='reconciling'?'reconciling':'published'}
 }catch{
  return {...base,outcome:'reconciling',error:'The provider acknowledged the post, but its saved result needs review. No resend was queued.'}
 }
}
export async function processDuePublications(options:{workerId:string;limit?:number}):Promise<WorkerRunResult>{
 requireDeliveryEnabled()
 const leaseOwner=options.workerId+':'+randomUUID()
 const {data:jobs,error}=await createServiceClient().rpc('claim_shared_jobs',{p_domain:PUBLICATION_JOB_DOMAIN,p_worker:leaseOwner,p_limit:options.limit??5,p_lease_seconds:300})
 if(error)throw new Error('Publication jobs could not be claimed')
 const results:WorkerJobResult[]=[]
 for(const job of jobs??[]){
  try{results.push(await processJob(job,leaseOwner))}
  catch{results.push({jobId:job.id,publicationId:job.subject_id,outcome:'reconciling',error:'Saved publication evidence needs review. No retry was queued.'})}
 }
 return {claimed:(jobs??[]).length,results}
}
