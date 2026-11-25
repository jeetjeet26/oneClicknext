import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({from:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:m.from})}))
vi.mock('./research-model',()=>({extractResearchProfile:vi.fn(),synthesizeResearch:vi.fn()}))
vi.mock('./research-renderer',()=>({renderResearchDocument:vi.fn()}))
import {researchHash,researchWorkspace} from './research-store'
import {communityModel} from '@/utils/community-model'
const property={id:'p',name:'Subject',property_type:'single_family',website_url:'https://example.com/community',settings:{onboarding:{transaction:'for_sale'}}}
const model=communityModel(property)
const targets=[{entityKey:'subject',competitorId:null,name:property.name,website:property.website_url,propertyType:property.property_type,additionalSources:[]}]
const contextHash=researchHash({model,targets})
const profile={entityKey:'subject',name:'Subject',website:property.website_url,propertyType:'single_family',transaction:'for_sale',offerings:[],facts:[],coverageGaps:[]}
let jobs:unknown[]=[]
beforeEach(()=>{jobs=[];m.from.mockImplementation((table:string)=>{
  const response=table==='properties'?{data:property,error:null}:table==='competitors'?{data:[],error:null}:table==='marketvision_research_jobs'?{data:jobs,error:null}:{data:[],error:null}
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>void)=>Promise.resolve(response).then(resolve)}
  for(const method of ['select','eq','in','order','limit'])query[method]=()=>query
  query.single=()=>Promise.resolve(response)
  return query
})})
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
