import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {createServiceClient} from '@/utils/supabase/admin'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from './delivery-guard'
import {sendEmail,sendMessage,isMessagingConfigured,replaceTemplateVariables} from './messaging'

export type WorkflowDelivery={
 id:string;property_id:string;lead_id:string;lead_workflow_id:string;step_number:number;state:string;channel:'sms'|'email';recipient:string;
 snapshot:{firstName:string;lastName:string;propertyName:string;tourLink:string|null;template:{body:string;subject:string|null}};
 body:string|null;subject:string|null;sender:string|null;lease_token:string;lease_until:string|null;started_at:string|null;
 attempts:number;legacy:boolean;provider_id:string|null;error_code:string|null;created_at:string;settled?:boolean
}
type WorkflowDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'|'Tables'> & {
 Functions:Database['public']['Functions'] & {
  pending_workflow_deliveries:{Args:{p_limit:number};Returns:Json}
  prepare_workflow_delivery:{Args:{p_workflow_id:string};Returns:Json}
  start_workflow_delivery:{Args:{p_id:string;p_token:string;p_body:string;p_subject:string|null;p_sender:string;p_issue?:string|null};Returns:Json}
  finish_workflow_delivery:{Args:{p_id:string;p_token:string;p_provider_id:string|null};Returns:boolean}
  review_workflow_delivery:{Args:{p_property_id:string;p_lead_id:string;p_delivery_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
  control_lead_workflow:{Args:{p_property_id:string;p_lead_id:string;p_workflow_id:string;p_actor_id:string;p_action:string};Returns:Json}
 },Tables:Database['public']['Tables'] & {
  workflow_deliveries:{Row:WorkflowDelivery;Insert:never;Update:never;Relationships:[]}
  workflow_delivery_reviews:{Row:{delivery_id:string;property_id:string;lead_id:string;input:{reason:string};created_at:string};Insert:never;Update:never;Relationships:[]}
 }
}}
export const workflowDb=(db:SupabaseClient<Database>)=>db as unknown as SupabaseClient<WorkflowDatabase>
export interface ProcessResult {processed:number;succeeded:number;failed:number;errors:string[];review:number;skipped:number}
const paused=()=>isDeliveryPaused() || process.env.WORKFLOW_DELIVERY_PAUSED?.trim().toLowerCase()==='true'
export function workflowContent(d:WorkflowDelivery) {
 if(d.body)return {body:d.body,subject:d.subject,issue:null}
 const s=d.snapshot,template=s.template
 if(!template?.body)return {body:'',subject:null,issue:'template_unavailable'}
 let link=s.tourLink || ''
 try {const url=new URL(link);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname.startsWith('/dashboard'))link=''} catch {link=''}
 const variables={first_name:s.firstName||'there',last_name:s.lastName||'',property_name:s.propertyName,tour_link:link}
 const body=replaceTemplateVariables(template.body,variables),subject=template.subject?replaceTemplateVariables(template.subject,variables):null
 return {body,subject,issue:/\{\{?\w+\}?\}/.test(body+' '+(subject||''))?'template_variables_missing':null}
}
/** A send is attempted once, after durable intent. Uncertain responses require evidence-based review. */
export async function processWorkflowDeliveries():Promise<ProcessResult> {
 const result:ProcessResult={processed:0,succeeded:0,failed:0,errors:[],review:0,skipped:0}
 if(paused()){result.errors.push(DELIVERY_PAUSED_MESSAGE);return result}
 const db=workflowDb(createServiceClient())
 const pending=await db.rpc('pending_workflow_deliveries',{p_limit:100})
 if(pending.error || !pending.data)throw new Error('Follow-up queue could not be loaded')
 const list=pending.data as unknown as {candidates:string[];review:number}
 if(!Array.isArray(list.candidates))throw new Error('Follow-up queue response is invalid')
 result.review=list.review
 if(result.review)result.errors.push(`${result.review} follow-ups need delivery review`)
 for(const id of list.candidates) {
  if(paused()){result.errors.push(DELIVERY_PAUSED_MESSAGE);break}
  try {
   const claim=await db.rpc('prepare_workflow_delivery',{p_workflow_id:id})
   if(claim.error)throw new Error('Follow-up claim was not confirmed')
   if(!claim.data){result.skipped++;continue}
   const d=claim.data as unknown as WorkflowDelivery
   result.processed++
   if(d.settled || d.state==='accepted'){result.succeeded++;continue}
   if(d.state==='skipped'){result.skipped++;continue}
   if(d.state==='review'){result.review++;result.errors.push(`Follow-up ${id} needs review`);continue}
   if(d.state!=='running'||!d.lease_token)throw new Error('Unexpected follow-up claim')
   const content=workflowContent(d),configured=isMessagingConfigured()[d.channel]
   const sender=d.sender || (d.channel==='email'?process.env.RESEND_FROM_EMAIL:process.env.TELNYX_PHONE_NUMBER) || ''
   const started=await db.rpc('start_workflow_delivery',{p_id:d.id,p_token:d.lease_token,p_body:content.body,p_subject:content.subject,p_sender:sender,p_issue:paused()?'delivery_paused':!configured?'configuration_missing':content.issue})
   if(started.error)throw new Error('Follow-up attempt acknowledgement was lost; delivery needs review')
   if(!started.data){result.review++;result.errors.push(`Follow-up ${id} is held before sending`);continue}
   // Recheck the global hold at the provider boundary. No unchecked cleanup after this checkpoint.
   let receipt:string|null=null
   if(!paused()) {
    try {
     const sent=d.channel==='email'
      ?await sendEmail(d.recipient,content.subject!,content.body,sender,undefined,undefined,`workflow/${d.id}`)
      :await sendMessage({to:d.recipient,channel:'sms',body:content.body,from:sender})
     if(sent.success && sent.messageId)receipt=sent.messageId
    } catch { /* The transport may have accepted it. Preserve the attempted state. */ }
   }
   const saved=await db.rpc('finish_workflow_delivery',{p_id:d.id,p_token:d.lease_token,p_provider_id:receipt})
   if(saved.error || saved.data!==true)throw new Error('Follow-up receipt save was not confirmed; review before retrying')
   if(receipt)result.succeeded++
   else {result.review++;result.errors.push(`Follow-up ${id} has an unconfirmed provider outcome`)}
  } catch(e){result.failed++;result.errors.push(e instanceof Error?e.message:'Follow-up processing failed')}
 }
 return result
}

