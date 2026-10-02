import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineHeaders, getDataEngineUrl } from '@/utils/services/runtime-config'
import { brandHeaders, brandId, brandReply, brandRpc } from '@/utils/brandforge/operations'
import { buildResearchAnalysis, type ResearchProvider } from '@/utils/brandforge/research'
const requestSchema = z.object({propertyId:brandId,requestId:brandId,mode:z.enum(['saved','refresh']).default('refresh'),radiusMiles:z.number().min(0.5).max(25).default(3),maxCompetitors:z.number().int().min(1).max(30).default(10)}).strict()
async function actor(propertyId:string) {
 const client=await createClient();const {data:{user},error}=await client.auth.getUser()
 if(error||!user)return {error:NextResponse.json({error:'Unauthorized'},{status:401,headers:brandHeaders})}
 if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return {error:NextResponse.json({error:'Forbidden'},{status:403,headers:brandHeaders})}
 return {user}
}
export async function POST(request:NextRequest) {
 let claim:{id:string;token:string}|null=null
 const provider:ResearchProvider={discovery:'not_requested',intelligence:'not_requested'}
 try {
  const auth=await createClient();const {data:{user},error}=await auth.auth.getUser()
  if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401,headers:brandHeaders})
  const parsed=requestSchema.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'A valid property, request and research settings are required.'},{status:400,headers:brandHeaders})
  const {propertyId,requestId,...options}=parsed.data
  if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403,headers:brandHeaders})
  const started=await brandRpc('begin_brand_research',{p_property_id:propertyId,p_actor_id:user.id,p_request_id:requestId,p_input:options})
  if(started.state!=='claimed')return brandReply(started)
  claim={id:requestId,token:String(started.claimToken)}
  const assertActive=async()=>{const result=await brandRpc('check_brand_research',{p_request_id:requestId,p_claim_token:claim!.token});if(result.state!=='active')throw new Error('Research is no longer active')}
  const headers=getDataEngineHeaders(),base=getDataEngineUrl()
  if(options.mode==='refresh'){
   if(!headers['X-API-Key'])provider.discovery='unavailable'
   else {
    await assertActive()
    try {
     const response=await fetch(`${base}/scraper/discover`,{method:'POST',headers:{...headers,'X-Correlation-ID':requestId},body:JSON.stringify({property_id:propertyId,radius_miles:options.radiusMiles,max_competitors:options.maxCompetitors,auto_add:true}),redirect:'error',signal:AbortSignal.timeout(60000)})
     const result=await response.json().catch(()=>null)
     provider.discovery=response.ok&&result?.success===true?'completed':[400,401,403,404,422].includes(response.status)?'unavailable':'unknown'
    }catch{provider.discovery='unknown'}
   }
  }
  await assertActive()
  const {data:competitors,error:readError}=await createServiceClient().from('competitors').select('id,name,address,website_url,phone,property_type,units_count,year_built,amenities,photos,last_scraped_at,brand_intel:competitor_brand_intelligence(brand_voice,brand_personality,positioning_statement,target_audience,unique_selling_points,highlighted_amenities,active_specials,lifestyle_focus,last_analyzed_at,analysis_version,confidence_score,pages_analyzed)').eq('property_id',propertyId).eq('is_active',true).order('name').limit(options.maxCompetitors)
  if(readError)throw new Error('Competitor evidence could not be loaded')
  const preliminary=buildResearchAnalysis(competitors||[],{...options,requestId,provider})
  if(options.mode==='refresh'&&provider.discovery==='completed'){
   const missing=preliminary.competitors.filter(c=>c.evidenceStatus!=='current').map(c=>c.id)
   if(missing.length){
    await assertActive()
    try {
     const response=await fetch(`${base}/scraper/brand-intelligence/batch`,{method:'POST',headers:{...headers,'X-Correlation-ID':requestId},body:JSON.stringify({property_id:propertyId,competitor_ids:missing}),redirect:'error',signal:AbortSignal.timeout(20000)})
     const result=await response.json().catch(()=>null),job=z.string().uuid().safeParse(result?.data?.job_id)
     if(response.ok&&result?.success===true&&job.success){provider.intelligence='queued';provider.jobId=job.data}
     else provider.intelligence=[400,401,403,404,422].includes(response.status)?'unavailable':'unknown'
    }catch{provider.intelligence='unknown'}
   }
  }
  const analysis=buildResearchAnalysis(competitors||[],{...options,requestId,provider})
  return brandReply(await brandRpc('finish_brand_research',{p_request_id:claim.id,p_claim_token:claim.token,p_result:analysis}))
 }catch{
  if(claim)try{
   const result=await brandRpc('finish_brand_research',{p_request_id:claim.id,p_claim_token:claim.token,p_result:{provider},p_error:'research_failed'})
   if(result.state==='replayed'||result.state==='cancelled')return brandReply(result)
   if(result.state==='failed')return NextResponse.json({state:'failed',error:'Research could not be prepared. Reload its saved status before making a new request.'},{status:503,headers:brandHeaders})
  }catch{/* Preserve an unconfirmed request for explicit stop/recovery. */}
  return NextResponse.json({error:'Research could not be confirmed. Reload the saved request before retrying.'},{status:503,headers:brandHeaders})
 }
}
export async function GET(request:NextRequest){
 try{
  const property=brandId.safeParse(request.nextUrl.searchParams.get('propertyId'))
  if(!property.success)return NextResponse.json({error:'Valid property required'},{status:400,headers:brandHeaders})
  const access=await actor(property.data);if(access.error)return access.error
  const client=createServiceClient()
  const {data,error}=await client.from('brand_research_runs').select('id,state,input,result,started_at,finished_at').eq('property_id',property.data).order('started_at',{ascending:false}).limit(20)
  if(error)throw error
  return NextResponse.json({runs:data},{headers:brandHeaders})
 }catch{return NextResponse.json({error:'Saved research could not be loaded.'},{status:503,headers:brandHeaders})}
}
export async function DELETE(request:NextRequest){
 try{
  const parsed=z.object({propertyId:brandId,requestId:brandId,decisionId:brandId}).strict().safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Valid research decision required'},{status:400,headers:brandHeaders})
  const access=await actor(parsed.data.propertyId);if(access.error)return access.error
  const result=await brandRpc('cancel_brand_research',{p_property_id:parsed.data.propertyId,p_request_id:parsed.data.requestId,p_actor_id:access.user!.id,p_decision_id:parsed.data.decisionId})
  if(result.state==='cancelled')return NextResponse.json(result,{headers:brandHeaders})
  return brandReply(result)
 }catch{return NextResponse.json({error:'The research request could not be stopped. Reload its saved status.'},{status:503,headers:brandHeaders})}
}
