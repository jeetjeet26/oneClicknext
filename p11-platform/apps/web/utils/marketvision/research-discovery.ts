import { publicResearchUrl, type ResearchDocument } from './research-source'
import type { ResearchTarget } from './research-contracts'

/** Search locates pages; snippets are never substituted for captured pricing or review evidence. */
export async function discoverResearchSources(target:ResearchTarget):Promise<Array<{url:string;kind:ResearchDocument['kind']}>>{
  const apiKey=process.env.SERPAPI_API_KEY
  if(!apiKey)return []
  const sources:Array<{url:string;kind:ResearchDocument['kind']}>=[]
  const queries=[`"${target.name}" floor plans pricing reviews`, `"${target.name}" "ads library" OR "adstransparency" OR site:gov`]
  for(const q of queries){
    try{
      const endpoint=new URL('https://serpapi.com/search.json');endpoint.search=new URLSearchParams({engine:'google',q,api_key:apiKey,num:'8'}).toString()
      const response=await fetch(endpoint,{signal:AbortSignal.timeout(12000)})
      if(!response.ok)continue
      const data=await response.json() as {organic_results?:Array<{link?:string}>}
      for(const result of data.organic_results || []){
        const url=result.link && publicResearchUrl(result.link)
        if(!url || sources.some(s=>s.url===url))continue
        const host=new URL(url).hostname,ownHost=new URL(target.website).hostname
        const kind:ResearchDocument['kind']=/ads\/library|adstransparency/i.test(url)?'ads':/\.gov$|\.gov\./i.test(host)?'planning':/yelp|reviews|trustpilot|trustbuilder/i.test(url)?'reviews':host===ownHost?'official':'listing'
        sources.push({url,kind})
      }
    }catch{ /* Missing search coverage is reported in the profile, not replaced with invented sources. */ }
  }
  return sources.slice(0,6)
}
