import { createHash } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'
import { communityModel, type CommunityModel } from '@/utils/community-model'
import { MarketStoreError } from './decision-store'
import { fetchResearchDocument, publicResearchUrl, scopedResearchLinks, type ResearchDocument } from './research-source'
import { extractResearchProfile, synthesizeResearch } from './research-model'
import { compareResearchProfiles, researchChanges } from './research-analysis'
import type { ResearchProfile, ResearchResult, ResearchTarget } from './research-contracts'
import { discoverResearchSources } from './research-discovery'
import { renderResearchDocument } from './research-renderer'
import { hasLegacyResearchCitationFailure } from './research-contracts'

interface ResearchContext {model:CommunityModel;targets:ResearchTarget[]}
type Job = {id:string;property_id:string;context_hash:string;context:ResearchContext;state:string;lease_token:string|null;result:Partial<ResearchResult>;error_message:string|null;created_at:string;updated_at:string}
const asJson=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Json
export const researchHash=(context:ResearchContext)=>createHash('sha256').update(JSON.stringify(context)).digest('hex')

export async function loadResearchContext(propertyId:string):Promise<ResearchContext>{
  const db=createServiceClient()
  const [property,competitors]=await Promise.all([
    db.from('properties').select('id,name,property_type,website_url,settings').eq('id',propertyId).single(),
    db.from('competitors').select('id,name,website_url,property_type,ils_listings').eq('property_id',propertyId).eq('is_active',true).order('id'),
  ])
  if(property.error || !property.data || competitors.error)throw new MarketStoreError('The current community research scope could not be loaded.')
  const p=property.data,settings=p.settings as Record<string,unknown>|null,onboarding=settings?.onboarding as {sources?:Array<{reference?:string;kind?:string}>}|undefined
  const subjectSources=(onboarding?.sources || []).flatMap(source=>source.reference && publicResearchUrl(source.reference)?[{url:source.reference,kind:(new URL(source.reference).hostname===new URL(p.website_url || source.reference).hostname?'official':/\.gov\//i.test(source.reference)?'planning':'reference') as ResearchDocument['kind']}]:[])
  const targets:ResearchTarget[]=[]
  if(p.website_url && publicResearchUrl(p.website_url))targets.push({entityKey:'subject',competitorId:null,name:p.name,website:p.website_url,propertyType:p.property_type,additionalSources:subjectSources})
  for(const competitor of competitors.data || []){
    if(!competitor.website_url || !publicResearchUrl(competitor.website_url))continue
    const listings=competitor.ils_listings as Record<string,unknown>|null
    targets.push({entityKey:competitor.id,competitorId:competitor.id,name:competitor.name,website:competitor.website_url,propertyType:competitor.property_type,additionalSources:Object.values(listings || {}).flatMap(value=>typeof value==='string' && publicResearchUrl(value)?[{url:value,kind:'listing' as const}]:[])})
  }
  return {model:communityModel(p),targets}
}
export async function enqueueResearch(propertyId:string,actorId:string|null,force=false){
  const context=await loadResearchContext(propertyId)
  if(!context.targets.some(t=>t.entityKey==='subject'))throw new MarketStoreError('Add the community website before collecting market research.',409)
  const db=createServiceClient(),hash=researchHash(context)
  const active=await db.from('marketvision_research_jobs').select('id,state,context_hash').eq('property_id',propertyId).in('state',['queued','running']).maybeSingle()
  if(active.error)throw new MarketStoreError('Saved research status could not be read.')
  if(active.data && active.data.context_hash===hash)return {id:active.data.id,state:active.data.state}
  if(active.data){
    const stopped=await db.from('marketvision_research_jobs').update({state:'stopped',lease_token:null,leased_at:null,updated_at:new Date().toISOString(),error_message:'Community classification or competitor scope changed; replaced by current research.'}).eq('id',active.data.id).eq('context_hash',active.data.context_hash).in('state',['queued','running'])
    if(stopped.error)throw new MarketStoreError('Stale research could not be stopped before starting the current scope.')
  }
  if(!force){const recent=await db.from('marketvision_research_jobs').select('id,state').eq('property_id',propertyId).eq('context_hash',hash).in('state',['completed','partial']).gte('created_at',new Date(Date.now()-86400000).toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();if(recent.error)throw new MarketStoreError('Saved research history could not be read.');if(recent.data)return recent.data}
  const {data,error}=await db.from('marketvision_research_jobs').insert({property_id:propertyId,actor_id:actorId,context_hash:hash,context:asJson(context)}).select('id,state').single()
  if(error?.code==='23505'){const replay=await db.from('marketvision_research_jobs').select('id,state').eq('property_id',propertyId).in('state',['queued','running']).single();if(!replay.error)return replay.data}
  if(error || !data)throw new MarketStoreError('The research request could not be saved.')
  return data
}
function documentFromRow(row:{id:string;entity_key:string;source_url:string;title:string;fetched_at:string;source_kind:string;status:string;content_text:string;content_hash:string;metadata:Json}):ResearchDocument{
  return {id:row.id,entityKey:row.entity_key,url:row.source_url,title:row.title,fetchedAt:row.fetched_at,kind:row.source_kind as ResearchDocument['kind'],status:row.status as ResearchDocument['status'],text:row.content_text,contentHash:row.content_hash,metadata:row.metadata as unknown as ResearchDocument['metadata']}
}
export async function readResearchDocuments(jobId:string,propertyId:string){
  const {data,error}=await createServiceClient().from('marketvision_research_documents').select('*').eq('job_id',jobId).eq('property_id',propertyId).order('fetched_at').limit(600)
  if(error)throw new MarketStoreError('Research source evidence could not be loaded.')
  return (data || []).map(documentFromRow)
}
async function saveDocument(job:Job,target:ResearchTarget,document:ResearchDocument){
  const {error}=await createServiceClient().from('marketvision_research_documents').insert({id:document.id,job_id:job.id,property_id:job.property_id,competitor_id:target.competitorId,entity_key:target.entityKey,source_url:document.url,source_kind:document.kind,status:document.status,title:document.title,content_text:document.text,content_hash:document.contentHash,metadata:asJson(document.metadata),fetched_at:document.fetchedAt})
  if(error)throw new Error('Research source retention failed')
}
async function finishStep(job:Job,state:string,result:Partial<ResearchResult>,errorMessage:string|null=null){
  const {data,error}=await createServiceClient().from('marketvision_research_jobs').update({state,result:asJson(result),error_message:errorMessage,lease_token:null,leased_at:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('state','running').eq('lease_token',job.lease_token!).select('id').maybeSingle()
  if(error || !data)throw new Error('Research step lost its lease or was stopped')
}
/** One entity per lease keeps requests bounded. Sources and finished profiles survive a worker restart. */
export async function processResearchJob(id?:string){
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return {state:'paused'}
  if(!process.env.OPENAI_API_KEY)return {state:'provider_unavailable'}
  const db=createServiceClient(),claim=await db.rpc('claim_marketvision_research',id?{p_id:id}:{})
  if(claim.error)throw new Error('Research job could not be claimed')
  if(!claim.data)return {state:'idle'}
  const job=claim.data as unknown as Job
  try{
    const current=await loadResearchContext(job.property_id)
    if(researchHash(current)!==job.context_hash){await finishStep(job,'stopped',job.result,'Community classification, website or competitor scope changed. A fresh research run is required.');return {id:job.id,state:'stopped'}}
    const profiles=job.result.profiles || [],target=job.context.targets.find(t=>{const profile=profiles.find(p=>p.entityKey===t.entityKey);return !profile || hasLegacyResearchCitationFailure(profile)})
    if(target){
      const documents=await readResearchDocuments(job.id,job.property_id)
      const existing=documents.filter(d=>d.entityKey===target.entityKey)
      const discovered=existing.length?[]:await discoverResearchSources(target)
      const pending:Array<{url:string;kind:ResearchDocument['kind']}>=[{url:target.website,kind:'official'},...target.additionalSources,...discovered]
      for(const document of existing)if(document.kind==='official')pending.push(...scopedResearchLinks(target.website,document.metadata.links || []).map(link=>({url:link.url,kind:'official' as const})))
      const seen=new Set(existing.map(d=>d.url)),deadline=Date.now()+90000
      let fetched=existing.length
      while(pending.length && fetched<18 && Date.now()<deadline){
        const source=pending.shift()!,url=publicResearchUrl(source.url)
        if(!url || seen.has(url))continue
        seen.add(url)
        let document=await fetchResearchDocument(target.entityKey,url,source.kind)
        if((document.status==='failed' || (source.kind==='official' && /floor.?plan|residences|available|\/plan-/i.test(url) && !/\$[\d,]+|\d+[,.]?\d*\s*(?:sq\.?\s*ft|SQFT|beds|bedrooms)/i.test(document.text))) && source.kind==='official' && Date.now()+55000<deadline)document=await renderResearchDocument(target.entityKey,url,source.kind) || document
        await saveDocument(job,target,document);documents.push(document);fetched++
        if(document.status==='captured' && source.kind==='official')for(const link of scopedResearchLinks(target.website,document.metadata.links || []).reverse())if(!seen.has(link.url))pending.unshift({url:link.url,kind:'official'})
      }
      let profile:ResearchProfile
      try{profile=await extractResearchProfile(target,job.context.model,documents)}catch(error){profile={entityKey:target.entityKey,name:target.name,website:target.website,propertyType:target.propertyType,transaction:target.entityKey==='subject'?job.context.model.transaction:'unknown',offerings:[],facts:[],coverageGaps:[error instanceof Error?error.message:'Research extraction failed']}}
      if(pending.some(p=>!seen.has(p.url)))profile.coverageGaps.push('Additional discovered pages remain outside this bounded crawl; add priority sources or refresh to expand coverage.')
      if(!process.env.SERPAPI_API_KEY)profile.coverageGaps.push('Broader web search is not configured; this run uses the community website and saved source references.')
      if(!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID)profile.coverageGaps.push('Rendered browser capture is not configured; JavaScript-only inventory may be missing.')
      if(!documents.some(d=>d.entityKey===target.entityKey && d.kind==='reviews' && d.status==='captured'))profile.coverageGaps.push('Property-specific review evidence has not been captured; no reputation conclusion is supported.')
      if(!documents.some(d=>d.entityKey===target.entityKey && d.kind==='ads' && d.status==='captured'))profile.coverageGaps.push('No verified public ad-library capture; competitor ad activity and effectiveness are unknown.')
      const savedProfiles=[...profiles.filter(p=>p.entityKey!==target.entityKey),profile]
      await finishStep(job,'queued',{...job.result,profiles:savedProfiles})
      return {id:job.id,state:'queued',completedEntities:savedProfiles.length,totalEntities:job.context.targets.length}
    }
    const documents=await readResearchDocuments(job.id,job.property_id)
    const comparisons=compareResearchProfiles(profiles,job.context.model)
    let insights:ResearchResult['insights']=[],synthesisError:string|null=null
    try{
      const synthesis=await synthesizeResearch(profiles,job.context.model,comparisons,documents)
      insights=synthesis.insights
      if(synthesis.withheldCount>0)synthesisError=`${synthesis.withheldCount} generated insight${synthesis.withheldCount===1?' was':'s were'} withheld because the structure or source quotations could not be verified.${insights.length===0?' No supported comparative insights were retained.':''} Refresh research to retry comparative analysis.`
    }catch(error){synthesisError=error instanceof Error?error.message:'Comparative analysis needs recovery'}
    const previous=await db.from('marketvision_research_jobs').select('result').eq('property_id',job.property_id).neq('id',job.id).in('state',['completed','partial']).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(previous.error)throw new Error('Previous research history could not be loaded')
    const result:ResearchResult={version:1,model:job.context.model,profiles,comparisons,insights,changes:researchChanges(previous.data?.result as unknown as ResearchResult || null,profiles,job.context.model),sourceCount:documents.filter(d=>d.status==='captured').length,failedSources:documents.filter(d=>d.status==='failed').length,generatedAt:new Date().toISOString(),limitations:['Research captures public claims, not independent verification or permission to publish competitor content.','No competitor ad spend, conversion performance, sales velocity or closed-sale prices are inferred.',...(synthesisError?[synthesisError]:[])]}
    const usable=profiles.filter(p=>p.facts.length || p.offerings.length).length
    const state=usable===0?'failed':synthesisError || result.failedSources>0 || usable<job.context.targets.length || profiles.some(profile=>profile.coverageGaps.length>0)?'partial':'completed'
    await finishStep(job,state,result,synthesisError)
    return {id:job.id,state,sourceCount:result.sourceCount}
  }catch(error){await finishStep(job,'failed',job.result,error instanceof Error?error.message:'Research failed');return {id:job.id,state:'failed'}}
}
export async function researchWorkspace(propertyId:string){
  const context=await loadResearchContext(propertyId),hash=researchHash(context),db=createServiceClient()
  const {data,error}=await db.from('marketvision_research_jobs').select('id,state,result,error_message,created_at,updated_at,context_hash').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(10)
  if(error)throw new MarketStoreError('Saved research could not be loaded.')
  const jobs=data || [],latest=jobs[0] || null
  const saved=jobs.find(j=>j.context_hash===hash && ['completed','partial'].includes(j.state) && (j.result as Record<string,unknown>)?.version===1) || jobs.find(j=>j.context_hash===hash && ((j.result as Record<string,unknown>)?.profiles as unknown[])?.length) || null
  const documents=saved?await readResearchDocuments(saved.id,propertyId):[]
  const partial=saved?.result as Partial<ResearchResult>|undefined
  const result:ResearchResult|null=saved?{version:1,model:context.model,profiles:partial?.profiles || [],insights:partial?.insights || [],comparisons:partial?.comparisons || [],changes:partial?.changes || [],sourceCount:partial?.sourceCount??documents.filter(d=>d.status==='captured').length,failedSources:partial?.failedSources??documents.filter(d=>d.status==='failed').length,generatedAt:partial?.generatedAt || saved.updated_at,limitations:partial?.limitations || ['Collection is in progress. Completed entity evidence is available; comparative analysis follows after collection.']}:null
  return {model:context.model,targets:context.targets,job:latest?{id:latest.id,state:latest.state,error:latest.error_message,updatedAt:latest.updated_at,current:latest.context_hash===hash}:null,result,documents:documents.map(({text,...document})=>({...document,excerpt:text.slice(0,1600)})),history:jobs.map(j=>({id:j.id,state:j.state,createdAt:j.created_at,current:j.context_hash===hash}))}
}
