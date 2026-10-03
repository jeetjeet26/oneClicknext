vi.mock('@/utils/readiness/publication',()=>({currentApprovedReadiness:async()=>{const response=await fromMock('property_onboarding_snapshots');return response.data}}))
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

vi.mock('@/utils/substrate/business-context-bridge', () => ({
  buildBusinessContextBridge: vi.fn().mockResolvedValue({
    propertyId: 'prop-1',
    asOf: '2026-08-13T00:00:00Z',
    readOnly: true,
    bi: {
      lastImportState: 'complete',
      hasImportWarnings: false,
      marketing30d: { spend: 100, clicks: 20, conversions: 2, impressions: 1000 },
    },
  }),
}))

vi.mock('openai', () => ({
  default: class {
    embeddings = {
      create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    }
  },
}))

const ASSET_ID = '44444444-4444-4444-8444-444444444444'

function chainResolving(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'lte', 'is']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(async () => result)
  builder.maybeSingle = vi.fn(async () => result)
  builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

describe('assembleForgeStudioContext', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    rpcMock.mockReturnValue(chainResolving({data:[],error:null}))
    process.env = { ...originalEnv }
    delete process.env.OPENAI_API_KEY

    fromMock.mockImplementation((table: string) => {
      if (table === 'properties') {
        return chainResolving({
          data: {
            id: 'prop-1',
            name: 'The Landing',
            address: '100 Riverside Dr',
            property_type: 'multifamily',
            website_url: 'https://thelanding.example.com',
            unit_count: 240,
            target_audience: null,
            brand_voice: 'Warm and neighborly',
            updated_at: '2026-07-01T00:00:00Z',
          },
          error: null,
        })
      }
      if (table === 'forgestudio_config') {
        return chainResolving({
          data: {
            brand_voice: null,
            target_audience: 'Young professionals',
            key_amenities: ['Resort-style pool', 'Dog park'],
            include_hashtags: true,
            include_cta: true,
            max_caption_length: null,
            updated_at: '2026-07-02T00:00:00Z',
          },
          error: null,
        })
      }
      if (table === 'property_brand_assets') {
        return chainResolving({
          data: {
            id: 'brand-1',
            generation_status: 'complete',
            approval_status: 'approved',
            contract_version: 'brand.v1',
            contract_hash: 'brand-hash',
            approved_at: '2026-06-02T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
            section_1_introduction: null,
            section_2_positioning: { statement: 'Riverside living without the commute.' },
            section_3_target_audience: null,
            section_4_personas: null,
            section_5_name_story: null,
          },
          error: null,
        })
      }
      if (table === 'content_assets') {
        return chainResolving({
          data: [
            {
              id: ASSET_ID,
              name: 'Pool at sunset',
              asset_type: 'image',
              file_url: 'https://cdn.example.com/pool.jpg',
              thumbnail_url: null,
              description: 'Resort-style pool at golden hour',
              width: 1080,
              height: 1080,
              duration_seconds: null,
              alt_text: 'Pool at sunset',
              rights_status: 'owned',
              approval_status: 'approved',
              curation_status: 'selected',
              expires_at: null,
              duplicate_of: null,
            },
          ],
          error: null,
        })
      }
      if (table === 'property_legal_configs') {
        return chainResolving({
          data: {
            id: 'legal-1',
            status: 'approved',
            version: 1,
            fair_housing: 'Equal Housing Opportunity',
            pricing_disclaimer: 'Pricing changes.',
            accessibility: 'Accessibility statement.',
            effective_at: '2026-01-01T00:00:00Z',
            approved_at: '2026-01-01T00:00:00Z',
          },
          error: null,
        })
      }
      if (table === 'property_onboarding_snapshots') {
        return chainResolving({
          data: {
            id: 'snapshot-1',
            status: 'approved',
            snapshot_payload: { property: { name: 'The Landing' } },
            content_hash: 'snapshot-hash',
            unresolved_conflicts: [],
            approved_at: '2026-07-01T00:00:00Z',
            updated_at: '2026-07-01T00:00:00Z',
          },
          error: null,
        })
      }
      if (
        table === 'forgestudio_config' ||
        table === 'property_onboarding_snapshots' ||
        table === 'property_legal_configs'
      ) {
        return chainResolving({ data: null, error: null })
      }
      return chainResolving({ data: [], error: null })
    })
  })

  it('assembles cited sources from property, config, brand, facts, and assets', async () => {
    const { assembleForgeStudioContext } = await import('./context-assembler')
    const bundle = await assembleForgeStudioContext({
      propertyId: 'prop-1',
      query: 'Drive August tours',
      sourceFacts: [{ text: 'One month free in August', source: 'leasing office' }],
      assetIds: [ASSET_ID],
    })

    const ids = bundle.sources.map((source) => source.id)
    expect(ids).toContain('property_field:name')
    expect(ids).toContain('channel_settings:key_amenities')
    expect(ids).toContain('brand_section:brand-1:section_2_positioning')
    expect(ids).toContain('operator_input:0')
    expect(ids).toContain(`asset:${ASSET_ID}`)

    expect(bundle.assets).toHaveLength(1)
    expect(bundle.assets[0].fileUrl).toBe('https://cdn.example.com/pool.jpg')
    expect(bundle.brandVoice).toBe('Warm and neighborly')
    expect(bundle.targetAudience).toBeNull()
    expect(bundle.policy.legalConfigId).toBe('legal-1')
    expect(ids.some((id) => id.startsWith('performance_signal:'))).toBe(true)
    expect(bundle.contextHash).toMatch(/^[a-f0-9]{64}$/)
    expect(bundle.channelSettings).toEqual({includeHashtags:true,includeCta:true,maxCaptionLength:2200})

    // No OPENAI_API_KEY → no KB sources, and no RPC call attempted.
    expect(ids.some((id) => id.startsWith('kb_document:'))).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('includes KB documents with ids and similarity when retrieval is available', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    rpcMock.mockResolvedValue({
      data: [{ id: 'doc-1', content: 'Pet policy allows two pets per home.', similarity: 0.82, metadata: {} }],
      error: null,
    })

    const { assembleForgeStudioContext } = await import('./context-assembler')
    const bundle = await assembleForgeStudioContext({
      propertyId: 'prop-1',
      query: 'Pet-friendly living',
    })

    const kbSource = bundle.sources.find((source) => source.id === 'kb_document:doc-1')
    expect(kbSource).toBeDefined()
    expect(kbSource?.similarity).toBe(0.82)
    expect(rpcMock).toHaveBeenCalledWith('match_documents', expect.objectContaining({
      filter_property: 'prop-1',
    }))
  })

  it('skips brand sections when BrandForge generation is incomplete', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'properties') {
        return chainResolving({
          data: { id: 'prop-1', name: 'The Landing', address: null, property_type: null, website_url: null, unit_count: null, target_audience: null, brand_voice: null, updated_at: null },
          error: null,
        })
      }
      if (table === 'property_brand_assets') {
        return chainResolving({
          data: { id: 'brand-1', generation_status: 'in_progress', updated_at: null, section_1_introduction: null, section_2_positioning: { statement: 'Draft' }, section_3_target_audience: null, section_4_personas: null, section_5_name_story: null },
          error: null,
        })
      }
      return chainResolving({ data: [], error: null })
    })

    const { assembleForgeStudioContext } = await import('./context-assembler')
    const bundle = await assembleForgeStudioContext({ propertyId: 'prop-1', query: 'q' })
    expect(bundle.sources.some((source) => source.kind === 'brand_section')).toBe(false)
  })
  it('stops on source-read failure instead of silently treating it as missing evidence',async()=>{
    const baseline=fromMock.getMockImplementation()!
    fromMock.mockImplementation((table:string)=>table==='property_units'?chainResolving({data:null,error:{message:'unavailable'}}):baseline(table))
    await expect((await import('./context-assembler')).assembleForgeStudioContext({propertyId:'prop-1',query:'q',documentIds:[]})).rejects.toThrow('inventory sources could not be read')
  })
  it('refreshes saved knowledge by exact ID without embedding calls',async()=>{
    process.env.OPENAI_API_KEY='fixture-never-used'
    const baseline=fromMock.getMockImplementation()!
    fromMock.mockImplementation((table:string)=>table==='documents'?chainResolving({data:[{id:'saved-doc',content:'Current pet policy',metadata:{version:2}}],error:null}):baseline(table))
    const bundle=await(await import('./context-assembler')).assembleForgeStudioContext({propertyId:'prop-1',query:'q',documentIds:['saved-doc','removed-doc']})
    expect(rpcMock).not.toHaveBeenCalled();expect(bundle.sourceRecords?.['document:saved-doc'].values.content).toBe('Current pet policy');expect(bundle.warnings).toContainEqual(expect.objectContaining({code:'knowledge_source_missing',sourceId:'kb_document:removed-doc'}))
  })
  it('does not permit inventory claims before their effective date',async()=>{
    const baseline=fromMock.getMockImplementation()!
    fromMock.mockImplementation((table:string)=>table==='property_units'?chainResolving({data:[{id:'future-unit',unit_type:'Studio',effective_at:'2099-01-01T00:00:00Z',expires_at:null,review_status:'approved',active:true}],error:null}):baseline(table))
    const bundle=await(await import('./context-assembler')).assembleForgeStudioContext({propertyId:'prop-1',query:'q',documentIds:[]})
    expect(bundle.sources.find(s=>s.id==='structured_inventory:future-unit')?.allowedUses).not.toContain('claim')
  })
  it('uses scoped current-source eligibility and retains rights-bearing evidence',async()=>{
    const builder=chainResolving({data:[{id:'testimonial',status:'active',review_text_snapshot:'Calm community',attribution_approved:true,reviewer_name_snapshot:'Resident',rights_basis:'direct_consent',revoked_at:null}],error:null})
    rpcMock.mockReturnValue(builder)
    const bundle=await(await import('./context-assembler')).assembleForgeStudioContext({propertyId:'prop-1',query:'testimonial',documentIds:[]})
    expect(rpcMock).toHaveBeenCalledWith('eligible_reviewflow_testimonials',{p_property_id:'prop-1',p_channel:'social'});expect(bundle.sourceRecords?.['testimonial:testimonial'].values.status).toBe('active')
  })

it('captures absent settings explicitly so a later configuration save is detectable',async()=>{
 const previous=fromMock.getMockImplementation()!;fromMock.mockImplementation((table:string)=>table==='forgestudio_config'?chainResolving({data:null,error:null}):previous(table));const result=await(await import('./context-assembler')).assembleForgeStudioContext({propertyId:'prop-1',query:'q',documentIds:[]});expect(result.sourceRecords?.config).toEqual({kind:'config',id:'prop-1',values:{absent:true}})
})

})
