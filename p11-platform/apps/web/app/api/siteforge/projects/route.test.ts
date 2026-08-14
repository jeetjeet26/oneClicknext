import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const createOrReuseProject = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'project-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/siteforge/projects/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/projects/repository')
  >('@/utils/siteforge/projects/repository')
  return {
    ...actual,
    createOrReuseSiteForgeProject: createOrReuseProject,
  }
})

const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'

describe('/api/siteforge/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true, orgId: ORG_ID })
    createOrReuseProject.mockResolvedValue({
      reused: false,
      project: {
        websiteId: WEBSITE_ID,
        orgId: ORG_ID,
        propertyId: PROPERTY_ID,
        status: 'planning',
      },
    })
  })

  it('authenticates before creating a project shell', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/projects', {
        method: 'POST',
        body: JSON.stringify({ propertyId: PROPERTY_ID }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    expect(validateAccess).not.toHaveBeenCalled()
    expect(createOrReuseProject).not.toHaveBeenCalled()
  })

  it('accepts Postgres UUID property IDs and preserves tenant identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/projects', {
        method: 'POST',
        body: JSON.stringify({ propertyId: PROPERTY_ID }),
      }) as NextRequest
    )

    expect(response.status).toBe(201)
    expect(validateAccess).toHaveBeenCalledWith('user-1', PROPERTY_ID)
    expect(createOrReuseProject).toHaveBeenCalledWith({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      mode: 'resume',
    })
  })

  it('passes an explicit new-project intent without reusing an abandoned shell', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/projects', {
        method: 'POST',
        body: JSON.stringify({ propertyId: PROPERTY_ID, mode: 'new' }),
      }) as NextRequest
    )

    expect(response.status).toBe(201)
    expect(createOrReuseProject).toHaveBeenCalledWith({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      mode: 'new',
    })
  })

  it('does not create a shell outside the authenticated property scope', async () => {
    validateAccess.mockResolvedValue({ authorized: false, orgId: null })
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/projects', {
        method: 'POST',
        body: JSON.stringify({ propertyId: PROPERTY_ID }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    expect(createOrReuseProject).not.toHaveBeenCalled()
  })
})
