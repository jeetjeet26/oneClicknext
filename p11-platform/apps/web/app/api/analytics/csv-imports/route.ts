import {NextResponse} from 'next/server'
import {csvRead,csvDecision} from '@/utils/analytics/import-contracts'
import {buildImportPreview} from '@/utils/analytics/import-parser'
import {csvActor,csvRpc,InventoryError} from '@/utils/analytics/import-store'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The saved import could not be confirmed. Check its history.'},{status:e instanceof InventoryError?e.status:503,headers})}
export async function GET(req:Request){try{
 const parsed=csvRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose a valid saved import and history page.',400)
 const{propertyId,id,commandId,kind,offset,hash}=parsed.data,actorId=await csvActor(propertyId)
 return NextResponse.json({...await csvRpc('read_bi_csv',{p_actor_id:actorId,p_property_id:propertyId,p_id:id??null,p_command_id:commandId??null,p_kind:kind,p_offset:offset,p_hash:hash??null}),actorId},{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=csvDecision.safeParse(await teamBody(req,12*1024*1024));if(!parsed.success)throw new InventoryError('Review the CSV source, account and exact decision fields.',400)
 const input=parsed.data,actor=await csvActor(input.propertyId);if(actor!==input.expectedActorId)throw new InventoryError('Your signed-in account changed. Reload the import workspace.',409)
 const args={p_id:input.id,p_actor_id:actor,p_property_id:input.propertyId}
 if(input.operation==='prepare'){
  let preview;try{preview=buildImportPreview(input.original)}catch(e){throw new InventoryError(e instanceof Error?e.message:'The CSV could not be parsed.',400)}
  return NextResponse.json(await csvRpc('prepare_bi_csv',{...args,p_original:input.original,p_preview:preview,p_parent_id:input.parentId??null}),{headers})
 }
 if(input.operation==='cancel_preview')return NextResponse.json(await csvRpc('prepare_bi_csv',{...args,p_original:null,p_preview:null,p_cancel:true}),{headers})
 if(input.operation==='cancel_decision')return NextResponse.json(await csvRpc('decide_bi_csv',{...args,p_import_id:null,p_input:{operation:'cancel'}}),{headers})
 if(input.operation==='apply'||input.operation==='discard')return NextResponse.json(await csvRpc('decide_bi_csv',{...args,p_import_id:input.importId,p_input:{operation:input.operation,previewHash:input.previewHash,targetHash:input.targetHash,reason:input.reason}}),{headers})
 throw new InventoryError('Review the import operation.',400)
 }catch(e){return failure(e)}}
