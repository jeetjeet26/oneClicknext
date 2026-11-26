import {beforeEach,expect,it,vi} from 'vitest'
import {communityModel} from '@/utils/community-model'
import type {ResearchInsight,ResearchProfile} from './research-contracts'
import type {ResearchDocument} from './research-source'

const provider=vi.hoisted(()=>({create:vi.fn()}))
vi.mock('openai',()=>({default:class {chat={completions:{create:provider.create}}}}))
import {retainSupportedResearchInsights,synthesizeResearch} from './research-model'

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
beforeEach(()=>provider.create.mockReset())

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
it('rejects malformed or unbounded top-level output instead of treating it as empty success',()=>{
  for(const value of [{},{insights:{}},{insights:Array(13).fill(insight)}])expect(()=>retainSupportedResearchInsights(value,profiles,documents)).toThrow()
})
it('applies item retention to the actual provider response',async()=>{
  provider.create.mockResolvedValue({choices:[{finish_reason:'stop',message:{content:JSON.stringify({insights:[insight,invented]})}}]})
  expect(await synthesizeResearch(profiles,model,[],documents)).toEqual({insights:[insight],withheldCount:1})
})
it('keeps provider and truncated-response failures actionable',async()=>{
  provider.create.mockRejectedValueOnce(new Error('Provider unavailable'))
  await expect(synthesizeResearch(profiles,model,[],documents)).rejects.toThrow('Provider unavailable')
  provider.create.mockResolvedValueOnce({choices:[{finish_reason:'length',message:{content:JSON.stringify({insights:[insight]})}}]})
  await expect(synthesizeResearch(profiles,model,[],documents)).rejects.toThrow('incomplete output')
})
