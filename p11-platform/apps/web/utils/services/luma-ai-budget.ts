import { createServiceClient } from '@/utils/supabase/admin'
import type OpenAI from 'openai'
import type {ChatCompletion,ChatCompletionCreateParamsNonStreaming} from 'openai/resources/chat/completions'
import {lumaRequestContext} from './luma-request-context'
import {lumaEvidenceRpc} from './luma-model-evidence'
import {loadPropertyChatbotContext} from './chatbot-context-editor'
export type LumaModelSource={conversationId:string|null;modeRevision:number;assistantContext?:Awaited<ReturnType<typeof loadPropertyChatbotContext>>}
export async function budgetedLumaCompletion(openai:OpenAI,db:ReturnType<typeof createServiceClient>,propertyId:string,params:ChatCompletionCreateParamsNonStreaming,purpose:'answer'|'extraction'|'summary',source:LumaModelSource){
 const context=lumaRequestContext.getStore()
 if(!context||context.propertyId!==propertyId)throw new Error('A recorded visitor request is required before model execution.')
 const fresh=async()=>{if(source.assistantContext!==undefined&&JSON.stringify(await loadPropertyChatbotContext(db,propertyId))!==JSON.stringify(source.assistantContext))throw new Error('Property information changed while preparing the answer. The team can review this request.')}
 await fresh()
 const reserve=Buffer.byteLength(JSON.stringify(params.messages),'utf8')+1024+(params.max_tokens??500)
 const configured=Number(process.env.LUMALEASING_DAILY_TOKEN_ALLOWANCE)
 const limit=Number.isFinite(configured)&&configured>0?Math.floor(configured):1_000_000
 const args={p_property_id:propertyId,p_request_id:context.requestId,p_token:context.token}
 const saved=await lumaEvidenceRpc(db,'claim_luma_model',{...args,p_purpose:purpose,p_params:params,p_source:source,p_units:reserve,p_limit:limit})
 const claim=saved.data as{state?:string;id?:string;response?:ChatCompletion}|null
 if(saved.error||!claim)throw new Error('Could not confirm the saved model request.')
 if(claim.state==='received'&&claim.response){await fresh();return claim.response}
 if(claim.state!=='claimed'||!claim.id)throw new Error(claim.state==='limited'?'The property’s daily AI allowance is reached. Please contact the team directly.':'This model request needs review before it can be repeated.')
 let response:ChatCompletion
 try {response=await openai.chat.completions.create(params)}catch(error){
  const issue=error instanceof Error&&/timeout|timed out/i.test(error.name+' '+error.message)?'provider_timeout':'provider_error'
  await lumaEvidenceRpc(db,'finish_luma_model',{...args,p_id:claim.id,p_outcome:'unknown',p_response:null,p_issue:issue})
  throw new Error('The model response is unconfirmed. This request will not be repeated automatically.')
 }
 const receipt=await lumaEvidenceRpc(db,'finish_luma_model',{...args,p_id:claim.id,p_outcome:'received',p_response:response,p_issue:null})
 const result=receipt.data as{state?:string;usable?:boolean;id?:string}|null
 if(receipt.error||result?.state!=='saved'||result.id!==claim.id)throw new Error('The model response could not be confirmed as saved. Check this request’s history.')
 if(!result.usable)throw new Error('The model response was retained for review because request or conversation authority changed.')
 await fresh()
 if(!Array.isArray(response.choices)||!response.choices[0]?.message)throw new Error('The saved model response has no usable answer.')
 return response
}
