import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const buildPropertyReportDataMock = vi.fn()
const buildRunReportDataMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/propertyaudit/reporting', () => ({
  buildPropertyReportData: buildPropertyReportDataMock,
  buildRunReportData: buildRunReportDataMock,
  buildCharts: vi.fn(() => ({
    scoreTrend: '<svg></svg>',
    visibilityTrend: '<svg></svg>',
    queryTypeBar: '<svg></svg>',
    recommendationBar: '<svg></svg>',
    competitorBar: '<svg></svg>',
  })),
}))

describe('propertyaudit generate-report route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(),
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/generate-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', template: 'executive' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/generate-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', template: 'executive' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(buildPropertyReportDataMock).not.toHaveBeenCalled()
  })

  it('returns 409 when there is no completed run for the property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  })),
                })),
              })),
            })),
          })),
        }
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/generate-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', template: 'executive' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Report generation requires at least one completed run',
    })
    expect(buildPropertyReportDataMock).not.toHaveBeenCalled()
  })

  it('uses a specific completed run snapshot when runId is provided', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'run-1', property_id: 'property-1', status: 'completed' },
                error: null,
              }),
            })),
          })),
        }
      }),
    })

    buildRunReportDataMock.mockResolvedValue({
      property: { name: 'Aster House', address: { city: 'Austin', state: 'TX' } },
      runs: [{ id: 'run-1', surface: 'openai', model_name: 'gpt-5.2', started_at: '2026-03-16T00:00:00.000Z', finished_at: '2026-03-16T00:10:00.000Z', geo_scores: [{ overall_score: 72, visibility_pct: 66, avg_llm_rank: 2.3, avg_link_rank: 1.5, avg_sov: 0.5 }] }],
      surfaceSummaries: [
        {
          surface: 'chatgpt',
          label: 'ChatGPT',
          measurementNote: 'Grounded API proxy for ChatGPT-style answer measurement.',
          lastRunAt: '2026-03-16T00:00:00.000Z',
          overallScore: 72,
          visibilityPct: 66,
        },
      ],
      siteAudit: {
        accessMode: 'URLOnly',
        websiteUrl: 'https://aster.example',
        normalizedOrigin: 'https://aster.example',
        homepageReachable: true,
        robotsTxtReachable: true,
        sitemapReachable: false,
        llmsTxtReachable: false,
        title: 'Aster House',
        metaDescription: 'Apartments',
        structuredDataTypes: ['FAQPage'],
        faqStructuredData: true,
        organizationStructuredData: false,
        answerBlockSignals: 2,
        internalLinkCount: 5,
        notes: ['llms.txt was not reachable.'],
      },
      queries: [],
      answers: [],
      competitors: [],
      scores: [{ overall_score: 72, visibility_pct: 66, avg_llm_rank: 2.3, avg_link_rank: 1.5, avg_sov: 0.5 }],
      recommendationSummary: { total: 0, high: 0, medium: 0, low: 0, byType: {} },
      recommendations: [
        {
          id: 'rec-1',
          type: 'missing_keyword',
          priority: 'high',
          title: 'Create a neighborhood landing page',
          description: 'Improve visibility with FAQPageJSON-LD and answer- block markup.',
          accessLevel: 'CodeRequired',
          owner: 'engineering',
          status: 'todo',
          targetUrl: 'https://aster.example/neighborhood',
          targetPageType: 'local_landing_page',
          evidenceMode: 'URLOnly',
          keywords: ['best apartments near downtown'],
          impact: { score: 80, reason: 'High-intent local prompt gap' },
          actionItems: ['Add FAQPageJSON-LD and answer- block markup'],
          relatedQueries: [{ id: 'query-1', text: 'best apartments near downtown', type: 'local' }],
        },
      ],
      queryTypeStats: [{ type: 'local', total: 1, presencePct: 25, avgRank: null, avgSov: null }],
      citationSummary: { total: 0, brandPct: 0, topDomains: [] },
      aiOverviewSummary: { totalTracked: 0, visibleCount: 0, visibilityPct: 0, byType: [] },
      trends: [],
      glossary: [],
      insights: { highlights: [], risks: [], opportunities: [], summaryStats: [] },
      narrative: 'Al Overview visibility improved. AI answers strong branded prompts cite new- to-brand pages as medium- priority.',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/generate-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', runId: 'run-1', template: 'executive' }),
    }) as NextRequest

    const response = await POST(request)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('X-PropertyAudit-Artifact-Format')).toBe('html')
    expect(buildRunReportDataMock).toHaveBeenCalledWith(expect.anything(), 'run-1')
    expect(buildPropertyReportDataMock).not.toHaveBeenCalled()
    expect(text).toContain('Aster House')
    expect(text).toContain('GEO Visibility Report')
    expect(text).toContain('Executive Snapshot')
    expect(text).toContain('AI Visibility Position')
    expect(text).toContain('Owned Content')
    expect(text).toContain('Access Level')
    expect(text).toContain('AI Overview visibility')
    expect(text).toContain('AI answers. Strong branded')
    expect(text).toContain('new-to-brand')
    expect(text).toContain('medium-priority')
    expect(text).toContain('Code Required: engineering')
    expect(text).toContain('FAQPage JSON-LD')
    expect(text).toContain('answer-block')
    expect(text).not.toContain('Al Overview visibility')
    expect(text).not.toContain('CodeRequired')
    expect(text).toContain('Public Site Discoverability')
    expect(text).toContain('URL-only audit section uses public website signals')
    expect(text).toContain('directional AI visibility evidence')
  })
})
