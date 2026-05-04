import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
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
  buildRunReportData: buildRunReportDataMock,
  buildCharts: vi.fn(() => ({
    scoreTrend: '<svg></svg>',
    visibilityTrend: '<svg></svg>',
    queryTypeBar: '<svg></svg>',
    recommendationBar: '<svg></svg>',
    competitorBar: '<svg></svg>',
  })),
}))

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid format', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1&format=csv')
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid format. Allowed values: markdown, html, pdf',
    })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 403 when run property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { property_id: 'property-1' },
                error: null,
              }),
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(buildRunReportDataMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the run is not completed', async () => {
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
                data: { property_id: 'property-1', status: 'running' },
                error: null,
              }),
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1')
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Export requires a completed run',
      currentStatus: 'running',
    })
    expect(buildRunReportDataMock).not.toHaveBeenCalled()
  })

  it('builds the export from the validated service-client run snapshot', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { property_id: 'property-1', status: 'completed' },
                error: null,
              }),
            })),
          })),
        }
      }),
    }
    createServiceClientMock.mockReturnValue(serviceClient)

    buildRunReportDataMock.mockResolvedValue({
      property: { name: 'P11 Local Demo Property' },
      runs: [{ surface: 'openai', model_name: 'gpt-5.2', started_at: '2026-03-16T00:00:00.000Z' }],
      surfaceSummaries: [
        {
          surface: 'chatgpt',
          label: 'ChatGPT',
          measurementNote: 'Grounded API proxy for ChatGPT-style answer measurement.',
          lastRunAt: '2026-03-16T00:00:00.000Z',
          overallScore: 75,
          visibilityPct: 50,
        },
      ],
      siteAudit: {
        accessMode: 'URLOnly',
        websiteUrl: 'https://demo.example',
        normalizedOrigin: 'https://demo.example',
        homepageReachable: true,
        robotsTxtReachable: true,
        sitemapReachable: false,
        llmsTxtReachable: false,
        title: 'Demo',
        metaDescription: 'Demo',
        structuredDataTypes: [],
        faqStructuredData: false,
        organizationStructuredData: false,
        answerBlockSignals: 0,
        internalLinkCount: 1,
        notes: ['No JSON-LD structured data was detected on the homepage.'],
      },
      scores: [{ overall_score: 75, visibility_pct: 50, avg_llm_rank: 2, avg_link_rank: 3, avg_sov: 0.2, breakdown: { position: 75, link: 60, sov: 40, accuracy: 90 } }],
      answers: [],
      recommendations: [
        {
          id: 'rec-1',
          type: 'citation_opportunity',
          priority: 'high',
          title: 'Target a cited directory',
          description: 'This directory appears often in answers.',
          accessLevel: 'ThirdParty',
          owner: 'partnerships',
          status: 'todo',
          targetUrl: null,
          targetPageType: 'third_party_listing',
          evidenceMode: 'URLOnly',
          keywords: ['directory'],
          impact: { score: 90, reason: 'Influential citation source' },
          actionItems: ['Request listing inclusion'],
          relatedQueries: [],
        },
      ],
      recommendationSummary: { total: 0, high: 0, medium: 0, low: 0 },
      queryTypeStats: [],
      citationSummary: { total: 0, brandPct: 0 },
      glossary: [],
      insights: { highlights: [] },
      narrative: null,
      competitors: [],
      trends: [],
      aiOverviewSummary: { totalTracked: 0, visibleCount: 0, visibilityPct: 0, byType: [] },
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/markdown')
    expect(response.headers.get('X-PropertyAudit-Artifact-Format')).toBe('markdown')
    expect(buildRunReportDataMock).toHaveBeenCalledWith(serviceClient, 'run-1')
    const markdown = await response.text()
    expect(markdown).toContain('Executive Snapshot')
    expect(markdown).toContain('Action Plan')
    expect(markdown).toContain('Citation Targets')
    expect(markdown).toContain('Access Level')
    expect(markdown).toContain('URL-Only Readiness Note')
  })

  it('treats pdf export as print-view html', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { property_id: 'property-1', status: 'completed' },
                error: null,
              }),
            })),
          })),
        }
      }),
    }
    createServiceClientMock.mockReturnValue(serviceClient)

    buildRunReportDataMock.mockResolvedValue({
      property: { name: 'P11 Local Demo Property' },
      runs: [{ surface: 'openai', model_name: 'gpt-5.2', started_at: '2026-03-16T00:00:00.000Z' }],
      surfaceSummaries: [],
      siteAudit: {
        accessMode: 'URLOnly',
        websiteUrl: null,
        normalizedOrigin: null,
        homepageReachable: false,
        robotsTxtReachable: false,
        sitemapReachable: false,
        llmsTxtReachable: false,
        title: null,
        metaDescription: null,
        structuredDataTypes: [],
        faqStructuredData: false,
        organizationStructuredData: false,
        answerBlockSignals: 0,
        internalLinkCount: 0,
        notes: [],
      },
      scores: [{ overall_score: 75, visibility_pct: 50, avg_llm_rank: 2, avg_link_rank: 3, avg_sov: 0.2, breakdown: { position: 75, link: 60, sov: 40, accuracy: 90 } }],
      answers: [],
      recommendations: [],
      recommendationSummary: { total: 0, high: 0, medium: 0, low: 0 },
      queryTypeStats: [],
      citationSummary: { total: 0, brandPct: 0 },
      glossary: [],
      insights: { highlights: [] },
      narrative: null,
      competitors: [],
      trends: [],
      aiOverviewSummary: { totalTracked: 0, visibleCount: 0, visibilityPct: 0, byType: [] },
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/export?runId=run-1&format=pdf')
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('X-PropertyAudit-Artifact-Format')).toBe('pdf_print_view')
    expect(html).toContain('GEO Visibility Report')
  })
})
