import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {BriefRead,BriefRequest,BriefRecovery} from '@/utils/marketvision/brief-contracts'
import {briefRpc,readSavedBrief,completeSavedBrief} from '@/utils/marketvision/brief-store'
const reply=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
export async function GET(req:NextRequest){try{
 const raw=Object.fromEntries(req.nextUrl.searchParams),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=BriefRead.safeParse(raw)
 if(!parsed.success||[...req.nextUrl.searchParams.keys()].length!==Object.keys(raw).length)return NextResponse.json({error:'Choose a saved report and valid history cursor.'},{status:400})
 const q=parsed.data,result=q.view==='legacy'?await briefRpc('read_marketvision_legacy_briefs',{p_property_id:q.propertyId,p_actor_id:actor,p_request_id:q.requestId??null,p_cursor:q.cursor??null}):await readSavedBrief(q.propertyId,actor,q.requestId,q.cursor)
 // The source remains in the private report/context records. Public report evidence excludes raw inputs.
 if(result.report){const {source_snapshot:sourceSnapshot,...safe}=result.report as Record<string,unknown>;void sourceSnapshot;result.report=safe}
 return reply(result)
}catch(e){return marketError(e)}}
export async function POST(req:NextRequest){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=BriefRequest.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Choose a window and reason for this saved report.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 await briefRpc('begin_marketvision_brief',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})
 return reply({result:await completeSavedBrief(propertyId,actor,requestId)})
}catch(e){return marketError(e)}}
export async function PUT(req:NextRequest){try{
 const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=BriefRecovery.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Review the saved report and recovery reason.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data
 await briefRpc('recover_marketvision_brief',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})
 return reply({result:await completeSavedBrief(propertyId,actor,input.briefId)})
}catch(e){return marketError(e)}}
