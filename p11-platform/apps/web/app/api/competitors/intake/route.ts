import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {IntakeRead,IntakeRequest,IntakeDecision} from '@/utils/marketvision/intake-contracts'
import {buildIntakePreview,intakeRpc,readIntake} from '@/utils/marketvision/intake-store'
const reply=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:NextRequest){try{
 const raw=Object.fromEntries(req.nextUrl.searchParams),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=IntakeRead.safeParse(raw)
 if(!parsed.success||[...req.nextUrl.searchParams.keys()].length!==Object.keys(raw).length)return NextResponse.json({error:'Choose a valid saved intake and history cursor.'},{status:400})
 const q=parsed.data;return reply(await readIntake(q.propertyId,actor,q.requestId,q.cursor,q.view==='legacy'))
}catch(e){return marketError(e)}}
export async function POST(req:NextRequest){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw?.propertyId??'')),parsed=IntakeRequest.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Provide the complete notes, a reason and a saved request identity.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 return reply({result:await intakeRpc('begin_marketvision_intake',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input,p_preview:buildIntakePreview(input.rawText)})})
}catch(e){return marketError(e)}}
export async function PUT(req:NextRequest){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw?.propertyId??'')),parsed=IntakeDecision.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Review every selected name and source address, acknowledge unverified claims and give a reason.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 return reply({result:await intakeRpc('decide_marketvision_intake',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})})
}catch(e){return marketError(e)}}
