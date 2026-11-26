import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {communityModel} from '@/utils/community-model'
import type {ResearchInsight,ResearchProfile} from './research-contracts'
import type {ResearchDocument} from './research-source'

const provider=vi.hoisted(()=>({create:vi.fn(),construct:vi.fn()}))
vi.mock('openai',()=>({default:class {constructor(options:unknown){provider.construct(options)}chat={completions:{create:provider.create}}}}))
import {extractResearchProfile,retainSupportedResearchInsights,retainReviewedResearchInsights,synthesizeResearch} from './research-model'

const subjectId='11111111-1111-4111-8111-111111111111'
const competitorId='22222222-2222-4222-8222-222222222222'
const subjectQuote='A rooftop pool.'
const competitorQuote='A courtyard pool.'
const source:ResearchDocument={id:subjectId,entityKey:'subject',url:'https://example.com/community',title:'Official source',fetchedAt:'2026-11-26T00:00:00Z',kind:'official',status:'captured',text:subjectQuote,contentHash:'hash',metadata:{parser:'test',transport:'test',partial:false}}
const competitorSource:ResearchDocument={...source,id:competitorId,entityKey:'competitor',url:'https://example.com/competitor',text:competitorQuote}
const profile:ResearchProfile={entityKey:'subject',name:'Community',website:source.url,propertyType:'multifamily',transaction:'rental',offerings:[],facts:[{category:'amenities',statement:'The website advertises a rooftop pool.',kind:'source_claim',evidence:[{sourceId:subjectId,quote:subjectQuote}]}],coverageGaps:[]}
const competitor:ResearchProfile={...profile,entityKey:'competitor',name:'Competitor',website:competitorSource.url,facts:[{...profile.facts[0],statement:'The website advertises a courtyard pool.',evidence:[{sourceId:competitorId,quote:competitorQuote}]}]}
const insight:ResearchInsight={title:'Pool setting differs',finding:'The subject advertises a rooftop pool; the competitor advertises a courtyard pool.',implication:'A pool alone is a shared claim.',action:'Test messaging about the rooftop setting.',evidence:[{sourceId:subjectId,quote:subjectQuote},{sourceId:competitorId,quote:competitorQuote}],confidence:'moderate',limitations:['Website claims do not establish resident experience.']}
const profiles=[profile,competitor],documents=[source,competitorSource],model=communityModel({property_type:'multifamily'})
const invented={...insight,evidence:[{sourceId:subjectId,quote:'A private marina.'}]}
const response=(value:unknown)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})
const checkNames=['titleGrounded','findingGrounded','implicationGrounded','actionGrounded','unknownsPreserved','pricingGrounded','entityScopeCorrect','housingGuidanceAppropriate'] as const
type CheckName=typeof checkNames[number]
const review=(index:number,rejected?:CheckName)=>({index,checks:Object.fromEntries(checkNames.map(name=>[name,{passed:name!==rejected,reason:name===rejected?'This criterion is not established by the supplied evidence.':'This criterion is satisfied by the bounded comparison or is not applicable.'}]))})
beforeEach(()=>{provider.create.mockReset();provider.construct.mockReset();for(const key of ['MARKETVISION_RESEARCH_MODEL','MARKETVISION_RESEARCH_SYNTHESIS_MODEL','MARKETVISION_RESEARCH_REVIEW_MODEL'])vi.stubEnv(key,'')})
afterEach(()=>vi.unstubAllEnvs())

