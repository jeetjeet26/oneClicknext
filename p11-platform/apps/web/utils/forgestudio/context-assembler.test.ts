import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
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
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
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
            generation_status: 'completed',
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
            },
          ],
          error: null,
        })
      }
      throw new Error(`Unexpected table ${table}`)
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
    expect(bundle.targetAudience).toBe('Young professionals')
    expect(bundle.contextHash).toMatch(/^[a-f0-9]{64}$/)

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
      return chainResolving({ data: null, error: null })
    })

    const { assembleForgeStudioContext } = await import('./context-assembler')
    const bundle = await assembleForgeStudioContext({ propertyId: 'prop-1', query: 'q' })
    expect(bundle.sources.some((source) => source.kind === 'brand_section')).toBe(false)
  })
})
