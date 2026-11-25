import {afterEach,describe,it,expect,vi} from 'vitest'
vi.mock('./server',()=>({brainRpc:vi.fn(),getCommunityContext:vi.fn(),requireCurrentScope:vi.fn(),resolvePortfolioScope:vi.fn()}))
vi.mock('./providers',()=>({providerProject:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:vi.fn()}))
vi.mock('@/utils/analytics/read-marketing-facts',()=>({readMarketingFacts:vi.fn()}))
vi.mock('@/utils/marketvision/profile-store',()=>({readCompetitorProfiles:vi.fn().mockResolvedValue({warnings:[],competitors:[]})}))
import {readMarketingFacts,type MarketingFact} from '@/utils/analytics/read-marketing-facts'
import {brainRpc,resolvePortfolioScope} from './server'
import {readPortfolioBrain,validatePortfolioAnswer,type PortfolioGroup} from './portfolio'
const id='11111111-1111-4111-8111-111111111111'
const groups:PortfolioGroup[]=[{propertyId:id,name:'Test',state:'ready',evidenceKey:`community:${id}`,data:{sources:[{id:'source-a',propertyId:id,content:{rent:2000}},{id:'source-b',propertyId:id,content:{rent:3000}}]}}]
const answer=()=>({summary:'Available evidence is limited.',insights:[{observation:'Recorded rent is 2000.',communityIds:[id],evidenceKeys:[`community:${id}`],sourceIds:['source-a']}],missingData:['Observation date is unknown. Current pricing cannot be confirmed.'],recommendations:['Verify current pricing before comparison.']})
describe('portfolio source attribution',()=>{
 it('accepts a sourced observation with explicit missing data',()=>expect(validatePortfolioAnswer(answer(),groups).missingData).toHaveLength(1))
 it('rejects fabricated source references',()=>{const a=answer();a.insights[0].sourceIds=['invented'];expect(()=>validatePortfolioAnswer(a,groups)).toThrow('unavailable source')})
 it('rejects numbers supported only by an uncited source',()=>{const a=answer();a.insights[0].observation='Recorded rent is 3000.';expect(()=>validatePortfolioAnswer(a,groups)).toThrow('number outside')})
 it('requires a source for every finding',()=>{const a=answer();a.insights[0].sourceIds=[];expect(()=>validatePortfolioAnswer(a,groups)).toThrow()})
})

describe('campaign portfolio answers',()=>{
  const requestId='22222222-2222-4222-8222-222222222222'
  const input={
    requestId,propertyIds:[id],operation:'campaigns' as const,
    query:'Can you give me some insights into my campaign performance across Google and Meta?',
    start:'2026-10-25',end:'2026-11-24',offset:0,assetOffset:0,
  }
  const fact:MarketingFact={
    id:'google-row',date:'2026-10-25',channel_id:'google_ads',source_account_id:'1234567890',
    currency_code:'USD',campaign_id:'google-campaign',campaign_name:'Search',raw_source:null,
    impressions:3207,clicks:82,spend:113.47,conversions:7,
  }

  function savedAnalysis(content:string) {
    vi.stubEnv('OPENAI_API_KEY','test')
    vi.mocked(resolvePortfolioScope).mockResolvedValue({
      id,kind:'portfolio',purpose:'portfolio',org_id:id,actor_id:id,property_ids:[id],
      policy_revision:1,permission_hash:'a'.repeat(64),
      created_at:'2026-11-24T00:00:00.000Z',expires_at:'2026-11-25T00:00:00.000Z',
    })
    vi.mocked(readMarketingFacts).mockResolvedValue([
      fact,
      {...fact,id:'meta-row',date:'2026-11-04',channel_id:'meta_ads',campaign_id:'meta-campaign',
        impressions:1211,clicks:59,spend:54.13,conversions:0},
    ])
    const responses:Record<string,unknown>={
      brain_portfolio_history:[],
      brain_list_communities:[{id,name:'Cayman',capabilities:['portfolio']}],
      brain_measurement_coverage:{state:'incomplete',accounts:[]},
      brain_begin_model:{state:'received',response:{choices:[{message:{content}}]}},
    }
    vi.mocked(brainRpc).mockImplementation(async <T>(name:string)=>responses[name] as T)
  }

  function campaignAnswer(observation:string) {
    const result=answer()
    result.insights[0]={...result.insights[0],observation,sourceIds:[`${id}:source:1`]}
    return JSON.stringify(result)
  }

  afterEach(()=>{
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('accepts the sourced, rounded rates shown in the campaign report',async ()=>{
    const observation='Google Ads recorded a CTR of 2.56%, CPC of $1.38, and CPA of $16.21.'
    savedAnalysis(campaignAnswer(observation))
    const result=await readPortfolioBrain(id,input)
    expect(result).toMatchObject({modelState:'received',answer:{insights:[{observation}]}})
    expect(readMarketingFacts).toHaveBeenCalledWith(undefined,{propertyId:id,startDate:input.start,endDate:input.end})
  })

  it.each([
    ['an unsupported share',campaignAnswer('Google Ads accounted for 80% of impressions.')],
    ['malformed JSON','{"summary":'],
  ])('returns and saves the channel report when the written analysis contains %s',async (_label,content)=>{
    savedAnalysis(content)
    const result=await readPortfolioBrain(id,input)
    expect(result).toMatchObject({
      modelState:'analysis_unverified',answer:null,
      groups:[{name:'Cayman',data:{providerCoverage:'incomplete',channels:[
        {channel:'google_ads',observedDays:1,conversions:7,ctr:2.56,cpc:1.38,cpa:16.21},
        {channel:'meta_ads',observedDays:1,conversions:0,ctr:4.87,cpc:0.92,cpa:null},
      ]}}],
    })
    expect(brainRpc).toHaveBeenCalledWith('brain_portfolio_append',expect.objectContaining({
      p_id:requestId,p_role:'assistant',p_evidence:expect.objectContaining({result}),
    }))
  })
})
