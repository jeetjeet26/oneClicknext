import {createServiceClient} from '@/utils/supabase/admin'
import {parseCompetitorIntakeText} from '@/utils/services/competitor-intake-parser'
import {IntakeDetail,IntakeHistory} from './intake-contracts'
import {MarketStoreError} from './decision-store'
/** Keep exact paragraph evidence; parsing is a suggestion, never a verified fact. */
export function buildIntakePreview(rawText:string){
 const blocks=rawText.replace(/\r\n/g,'\n').trim().split(/\n\s*\n+/).filter(s=>s.trim())
 if(blocks.length<1||blocks.length>50)throw new MarketStoreError('Use one to 50 competitors, separated by blank lines. Split larger notes into separate saved previews.',400)
 return blocks.map(sourceText=>{const seed=parseCompetitorIntakeText(sourceText)[0];return{name:seed?.seedName??'',location:seed?.seedLocation??null,url:seed?.seedUrl??null,sourceText,claims:JSON.parse(JSON.stringify(seed?.seedClaims??{}))as Record<string,string>}})
}
export async function intakeRpc(name:string,args:Record<string,unknown>){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new MarketStoreError('The intake decision could not be confirmed. Retry the same values or reload saved intake.')
 const messages:Record<string,string>={forbidden:'This property is unavailable.',not_found:'This saved intake is unavailable in the selected property.',request_conflict:'This request differs from the saved decision. Open its original history.',stale_intake:'This preview has changed. Reload the original saved intake.',intake_finished:'This intake already has a final decision. Reload its saved result.',duplicate_competitor:'A competitor with this name already exists, including archived records. Skip it or review a distinct name; existing records will not be overwritten.',duplicate_selection:'Two selected candidates have the same name. Correct or skip the duplicate.',cursor_changed:'Reload intake history before loading more.'}
 if(!['ready','preview_ready','applied','stopped','saved','replayed'].includes(String(data.state)))throw new MarketStoreError(messages[String(data.state)]??'Review the saved intake before continuing.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 return data
}
export async function readIntake(propertyId:string,actorId:string,requestId?:string,cursor?:string,legacy=false){
 const data=await intakeRpc('read_marketvision_intakes',{p_property_id:propertyId,p_actor_id:actorId,p_request_id:requestId??null,p_cursor:cursor??null,p_legacy:legacy})
 if(legacy&&requestId){if(!data.legacy||typeof data.legacy!=='object')throw new MarketStoreError('Historical intake could not be loaded.');return data}
 const parsed=(requestId?IntakeDetail:IntakeHistory).safeParse(data)
 if(!parsed.success)throw new MarketStoreError('The complete saved intake could not be read. Reload its history.')
 return parsed.data
}
