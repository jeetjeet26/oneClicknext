import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  getUserMock,
  validatePropertyAccessMock,
  decideMock,
  profileSingleMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  decideMock: vi.fn(),
  profileSingleMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.single = profileSingleMock
    return { auth: { getUser: getUserMock }, from: vi.fn(() => builder) }
  }),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/siteforge/artifacts/approval', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/utils/siteforge/artifacts/approval')
    >()
  return {
    ...actual,
    decideSiteForgeArtifactDeployment: decideMock,
  }
})

const artifactId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'

function request(): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/artifacts/${artifactId}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        contentHash: 'a'.repeat(64),
        decisionStatus: 'approved',
        decisionReason: 'Reviewed the exact canonical preview.',
      }),
    }
  ) as NextRequest
}

describe('artifact deployment decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    profileSingleMock.mockResolvedValue({
      data: { role: 'manager' },
      error: null,
    })
    decideMock.mockResolvedValue({
      artifactId,
      contentHash: 'a'.repeat(64),
      decisionStatus: 'approved',
      approvalId: '44444444-4444-4444-8444-444444444444',
    })
  })

  it('requires tenant property access', async () => {
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ artifactId }),
    })
    expect(response.status).toBe(403)
    expect(decideMock).not.toHaveBeenCalled()
  })

  it('records explicit approval for the exact artifact hash', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ artifactId }),
    })
    expect(response.status).toBe(200)
    expect(decideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId,
        propertyId,
        decisionStatus: 'approved',
      })
    )
  })
})
