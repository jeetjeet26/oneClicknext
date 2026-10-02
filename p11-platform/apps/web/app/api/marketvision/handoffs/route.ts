import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {HandoffRead,HandoffPrepare,HandoffDecision} from '@/utils/marketvision/handoff-contracts'
import {handoffRpc} from '@/utils/marketvision/handoff-store'
const headers={'Cache-Control':'private, no-store'}
export async function GET(req:NextRequest){try{
 const query=Object.fromEntries(req.nextUrl.searchParams),actor=await requireMarketOperator(query.propertyId??''),parsed=HandoffRead.safeParse(query)
 if(!parsed.success||[...req.nextUrl.searchParams.keys()].length!==Object.keys(query).length)return NextResponse.json({error:'Select a saved handoff in this property.'},{status:400})
 const q=parsed.data
 return NextResponse.json(await handoffRpc('read_marketvision_handoffs',{p_property_id:q.propertyId,p_actor_id:actor,p_brief_id:q.briefId??null,p_handoff_id:q.handoffId??null,p_cursor:q.cursor??null}),{headers})
}catch(e){return marketError(e)}}
async function decide(req:NextRequest,prepare:boolean){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=(prepare?HandoffPrepare:HandoffDecision).safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Review the saved report, recommendation, exact draft and decision reason.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 return NextResponse.json({result:await handoffRpc(prepare?'prepare_marketvision_handoff':'decide_marketvision_handoff',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})},{headers})
}catch(e){return marketError(e)}}
export const POST=(req:NextRequest)=>decide(req,true)
export const PUT=(req:NextRequest)=>decide(req,false)
