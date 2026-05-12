import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

function makeQueryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    in: vi.fn(() => Promise.resolve({ data })),
    single: vi.fn(() => Promise.resolve({ data })),
    maybeSingle: vi.fn(() => Promise.resolve({ data })),
    then: (resolve: (value: { data: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data }).then(resolve, reject),
  }
  return builder
}

describe('generateRecommendations URL-only page mapping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }
      if (url.endsWith('/sitemap.xml')) {
        return new Response(`
          <urlset>
            <url><loc>https://example.com/neighborhood</loc></url>
            <url><loc>https://example.com/faq</loc></url>
          </urlset>
        `, { status: 200 })
      }
      if (url.endsWith('/neighborhood')) {
        return new Response(`
          <html>
            <head><title>Neighborhood</title><meta name="description" content="Near downtown"></head>
            <body><h1>Neighborhood</h1><p>Near downtown, transit, restaurants, parks, schools, and major employers.</p></body>
          </html>
        `, { status: 200 })
      }
      if (url.endsWith('/faq')) {
        return new Response(`
          <html>
            <head><title>FAQ</title></head>
            <body><h1>FAQ</h1><h2>What fees are required?</h2><p>Application, deposit, pet, and parking questions are answered here.</p></body>
          </html>
        `, { status: 200 })
      }
      return new Response(`
        <html>
          <head><title>Example Apartments</title><meta name="description" content="Apartments"></head>
          <body><h1>Example Apartments</h1><a href="/neighborhood">Neighborhood</a><a href="/faq">FAQ</a></body>
        </html>
      `, { status: 200 })
    }))
  })

  it('maps local and FAQ GEO gaps to exact owned pages with dev-ready details', async () => {
    createClientMock.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'properties') {
          return makeQueryBuilder({
            name: 'Example Apartments',
            website_url: 'https://example.com',
            address: { city: 'Austin', state: 'TX' },
            property_type: 'multifamily',
          })
        }
        if (table === 'geo_queries') {
          return makeQueryBuilder([
            { id: 'query-local', text: 'best apartments near downtown', type: 'local', geo: 'Austin, TX' },
            { id: 'query-faq', text: 'what fees do apartments charge?', type: 'faq', geo: 'Austin, TX' },
          ])
        }
        if (table === 'geo_runs') {
          return makeQueryBuilder([{ id: 'run-1', surface: 'gemini', batch_id: 'batch-1', started_at: new Date().toISOString(), geo_scores: [] }])
        }
        if (table === 'geo_answers') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => Promise.resolve({
                data: [
                  {
                    id: 'answer-local',
                    query_id: 'query-local',
                    run_id: 'run-1',
                    presence: false,
                    llm_rank: null,
                    link_rank: null,
                    sov: null,
                    ordered_entities: [{ name: 'Competitor', domain: 'competitor.example', position: 1, rationale: 'Strong local content' }],
                    geo_citations: [
                      { url: 'https://zillow.com/example', domain: 'zillow.com', is_brand_domain: false },
                      { url: 'https://zillow.com/example-2', domain: 'zillow.com', is_brand_domain: false },
                    ],
                  },
                  {
                    id: 'answer-faq',
                    query_id: 'query-faq',
                    run_id: 'run-1',
                    presence: false,
                    llm_rank: null,
                    link_rank: null,
                    sov: null,
                    ordered_entities: [],
                    geo_citations: [],
                  },
                ],
              })),
            })),
          }
        }
        if (table === 'geo_ai_overviews') {
          return makeQueryBuilder([])
        }
        if (table === 'geo_property_config') {
          return makeQueryBuilder({ domains: ['example.com'], competitor_domains: [], primary_geo: 'Austin, TX' })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { generateRecommendations } = await import('./recommendation-engine')
    const { recommendations } = await generateRecommendations('property-1')

    const localRecommendation = recommendations.find(rec => rec.id === 'strategy-owned-local-category-demand')
    const faqRecommendation = recommendations.find(rec => rec.id === 'strategy-faq-answer-schema')

    expect(localRecommendation?.targetUrl).toBe('https://example.com/apartments-austin-tx/')
    expect(localRecommendation?.evidence?.some(item => item.includes('URL-only crawl audited'))).toBe(true)
    expect(localRecommendation?.sourceQueryEvidence?.some(item => item.includes('absent on Gemini'))).toBe(true)
    expect(localRecommendation?.implementationSteps?.length).toBeGreaterThan(0)
    expect(localRecommendation?.acceptanceCriteria?.length).toBeGreaterThan(0)
    expect(faqRecommendation?.targetUrl).toBe('https://example.com/faq/')
    expect(faqRecommendation?.targetPageType).toBe('faq_or_support_page')
    expect(JSON.stringify(recommendations)).not.toMatch(/Epoca|Otay Mesa/)
    expect(JSON.stringify(recommendations)).toContain('Example Apartments-specific Austin, TX language')
  })
})
