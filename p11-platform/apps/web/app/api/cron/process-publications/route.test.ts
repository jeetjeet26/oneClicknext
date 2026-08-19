import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { processMock } = vi.hoisted(() => ({
  processMock: vi.fn(),
}))

vi.mock('@/utils/forgestudio/publication-worker', () => ({
  processDuePublications: processMock,
}))

describe('GET /api/cron/process-publications', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects invalid cron authentication', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request(
      'http://localhost/api/cron/process-publications',
      { headers: { authorization: 'Bearer wrong-secret' } }
    ) as NextRequest)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(processMock).not.toHaveBeenCalled()
  })

  it('processes canonical publications with request tracing', async () => {
    processMock.mockResolvedValue({
      claimed: 2,
      results: [{ publicationId: 'publication-1', status: 'published' }],
    })
    const { GET } = await import('./route')
    const response = await GET(new Request(
      'http://localhost/api/cron/process-publications',
      { headers: { authorization: 'Bearer expected-secret' } }
    ) as NextRequest)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      claimed: 2,
    })
    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({
      workerId: expect.stringContaining('cron:'),
      limit: 5,
    }))
  })
})
