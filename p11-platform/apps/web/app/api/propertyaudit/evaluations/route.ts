import {NextResponse} from 'next/server'
import {evaluationDecision,evaluationRead} from '@/utils/propertyaudit/evaluation-contracts'
import {AUDIT_EVALUATOR_VERSION,evaluateRetainedAudit} from '@/utils/propertyaudit/retained-evaluation'
import {auditActor,auditRpc,InventoryError} from '@/utils/propertyaudit/decision-store'
import {reportRow} from '@/utils/propertyaudit/retained-report'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The evaluation could not be confirmed. Keep this request and check its saved result.'},{status:e instanceof InventoryError?e.status:503,headers})}
async function finish(id:string,actor:string,propertyId:string){
 const saved=await auditRpc('read_geo_evaluations',{p_id:id,p_actor_id:actor,p_property_id:propertyId}), record=reportRow(saved.record)
 if(record.state !== 'prepared') return {state:'saved',status:record.state,id,propertyId}
 if(!saved.canResume)throw new InventoryError('Only the original requester can calculate this saved evaluation.',403)
 if(record.evaluator_version!==AUDIT_EVALUATOR_VERSION)throw new InventoryError('The evaluator version changed. Discard this pending preview and prepare a new evaluation.',409)
 let preview
 try{preview=evaluateRetainedAudit(record.source)}catch(e){throw new InventoryError(e instanceof Error?e.message:'Retained evidence is incomplete.',409)}
 return auditRpc('finish_geo_evaluation',{p_id:id,p_actor_id:actor,p_property_id:propertyId,p_source_hash:record.source_hash,p_preview:preview})
}
export async function GET(req:Request){try{
 const parsed=evaluationRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose a valid evaluation or run.',400)
 const {propertyId,id,runId,offset,hash,commandId}=parsed.data,actorId=await auditActor(propertyId)
 const data=commandId?await auditRpc('read_geo_operator',{p_actor_id:actorId,p_property_id:propertyId,p_input:{kind:'command',id:commandId}}):await auditRpc('read_geo_evaluations',{p_actor_id:actorId,p_property_id:propertyId,p_id:id??null,p_run_id:runId??null,p_offset:offset,p_hash:hash??null})
 return NextResponse.json({...data,actorId},{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=evaluationDecision.safeParse(await teamBody(req));if(!parsed.success)throw new InventoryError('Review the exact evaluation and decision fields.',400)
 const input=parsed.data,actor=await auditActor(input.propertyId);if(actor!==input.expectedActorId)throw new InventoryError('Your account changed. Reload before deciding.',409)
 const args={p_id:input.id,p_actor_id:actor,p_property_id:input.propertyId}
 if(input.operation==='apply'||input.operation==='discard')return NextResponse.json(await auditRpc('decide_geo_evaluation',{...args,p_evaluation_id:input.evaluationId,p_operation:input.operation,p_preview_hash:input.previewHash,p_reason:input.reason}),{headers})
 if(input.operation==='cancel_decision')return NextResponse.json(await auditRpc('decide_geo_operator',{...args,p_input:{operation:'cancel_request'}}),{headers})
 if(input.operation==='cancel')return NextResponse.json(await auditRpc('prepare_geo_evaluation',{...args,p_run_id:null,p_source_hash:null,p_evaluator_version:null,p_cancel:true}),{headers})
 if(input.operation==='prepare'){
  const saved=await auditRpc('prepare_geo_evaluation',{...args,p_run_id:input.runId,p_source_hash:input.sourceHash,p_evaluator_version:AUDIT_EVALUATOR_VERSION})
  if(saved.status==='cancelled')return NextResponse.json(saved,{headers})
 }
 return NextResponse.json(await finish(input.id,actor,input.propertyId),{headers})
 }catch(e){return failure(e)}}
