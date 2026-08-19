import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }))

vi.mock('@/utils/forgestudio/attribution', () => ({
  recordAttributionEvent: recordMock,
}))

describe('POST /api/forgestudio/attribution', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function request(body: unknown, secret = 'expected-secret') {
    return new Request('http://localhost/api/forgestudio/attribution', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }) as NextRequest
  }

  it('rejects unauthenticated outcome writes', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({}, 'wrong'))
    expect(response.status).toBe(401)
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('records a validated anonymous leasing outcome', async () => {
    recordMock.mockResolvedValue({ recorded: true, publicationId: 'publication-1' })
    const { POST } = await import('./route')
    const response = await POST(request({
      trackingToken: '11111111-1111-4111-8111-111111111111',
      eventType: 'tour_booked',
      anonymousSubject: 'provider-neutral-subject-123',
      metadata: {
        sourceSystem: 'crm',
        sourceEventId: 'event-1',
        attributionConfidence: 0.8,
      },
    }))
    expect(response.status).toBe(201)
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'tour_booked',
      anonymousSubject: 'provider-neutral-subject-123',
    }))
  })
})
