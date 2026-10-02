import {NextResponse} from 'next/server'
import {widgetRead,widgetDecision} from '@/utils/lumaleasing/widget-operations'
import {widgetActor,widgetRpc,InventoryError} from '@/utils/lumaleasing/widget-operation-store'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The widget request could not be confirmed. Check its saved history.'},{status:e instanceof InventoryError?e.status:503,headers})}
export async function GET(req:Request){try{
 const parsed=widgetRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose a valid property and history page.',400)
 const{propertyId,commandId,offset,hash}=parsed.data,actorId=await widgetActor(propertyId)
 return NextResponse.json({...await widgetRpc('read_luma_widget_operations',{p_actor_id:actorId,p_property_id:propertyId,p_command_id:commandId??null,p_offset:offset,p_hash:hash??null}),actorId},{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=widgetDecision.safeParse(await teamBody(req,10000));if(!parsed.success)throw new InventoryError('Review the exact widget decision fields.',400)
 const{id,propertyId,expectedActorId,...input}=parsed.data,actorId=await widgetActor(propertyId);if(actorId!==expectedActorId)throw new InventoryError('Your signed-in account changed. Reload before continuing.',409)
 const origin=new URL(req.url).protocol+'//'+(req.headers.get('host')||new URL(req.url).host)
 return NextResponse.json(await widgetRpc('decide_luma_widget_operation',{p_id:id,p_actor_id:actorId,p_property_id:propertyId,p_input:input.operation==='prepare'?{...input,origin}:input}),{headers})
 }catch(e){return failure(e)}}
