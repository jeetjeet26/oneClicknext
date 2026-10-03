import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError,MarketStoreError} from '@/utils/marketvision/decision-store'
import {BriefExport} from '@/utils/marketvision/brief-contracts'
import {briefRpc,readSavedBrief,type SavedBriefRecord} from '@/utils/marketvision/brief-store'
import {renderBriefExport} from '@/utils/marketvision/brief-export'
export async function POST(req:NextRequest){try{const raw=await req.json().catch(()=>({})),actor=await requireMarketOperator(String(raw.propertyId??'')),parsed=BriefExport.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:'Choose the exact saved brief, download format and reason.'},{status:400})
 const {propertyId,requestId,...input}=parsed.data,detail=await readSavedBrief(propertyId,actor,input.briefId),report=detail.report as unknown as SavedBriefRecord
 if(report.state!=='ready'||report.version!==input.expectedVersion||!report.result)throw new MarketStoreError('Reload the exact completed brief before downloading.',409)
 const content=renderBriefExport(report.result,input.format)
 return NextResponse.json({result:await briefRpc('export_marketvision_brief',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input,p_content:content})},{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
