import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authorizeWebsite, listIncidents } = vi.hoisted(() => ({
  authorizeWebsite: vi.fn(),
  listIncidents: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: authorizeWebsite,
}))
vi.mock('@/utils/siteforge/incidents', () => ({
  listSiteForgeIncidents: listIncidents,
}))

const websiteId = '11111111-1111-4111-8111-111111111111'

function request(id = websiteId): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/incidents?websiteId=${id}`
  ) as NextRequest
}

describe('SiteForge incidents route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeWebsite.mockResolvedValue({
      user: { id: '22222222-2222-4222-8222-222222222222' },
      website: { id: websiteId },
    })
    listIncidents.mockResolvedValue([
      { id: '33333333-3333-4333-8333-333333333333', status: 'open' },
    ])
  })

  it('validates the website identifier before authorization', async () => {
    const { GET } = await import('./route')
    const response = await GET(request('not-a-uuid'))

    expect(response.status).toBe(400)
    expect(authorizeWebsite).not.toHaveBeenCalled()
  })

  it('does not list incidents without tenant website access', async () => {
    authorizeWebsite.mockResolvedValue({ error: 'Forbidden', status: 403 })
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(authorizeWebsite).toHaveBeenCalledWith(websiteId)
    expect(listIncidents).not.toHaveBeenCalled()
  })

  it('lists incidents for an authorized website', async () => {
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      { id: '33333333-3333-4333-8333-333333333333', status: 'open' },
    ])
    expect(listIncidents).toHaveBeenCalledWith(websiteId)
  })
})
