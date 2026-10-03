import {after,NextRequest,NextResponse} from 'next/server'
import {BrandRead,BrandRequest,BrandControl,BrandReview} from '@/utils/marketvision/brand-evidence-contracts'
import {requireMarketOperator,marketError,MarketStoreError} from '@/utils/marketvision/decision-store'
import {requestBrandEvidence,brandRpc,brandExecutionStatus,recoverBrandEvidence} from '@/utils/marketvision/brand-evidence-store'
export const maxDuration=120
const reply=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}})
function later(id:string){after(async()=>{try{await recoverBrandEvidence(id)}catch{console.error('Saved MarketVision brand request needs recovery',{requestId:id})}})}
export async function GET(req:NextRequest){try{
 const parsed=BrandRead.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!parsed.success)throw new MarketStoreError('Choose a property and saved brand view.',400)
 const {propertyId,competitorId,requestId,cursor,view}=parsed.data,actor=await requireMarketOperator(propertyId)
 const data=await brandRpc('read_marketvision_brand',{p_property_id:propertyId,p_actor_id:actor,p_view:view,p_competitor_id:competitorId??null,p_request_id:requestId??null,p_cursor:cursor??null})
 return reply({...data,execution:brandExecutionStatus()})
}catch(e){return marketError(e)}}
export async function POST(req:NextRequest){try{
 const parsed=BrandRequest.safeParse(await req.json().catch(()=>null));if(!parsed.success)throw new MarketStoreError('Review the exact retained page, confirm its scope and give a reason.',400)
 const actor=await requireMarketOperator(parsed.data.propertyId),result=await requestBrandEvidence(parsed.data,actor)
 if(result.state==='queued'&&result.requestId===parsed.data.requestId)later(parsed.data.requestId)
 return reply({result,execution:brandExecutionStatus()})
}catch(e){return marketError(e)}}
export async function PUT(req:NextRequest){try{
 const parsed=BrandControl.safeParse(await req.json().catch(()=>null));if(!parsed.success)throw new MarketStoreError('Review the saved request, version and reason.',400)
 const {requestId,propertyId,...input}=parsed.data,actor=await requireMarketOperator(propertyId),result=await brandRpc('control_marketvision_brand',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})
 if(input.action==='recover'){if(result.requestState==='result_ready')await recoverBrandEvidence(input.brandRequestId);else later(input.brandRequestId)}
 return reply({result,execution:brandExecutionStatus()})
}catch(e){return marketError(e)}}
export async function PATCH(req:NextRequest){try{
 const parsed=BrandReview.safeParse(await req.json().catch(()=>null));if(!parsed.success)throw new MarketStoreError('Review every statement, source limits, replacement and reason.',400)
 const {requestId,propertyId,...input}=parsed.data,actor=await requireMarketOperator(propertyId)
 return reply({result:await brandRpc('review_marketvision_brand',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})})
}catch(e){return marketError(e)}}
