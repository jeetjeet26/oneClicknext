import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),synthesize:vi.fn(),extract:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:m.from,rpc:m.rpc})}))
vi.mock('./research-model',()=>({extractResearchProfile:m.extract,synthesizeResearch:m.synthesize}))
vi.mock('./research-renderer',()=>({renderResearchDocument:vi.fn()}))
import {processResearchJob,researchHash,researchWorkspace} from './research-store'
import {communityModel} from '@/utils/community-model'
const property={id:'p',name:'Subject',property_type:'single_family',website_url:'https://example.com/community',settings:{onboarding:{transaction:'for_sale'}}}
const model=communityModel(property)
const targets=[{entityKey:'subject',competitorId:null,name:property.name,website:property.website_url,propertyType:property.property_type,additionalSources:[]}]
const contextHash=researchHash({model,targets})
const profile={entityKey:'subject',name:'Subject',website:property.website_url,propertyType:'single_family',transaction:'for_sale',offerings:[],facts:[],coverageGaps:[]}
let jobs:unknown[]=[]
beforeEach(()=>{vi.clearAllMocks();jobs=[];m.from.mockImplementation((table:string)=>{
  const response=table==='properties'?{data:property,error:null}:table==='competitors'?{data:[],error:null}:table==='marketvision_research_jobs'?{data:jobs,error:null}:{data:[],error:null}
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>void)=>Promise.resolve(response).then(resolve)}
  for(const method of ['select','eq','in','order','limit'])query[method]=()=>query
  query.single=()=>Promise.resolve(response)
  return query
})})
afterEach(()=>vi.unstubAllEnvs())
it('returns a renderable result while the first entity is saved and collection continues',async()=>{
  jobs=[{id:'job',state:'queued',result:{profiles:[profile]},context_hash:contextHash,error_message:null,created_at:'2026-11-25T00:00:00Z',updated_at:'2026-11-25T00:01:00Z'}]
  const workspace=await researchWorkspace('p')
  expect(workspace.result).toMatchObject({version:1,profiles:[profile],insights:[],comparisons:[],changes:[],sourceCount:0})
  expect(workspace.job).toMatchObject({state:'queued',current:true})
})
it('withholds prior research when the community transaction or source scope changed',async()=>{
  jobs=[{id:'job',state:'completed',result:{version:1,profiles:[profile]},context_hash:'old-classification',error_message:null}]
  const workspace=await researchWorkspace('p')
  expect(workspace.result).toBeNull();expect(workspace.documents).toEqual([]);expect(workspace.job?.current).toBe(false)
})
it.each(['some_withheld','all_withheld','review_failed'])('persists only verified insights and an accurate partial-result warning: %s',async outcome=>{
  vi.stubEnv('OPENAI_API_KEY','test');vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false')
  const empty=outcome!=='some_withheld'
  const retainedInsight={title:'Supported finding',finding:'A retained comparison',implication:'Useful difference',action:'Test the message',evidence:[],confidence:'limited',limitations:['Bounded source coverage']}
  const supportedProfile={...profile,facts:[{category:'positioning',statement:'Supported fact',kind:'source_claim',evidence:[]}]}
  const job={id:'job',property_id:'p',state:'running',lease_token:'lease',context_hash:contextHash,context:{model,targets},result:{profiles:[supportedProfile],insights:[{...retainedInsight,title:'Previously generated unreviewed conclusion'}]}}
  m.rpc.mockResolvedValue({data:job,error:null})
  if(outcome==='review_failed')m.synthesize.mockRejectedValue(new Error('Independent comparative evidence review could not be completed; all 2 generated insights were withheld. Refresh research to retry.'))
  else m.synthesize.mockResolvedValue({insights:empty?[]:[retainedInsight],withheldCount:2})
  const updates:Array<Record<string,unknown>>=[]
  m.from.mockImplementation((table:string)=>{
    const response=table==='properties'?{data:property,error:null}:table==='competitors' || table==='marketvision_research_documents'?{data:[],error:null}:{data:null,error:null}
    let updating=false
    const query:Record<string,unknown>={then:(resolve:(value:unknown)=>void)=>Promise.resolve(response).then(resolve)}
    for(const method of ['select','eq','neq','in','order','limit'])query[method]=()=>query
    query.single=()=>Promise.resolve(response)
    query.update=(value:Record<string,unknown>)=>{updating=true;updates.push(value);return query}
    query.maybeSingle=()=>Promise.resolve(updating?{data:{id:'job'},error:null}:response)
    return query
  })
  expect(await processResearchJob('job')).toMatchObject({id:'job',state:'partial'})
  expect(m.extract).not.toHaveBeenCalled()
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({state:'partial',lease_token:null,error_message:expect.stringContaining('2 generated insights were withheld'),result:{profiles:[supportedProfile],insights:empty?[]:[retainedInsight],limitations:expect.arrayContaining([expect.stringContaining('2 generated insights were withheld')])}})
  expect(updates[0].error_message).toContain('Refresh research')
  expect(String(updates[0].error_message).includes('No supported comparative insights were retained')).toBe(outcome==='all_withheld')
  if(outcome==='review_failed')expect(updates[0].error_message).toContain('Independent comparative evidence review could not be completed')
})
