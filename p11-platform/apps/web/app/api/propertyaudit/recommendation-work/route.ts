import {createHash} from 'node:crypto'
import {NextResponse} from 'next/server'
import {recommendationDecision,recommendationRead} from '@/utils/propertyaudit/recommendation-contracts'
import {auditActor,auditRpc,InventoryError} from '@/utils/propertyaudit/decision-store'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function configuration(){
 const provider=process.env.SITEAUDIT_ANALYST_PROVIDER||'openai'
 if(!['openai','anthropic'].includes(provider))throw new InventoryError('Recommendation provider configuration needs administrator review.',503)
 const model=provider==='openai'?(process.env.SITEAUDIT_ANALYST_OPENAI_MODEL||process.env.GEO_OPENAI_MODEL||'gpt-4o'):(process.env.SITEAUDIT_ANALYST_CLAUDE_MODEL||process.env.GEO_CLAUDE_MODEL||'claude-sonnet-5')
 const modelPlan={provider,model},modelHash=createHash('sha256').update(JSON.stringify(modelPlan)).digest('hex')
 return{modelPlan,modelHash,workerEnabled:process.env.SITEAUDIT_ANALYST_ENABLED?.toLowerCase()!=='false'}
}
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The recommendation request could not be confirmed. Check its saved result.'},{status:e instanceof InventoryError?e.status:503,headers})}
export async function GET(req:Request){try{
 const parsed=recommendationRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose valid saved recommendation evidence.',400)
 const{propertyId,id,batchId,crawlId,kind,offset,hash,commandId}=parsed.data,actorId=await auditActor(propertyId)
 const data=commandId?await auditRpc('read_geo_operator',{p_actor_id:actorId,p_property_id:propertyId,p_input:{kind:'command',id:commandId}}):await auditRpc('read_geo_analyses',{p_actor_id:actorId,p_property_id:propertyId,p_id:id??null,p_batch_id:batchId??null,p_crawl_id:crawlId??null,p_kind:kind,p_offset:offset,p_hash:hash??null})
 return NextResponse.json({...data,actorId,...configuration()},{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=recommendationDecision.safeParse(await teamBody(req));if(!parsed.success)throw new InventoryError('Review the exact source and recommendation decision fields.',400)
 const input=parsed.data,actor=await auditActor(input.propertyId);if(actor!==input.expectedActorId)throw new InventoryError('Your account changed. Reload before deciding.',409)
 const args={p_id:input.id,p_actor_id:actor,p_property_id:input.propertyId}
 if(input.operation==='cancel_decision')return NextResponse.json(await auditRpc('decide_geo_operator',{...args,p_input:{operation:'cancel_request'}}),{headers})
 if(input.operation==='cancel')return NextResponse.json(await auditRpc('prepare_geo_analysis',{...args,p_batch_id:null,p_crawl_id:null,p_source_hash:null,p_plan:null,p_parent_id:null,p_cancel:true}),{headers})
 if(input.operation==='prepare'){
  const configured=configuration();if(configured.modelHash!==input.modelHash)throw new InventoryError('The configured model changed. Refresh the source before requesting recommendations.',409)
  return NextResponse.json(await auditRpc('prepare_geo_analysis',{...args,p_batch_id:input.batchId,p_crawl_id:input.crawlId,p_source_hash:input.sourceHash,p_plan:configured.modelPlan,p_parent_id:input.parentId??null}),{headers})
 }
 if(input.operation==='apply'||input.operation==='discard'||input.operation==='stop'||input.operation==='resume')return NextResponse.json(await auditRpc('decide_geo_analysis',{...args,p_analysis_id:input.analysisId,p_operation:input.operation,p_preview_hash:input.previewHash,p_reason:input.reason}),{headers})
 throw new InventoryError('Review the recommendation operation.',400)
 }catch(e){return failure(e)}}
