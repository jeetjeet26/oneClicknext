import {NextResponse} from 'next/server'
import {conversationRead,conversationDecision} from '@/utils/lumaleasing/conversation-work'
import {conversationActor,conversationRpc,InventoryError} from '@/utils/lumaleasing/conversation-store'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The conversation result could not be confirmed. Check its saved history.'},{status:e instanceof InventoryError?e.status:503,headers})}
export async function GET(req:Request){try{
 const parsed=conversationRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose a valid property and conversation page.',400)
 const{propertyId,conversationId,kind,commandId,offset,hash,archived,leadId}=parsed.data,actorId=await conversationActor(propertyId)
 return NextResponse.json(await conversationRpc('read_luma_conversations',{p_actor_id:actorId,p_property_id:propertyId,p_conversation_id:conversationId??null,p_kind:kind,p_command_id:commandId??null,p_offset:offset,p_hash:hash??null,p_archived:archived==='true',p_lead_id:leadId??null}),{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=conversationDecision.safeParse(await teamBody(req,50000));if(!parsed.success)throw new InventoryError('Review the exact conversation decision fields.',400)
 const{id,propertyId,expectedActorId,...input}=parsed.data,actorId=await conversationActor(propertyId);if(actorId!==expectedActorId)throw new InventoryError('Your signed-in account changed. Reload before continuing.',409)
 return NextResponse.json(await conversationRpc('decide_luma_conversation',{p_id:id,p_actor_id:actorId,p_property_id:propertyId,p_input:input}),{headers})
 }catch(e){return failure(e)}}
