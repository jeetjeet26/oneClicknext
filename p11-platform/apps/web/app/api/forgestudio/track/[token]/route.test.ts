import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { recordMock, singleMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  singleMock: vi.fn(),
}))

vi.mock('@/utils/forgestudio/attribution', () => ({
  recordAttributionEvent: recordMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: singleMock,
        }),
      }),
    }),
  }),
}))

describe('GET /api/forgestudio/track/[token]', () => {
  it('records an anonymous landing view and redirects', async () => {
    singleMock.mockResolvedValue({
      data: {
        social_content_variants: { link_url: 'https://property.example.com/tours' },
      },
      error: null,
    })
    recordMock.mockResolvedValue({ recorded: true, publicationId: 'publication-1' })
    const { GET } = await import('./route')
    const response = await GET(new Request(
      'http://localhost/api/forgestudio/track/token-1',
      {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'user-agent': 'test-agent',
        },
      }
    ) as NextRequest, { params: Promise.resolve({ token: 'token-1' }) })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://property.example.com/tours')
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'landing_view',
      trackingToken: 'token-1',
    }))
  })
})
