import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authorizeWebsite, buildReport, csv } = vi.hoisted(() => ({
  authorizeWebsite: vi.fn(),
  buildReport: vi.fn(),
  csv: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: authorizeWebsite,
}))
vi.mock('@/utils/siteforge/operations/analytics', () => ({
  buildSiteForgeOwnershipReport: buildReport,
  siteForgeReportCsv: csv,
}))

const websiteId = '11111111-1111-4111-8111-111111111111'

function request(query = `websiteId=${websiteId}`) {
  return new Request(
    `http://localhost/api/siteforge/reporting?${query}`
  ) as NextRequest
}

describe('SiteForge reporting route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeWebsite.mockResolvedValue({
      website: {
        id: websiteId,
        org_id: 'org-1',
        property_id: 'property-1',
      },
      service: { from: vi.fn() },
    })
    buildReport.mockResolvedValue({
      website: { id: websiteId },
      funnels: [],
      gaps: {},
    })
    csv.mockReturnValue('"artifact_id","sessions"\n')
  })

  it('validates the reporting scope before authorization', async () => {
    const { GET } = await import('./route')
    const response = await GET(request('websiteId=invalid'))
    expect(response.status).toBe(400)
    expect(authorizeWebsite).not.toHaveBeenCalled()
  })

  it('does not expose another tenant report', async () => {
    authorizeWebsite.mockResolvedValue({ error: 'Forbidden', status: 403 })
    const { GET } = await import('./route')
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(buildReport).not.toHaveBeenCalled()
  })

  it('builds an artifact-aware report with the authorized service', async () => {
    const { GET } = await import('./route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(buildReport).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Function) }),
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: 'property-1',
        websiteId,
      })
    )
  })

  it('exports CSV without invoking a delivery provider', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(`websiteId=${websiteId}&format=csv`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain(websiteId)
    expect(await response.text()).toContain('artifact_id')
  })
})
