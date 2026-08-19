import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: vi.fn(),
}))
vi.mock('workflow/api', () => ({ start: vi.fn() }))
vi.mock('@/workflows/siteforge-canonical-preview', () => ({
  siteForgeCanonicalPreviewWorkflow: vi.fn(),
}))

function request(): NextRequest {
  return new NextRequest(
    'http://localhost/api/siteforge/canonical-preview/11111111-1111-4111-8111-111111111111',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifactId: '22222222-2222-4222-8222-222222222222',
        contentHash: 'a'.repeat(64),
      }),
    }
  )
}

function statusRequest(jobId = '33333333-3333-4333-8333-333333333333') {
  return new NextRequest(
    `http://localhost/api/siteforge/canonical-preview/11111111-1111-4111-8111-111111111111?jobId=${jobId}`
  )
}

describe('canonical WordPress preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('rejects an invalid website identifier before side effects', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })

  it('requires authentication for canonical render jobs', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({
        websiteId: '11111111-1111-4111-8111-111111111111',
      }),
    })
    expect(response.status).toBe(401)
  })

  it('validates the job-specific status identity before querying', async () => {
    const { GET } = await import('./route')
    const response = await GET(statusRequest('invalid'), {
      params: Promise.resolve({
        websiteId: '11111111-1111-4111-8111-111111111111',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('requires authentication when polling canonical render status', async () => {
    const { GET } = await import('./route')
    const response = await GET(statusRequest(), {
      params: Promise.resolve({
        websiteId: '11111111-1111-4111-8111-111111111111',
      }),
    })
    expect(response.status).toBe(401)
  })

  it('uses the exact immutable artifact identity for preview deduplication', async () => {
    const { canonicalPreviewDedupeKey } = await import(
      '@/utils/siteforge/workflows/canonical-preview-queue'
    )
    expect(
      canonicalPreviewDedupeKey(
        '22222222-2222-4222-8222-222222222222',
        'a'.repeat(64)
      )
    ).toBe(
      `siteforge-preview:22222222-2222-4222-8222-222222222222:${'a'.repeat(64)}`
    )
  })
})
