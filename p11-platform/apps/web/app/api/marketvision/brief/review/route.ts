import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {BriefReview} from '@/utils/marketvision/brief-contracts'
import {briefRpc} from '@/utils/marketvision/brief-store'
export async function POST(req:NextRequest){try{const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=BriefReview.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Review the exact recommendation, current decision and reason.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 return NextResponse.json({result:await briefRpc('review_marketvision_brief',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})},{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
