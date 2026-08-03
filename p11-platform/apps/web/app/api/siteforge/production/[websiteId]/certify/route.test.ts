import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authGetUser,
  createClient,
  createServiceClient,
  validatePropertyAccess,
  serviceFrom,
  profileFrom,
} = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  validatePropertyAccess: vi.fn(),
  serviceFrom: vi.fn(),
  profileFrom: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess }))
vi.mock('workflow/api', () => ({ start: vi.fn() }))
vi.mock('@/utils/siteforge/wordpress/credential-vault', () => ({
  getWordPressCredentialReference: vi.fn(),
}))
vi.mock('@/workflows/siteforge-production-certification', () => ({
  siteForgeProductionCertificationWorkflow: vi.fn(),
}))

const websiteId = '11111111-1111-4111-8111-111111111111'
const artifactId = '22222222-2222-4222-8222-222222222222'
const releaseId = '55555555-5555-4555-8555-555555555555'
const routeContext = { params: Promise.resolve({ websiteId }) }

function builder(result: unknown) {
  const value: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) value[method] = vi.fn(() => value)
  value.single = vi.fn().mockResolvedValue(result)
  return value
}

function request(
  contentHash = 'a'.repeat(64),
  extra: Record<string, unknown> = {}
) {
  return new Request(
    `http://localhost/api/siteforge/production/${websiteId}/certify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        releaseId,
        promotedArtifactId: artifactId,
        promotedContentHash: contentHash,
        ...extra,
      }),
    }
  ) as NextRequest
}

describe('SiteForge production certification route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue({
      auth: { getUser: authGetUser },
      from: profileFrom,
    })
    createServiceClient.mockReturnValue({ from: serviceFrom })
  })

  it('rejects caller-supplied browser certification evidence', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      request('a'.repeat(64), {
        protectedBrowserEvidence: { passed: true },
      }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(authGetUser).not.toHaveBeenCalled()
  })

  it('requires an authenticated operator', async () => {
    authGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('./route')

    const response = await POST(request(), routeContext)

    expect(response.status).toBe(401)
    expect(serviceFrom).not.toHaveBeenCalled()
  })

  it('rejects a promotion identity that differs from certified staging', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyAccess.mockResolvedValue({ authorized: true })
    serviceFrom.mockReturnValueOnce(
      builder({
        data: {
          id: websiteId,
          org_id: '33333333-3333-4333-8333-333333333333',
          property_id: '44444444-4444-4444-8444-444444444444',
          wordpress_credential_ref: 'vault-ref',
          target_domain: 'property.example.com',
          staging_artifact_id: artifactId,
          staging_content_hash: 'a'.repeat(64),
          staging_certified_at: '2026-07-31T12:00:00.000Z',
        },
        error: null,
      })
    )
    profileFrom.mockReturnValue(
      builder({ data: { role: 'admin' }, error: null })
    )
    const { POST } = await import('./route')

    const response = await POST(request('b'.repeat(64)), routeContext)

    expect(response.status).toBe(409)
    expect(serviceFrom).toHaveBeenCalledTimes(1)
  })
})
