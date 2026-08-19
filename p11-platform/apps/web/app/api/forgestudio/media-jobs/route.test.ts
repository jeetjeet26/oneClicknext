import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authMock, accessMock, enqueueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  accessMock: vi.fn(),
  enqueueMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: authMock },
  }),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: accessMock,
}))
vi.mock('@/utils/forgestudio/media-jobs', () => ({
  MEDIA_JOB_DOMAIN: 'forgestudio.media',
  enqueueMediaGeneration: enqueueMock,
}))

describe('POST /api/forgestudio/media-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    accessMock.mockResolvedValue({ authorized: true, orgId: '11111111-1111-4111-8111-111111111111' })
    enqueueMock.mockResolvedValue({ id: 'job-1', lifecycle_status: 'queued' })
  })

  it('requires authentication', async () => {
    authMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/forgestudio/media-jobs', {
      method: 'POST',
      body: '{}',
    }) as NextRequest)
    expect(response.status).toBe(401)
  })

  it('enqueues validated, property-scoped media work', async () => {
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/forgestudio/media-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: '22222222-2222-4222-8222-222222222222',
        modality: 'image',
        tier: 'final',
        prompt: 'Create campaign art using the approved property identity.',
        aspectRatio: '1:1',
        altText: 'Campaign artwork for the property',
        name: 'Campaign art',
        maxCostUsd: 1,
      }),
    }) as NextRequest)

    expect(response.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: '22222222-2222-4222-8222-222222222222',
      actorId: 'user-1',
      request: expect.objectContaining({ modality: 'image', tier: 'final' }),
    }))
  })
})
