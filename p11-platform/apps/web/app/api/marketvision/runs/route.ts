import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {MonitoringQuery} from '@/utils/marketvision/monitoring-contract'
import {readMarketMonitoring} from '@/utils/marketvision/monitoring-store'
import {sourceExecutionStatus} from '@/utils/marketvision/source-store'
import {extractionExecutionStatus} from '@/utils/marketvision/extraction-store'
export async function GET(req:NextRequest){try{
 const query=Object.fromEntries(req.nextUrl.searchParams),actorId=await requireMarketOperator(query.propertyId??''),parsed=MonitoringQuery.safeParse(query)
 if(!parsed.success||[...req.nextUrl.searchParams.keys()].length!==Object.keys(query).length)return NextResponse.json({error:'Choose a saved-work filter and property.'},{status:400})
 const data=await readMarketMonitoring({...parsed.data,actorId}),source=sourceExecutionStatus(),extraction=extractionExecutionStatus()
 return NextResponse.json({...data,runtime:{sourcePaused:source.paused,extractionPaused:extraction.paused,extractionConfigured:extraction.configured,automaticMonitoring:false}},{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
