import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { marketId } from '@/utils/marketvision/decision-contracts'
import { requireMarketOperator, marketError, MarketStoreError } from '@/utils/marketvision/decision-store'
import { enqueueResearch, processResearchJob, researchWorkspace } from '@/utils/marketvision/research-store'
import { createServiceClient } from '@/utils/supabase/admin'
export const maxDuration=300
const reply=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
export async function GET(request:NextRequest){
  try{if(request.nextUrl.searchParams.getAll('propertyId').length!==1)throw new MarketStoreError('Select one community.',400)
    const parsed=z.object({propertyId:marketId}).strict().safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new MarketStoreError('Select a community.',400)
    const actor=await requireMarketOperator(parsed.data.propertyId),data=await researchWorkspace(parsed.data.propertyId)
    if(await requireMarketOperator(parsed.data.propertyId)!==actor)throw new MarketStoreError('Community access changed.',403)
    return reply(data)
  }catch(error){return marketError(error)}
}
export async function POST(request:NextRequest){
  try{const parsed=z.object({propertyId:marketId,action:z.enum(['refresh','stop']),jobId:marketId.optional()}).strict().safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new MarketStoreError('Choose a community research action.',400)
    const {propertyId,action,jobId}=parsed.data,actor=await requireMarketOperator(propertyId)
    if(action==='stop'){
      if(!jobId)throw new MarketStoreError('Select the running research request.',400)
      const {data,error}=await createServiceClient().from('marketvision_research_jobs').update({state:'stopped',lease_token:null,leased_at:null,updated_at:new Date().toISOString()}).eq('id',jobId).eq('property_id',propertyId).in('state',['queued','running']).select('id,state').maybeSingle()
      if(error)throw new MarketStoreError('The stop could not be saved.')
      return reply(data || {state:'already_closed'})
    }
    const job=await enqueueResearch(propertyId,actor,true)
    if(job.state==='queued')after(async()=>{try{await processResearchJob(job.id)}catch{console.error('Market research requires worker recovery',{jobId:job.id})}})
    return reply(job)
  }catch(error){return marketError(error)}
}