it('keeps an independently supported multi-entity comparison when another insight invents a quote',()=>{
  expect(retainSupportedResearchInsights({insights:[invented,insight]},profiles,documents)).toEqual({insights:[insight],withheldCount:1})
})
it('withholds an entire insight if any citation fails and preserves the count when all fail',()=>{
  const partlySupported={...insight,evidence:[...insight.evidence,{sourceId:subjectId,quote:'Invented'}]}
  expect(retainSupportedResearchInsights({insights:[invented,partlySupported]},profiles,documents)).toEqual({insights:[],withheldCount:2})
})
it('isolates malformed insight fields and non-object entries',()=>{
  expect(retainSupportedResearchInsights({insights:[insight,{...insight,confidence:'certain'},null,'not an insight']},profiles,documents)).toEqual({insights:[insight],withheldCount:3})
})
it('requires each source and quote to belong to the matching supplied entity profile',()=>{
  const wrongEntity={...profile,entityKey:'unrelated'}
  expect(retainSupportedResearchInsights({insights:[insight]},[wrongEntity,competitor],documents)).toEqual({insights:[],withheldCount:1})
  const extraQuote='A spa.'
  const unsupportedByProfile={...insight,evidence:[{sourceId:subjectId,quote:extraQuote}]}
  expect(retainSupportedResearchInsights({insights:[unsupportedByProfile]},profiles,[{...source,text:source.text+extraQuote},competitorSource])).toEqual({insights:[],withheldCount:1})
})
it('does not accept failed captures or whitespace-altered quotations',()=>{
  expect(retainSupportedResearchInsights({insights:[insight]},profiles,[{...source,status:'failed'},competitorSource])).toEqual({insights:[],withheldCount:1})
  const altered={...insight,evidence:[{sourceId:subjectId,quote:'A  rooftop pool.'}]}
  expect(retainSupportedResearchInsights({insights:[altered]},profiles,documents)).toEqual({insights:[],withheldCount:1})
})
it('accepts retained terms evidence with the same exact source validation',()=>{
  expect(retainSupportedResearchInsights({insights:[insight]},profiles,[{...source,text:'Other content',metadata:{...source.metadata,terms:subjectQuote}},competitorSource])).toEqual({insights:[insight],withheldCount:0})
})
it('requires both subject and competitor evidence before a competitive claim can be reviewed',()=>{
  const subjectOnly={...insight,evidence:[insight.evidence[0]]},competitorOnly={...insight,evidence:[insight.evidence[1]]}
  expect(retainSupportedResearchInsights({insights:[subjectOnly,competitorOnly,insight]},profiles,documents)).toEqual({insights:[insight],withheldCount:2})
})
it('rejects malformed or unbounded top-level output instead of treating it as empty success',()=>{
  for(const value of [{},{insights:{}},{insights:Array(13).fill(insight)}])expect(()=>retainSupportedResearchInsights(value,profiles,documents)).toThrow()
})
it('applies item retention to the actual provider response',async()=>{
  provider.create.mockResolvedValueOnce(response({insights:[insight,invented]}))
  provider.create.mockResolvedValueOnce(response({reviews:[review(0)]}))
  expect(await synthesizeResearch(profiles,model,[],documents)).toEqual({insights:[insight],withheldCount:1})
  expect(provider.create).toHaveBeenCalledTimes(2)
  expect(provider.create.mock.calls[0][0]).toMatchObject({model:'gpt-5.4',reasoning_effort:'medium',max_completion_tokens:10000})
  expect(provider.create.mock.calls[1][0]).toMatchObject({model:'gpt-5.4',reasoning_effort:'medium',max_completion_tokens:8000})
  for(const [request] of provider.create.mock.calls)expect(request).not.toHaveProperty('max_tokens')
  for(const [options] of provider.construct.mock.calls)expect(options).toMatchObject({maxRetries:0,timeout:110000})
})
it('requires independent approval even for exact citations and retains only approved comparative conclusions',async()=>{
  const ungroundedPrice={...insight,title:'Significantly higher rents',finding:'The subject has higher base rents than competitors with unspecified rates.'}
  const ungroundedUnique={...insight,title:'Unique pool offering',finding:'The subject pool is unmatched because other competitor amenities are unknown.'}
  const unsafeAction={...insight,action:'Target people with respiratory sensitivities for this housing.'}
  provider.create.mockResolvedValueOnce(response({insights:[insight,ungroundedPrice,ungroundedUnique,unsafeAction,invented]}))
  provider.create.mockResolvedValueOnce(response({reviews:[
    review(3,'housingGuidanceAppropriate'),review(0),review(2,'unknownsPreserved'),review(1,'pricingGrounded'),
  ]}))
  expect(await synthesizeResearch(profiles,model,[],documents)).toEqual({insights:[insight],withheldCount:4})
  expect(provider.create).toHaveBeenCalledTimes(2)
  const reviewInput=JSON.parse(provider.create.mock.calls[1][0].messages[1].content)
  expect(reviewInput).toMatchObject({subjectModel:model,profiles,computedComparisons:[],candidates:[{index:0,insight},{index:1,insight:ungroundedPrice},{index:2,insight:ungroundedUnique},{index:3,insight:unsafeAction}]})
})
it.each([
  {reviews:[]},
  {reviews:[review(0),review(0)]},
  {reviews:[review(0),review(2)]},
  {reviews:[review(0),{...review(1),checks:{...review(1).checks,actionGrounded:{passed:'true',reason:'Wrong type'}}}]},
  {reviews:[review(0),{...review(1),checks:{...review(1).checks,actionGrounded:{passed:true,reason:' '}}}]},
  {reviews:[review(0),{index:1,checks:{titleGrounded:{passed:true,reason:'Other mandatory checks absent'}}}]},
  {reviews:[{index:0,supported:true,reason:'Old single-verdict schema'},{index:1,supported:true,reason:'Old single-verdict schema'}]},
  {approved:[0,1]},
])('fails closed on an incomplete or ambiguous semantic review: %j',value=>{
  expect(()=>retainReviewedResearchInsights(value,[insight,insight])).toThrow()
})
it('returns no fallback when the evidence reviewer rejects every candidate',async()=>{
  provider.create.mockResolvedValueOnce(response({insights:[insight]}))
  provider.create.mockResolvedValueOnce(response({reviews:[review(0,'findingGrounded')]}))
  expect(await synthesizeResearch(profiles,model,[],documents)).toEqual({insights:[],withheldCount:1})
})
it.each(checkNames)('rejects an insight when the mandatory %s check fails even if all other checks pass',name=>{
  expect(retainReviewedResearchInsights({reviews:[review(0,name),review(1)]},[insight,insight])).toEqual({insights:[insight],withheldCount:1})
})
it('uses separately configured reasoning models without changing extraction configuration',async()=>{
  vi.stubEnv('MARKETVISION_RESEARCH_SYNTHESIS_MODEL','synthesis-reasoning-model')
  vi.stubEnv('MARKETVISION_RESEARCH_REVIEW_MODEL','review-reasoning-model')
  provider.create.mockResolvedValueOnce(response({insights:[insight]})).mockResolvedValueOnce(response({reviews:[review(0)]})).mockResolvedValueOnce(response(profile))
  await synthesizeResearch(profiles,model,[],documents)
  await extractResearchProfile({entityKey:'subject',competitorId:null,name:profile.name,website:profile.website,propertyType:profile.propertyType,additionalSources:[]},model,documents)
  expect(provider.create.mock.calls[0][0]).toMatchObject({model:'synthesis-reasoning-model',reasoning_effort:'medium',max_completion_tokens:10000})
  expect(provider.create.mock.calls[1][0]).toMatchObject({model:'review-reasoning-model',reasoning_effort:'medium',max_completion_tokens:8000})
  expect(provider.create.mock.calls[2][0]).toMatchObject({model:'gpt-4.1',max_tokens:12000})
  expect(provider.create.mock.calls[2][0]).not.toHaveProperty('reasoning_effort')
  expect(provider.create.mock.calls[2][0]).not.toHaveProperty('max_completion_tokens')
})
it.each(['unavailable','malformed'])('withholds the complete batch when independent review is %s',async failure=>{
  provider.create.mockResolvedValueOnce(response({insights:[insight,invented]}))
  if(failure==='unavailable')provider.create.mockRejectedValueOnce(new Error('Review timeout'))
  else provider.create.mockResolvedValueOnce(response({reviews:[]}))
  await expect(synthesizeResearch(profiles,model,[],documents)).rejects.toThrow('all 2 generated insights were withheld')
  expect(provider.create).toHaveBeenCalledTimes(2)
})
it('does not call review when exact citation and scope checks already rejected all insights',async()=>{
  provider.create.mockResolvedValueOnce(response({insights:[invented]}))
  expect(await synthesizeResearch(profiles,model,[],documents)).toEqual({insights:[],withheldCount:1})
  expect(provider.create).toHaveBeenCalledTimes(1)
})
it('keeps provider and truncated-response failures actionable',async()=>{
  provider.create.mockRejectedValueOnce(new Error('Provider unavailable'))
  await expect(synthesizeResearch(profiles,model,[],documents)).rejects.toThrow('Provider unavailable')
  provider.create.mockResolvedValueOnce({choices:[{finish_reason:'length',message:{content:JSON.stringify({insights:[insight]})}}]})
  await expect(synthesizeResearch(profiles,model,[],documents)).rejects.toThrow('incomplete output')
})
