import {readMarketingFacts,MarketingReadError} from '@/utils/analytics/read-marketing-facts'
import {reportingRows} from '@/utils/analytics/report-quality'
import {buildBiReport,trendForCampaign} from '@/utils/analytics/report-data'
import {campaignIdentity} from '@/utils/analytics/marketing-fact'
import {createClient} from '@/utils/supabase/server'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {NextRequest,NextResponse} from 'next/server'
import {getMarketingChannelFilterValues} from '@/utils/analytics/channel-identity'
const headers={'Cache-Control':'private, no-store'}
export async function GET(request:NextRequest){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser()
 if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const p=new URL(request.url).searchParams,propertyId=p.get('propertyId'),startDate=p.get('startDate'),endDate=p.get('endDate'),campaignId=p.get('campaignId'),sourceAccountId=p.get('sourceAccountId'),channel=p.get('channel')
 if(!propertyId)return NextResponse.json({error:'propertyId is required'},{status:400,headers})
 if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403,headers})
 try{
  const raw=await readMarketingFacts(db,{propertyId,startDate,endDate,campaignId:campaignId??undefined,sourceAccountId,channels:channel?getMarketingChannelFilterValues([channel]):undefined}),rows=reportingRows(raw)
  const days=raw.map(r=>r.date).sort(),today=new Date().toISOString().slice(0,10)
  const source={version:'bi-v1' as const,propertyId,propertyName:'Selected community',filters:{startDate:startDate??days[0]??today,endDate:endDate??days.at(-1)??today,compare:false,channel:null,account:null},currentRows:rows,previousRows:[],previousPeriod:null}
  const report=buildBiReport(source),coverage={...report.coverage,excludedIncompleteRows:raw.length-rows.length,providerReportComplete:false}
  if(campaignId){const identities=new Set(raw.map(row=>campaignIdentity(row.channel_id,row.source_account_id,row.campaign_id)));if(identities.size>1)return NextResponse.json({error:'Choose the campaign account and channel to view its daily trend'},{status:409,headers});return NextResponse.json({trends:identities.size?trendForCampaign(source,[...identities][0]):[],coverage},{headers})}
  return NextResponse.json({campaigns:report.campaigns,totals:rows.length?report.totals:null,coverage},{headers})
 }catch(error){return NextResponse.json({error:error instanceof MarketingReadError?error.message:'Campaign data could not be confirmed.'},{status:error instanceof MarketingReadError?error.status:503,headers})}
}
