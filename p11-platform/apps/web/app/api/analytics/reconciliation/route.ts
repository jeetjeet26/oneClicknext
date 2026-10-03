import {NextResponse} from 'next/server'
import {dataReviewDecision,dataReviewRead} from '@/utils/analytics/data-review-contracts'
import {dataReviewActor,dataReviewRpc,InventoryError} from '@/utils/analytics/data-review-store'
import {requireTeamOrigin,teamBody,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'The data review could not be confirmed. Check its saved request.'},{status:e instanceof InventoryError?e.status:503,headers})}
export async function GET(req:Request){try{
 const parsed=dataReviewRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose valid review dates and a history page.',400)
 const{propertyId,startDate,endDate,reviewId,commandId,kind,offset,hash}=parsed.data,actorId=await dataReviewActor(propertyId)
 return NextResponse.json({...await dataReviewRpc('read_bi_data_review',{p_actor_id:actorId,p_property_id:propertyId,p_start:startDate??null,p_end:endDate??null,p_review_id:reviewId??null,p_command_id:commandId??null,p_kind:kind,p_offset:offset,p_hash:hash??null}),actorId},{headers})
 }catch(e){return failure(e)}}
export async function POST(req:Request){try{
 requireTeamOrigin(req);const parsed=dataReviewDecision.safeParse(await teamBody(req,12000));if(!parsed.success)throw new InventoryError('Review the exact data and decision fields.',400)
 const{id,propertyId,expectedActorId,...input}=parsed.data,actorId=await dataReviewActor(propertyId);if(actorId!==expectedActorId)throw new InventoryError('Your signed-in account changed. Reload the data review.',409)
 return NextResponse.json(await dataReviewRpc('decide_bi_data_review',{p_id:id,p_actor_id:actorId,p_property_id:propertyId,p_input:input}),{headers})
 }catch(e){return failure(e)}}
