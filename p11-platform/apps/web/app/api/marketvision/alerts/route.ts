import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {AlertRead,AlertCreate,AlertReview} from '@/utils/marketvision/alert-contracts'
import {alertRpc,readMarketAlerts} from '@/utils/marketvision/alert-store'
const reply=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:NextRequest){try{
 const raw=Object.fromEntries(req.nextUrl.searchParams),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=AlertRead.safeParse(raw)
 if(!parsed.success||[...req.nextUrl.searchParams.keys()].length!==Object.keys(raw).length)return NextResponse.json({error:'Choose a valid alert view and history cursor.'},{status:400})
 const q=parsed.data;return reply(await readMarketAlerts({p_property_id:q.propertyId,p_actor_id:actor,p_view:q.view,p_cursor:q.cursor??null,p_limit:q.limit}))
}catch(e){return marketError(e)}}
async function change(req:NextRequest,create:boolean){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw?.propertyId??'')),parsed=(create?AlertCreate:AlertReview).safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Review the exact alert selection and give a reason. Property-wide hidden selections are not supported.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 return reply({result:await alertRpc(create?'create_marketvision_alert':'review_marketvision_alerts',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})})
}catch(e){return marketError(e)}}
export const POST=(req:NextRequest)=>change(req,true)
export const PUT=(req:NextRequest)=>change(req,false)
