import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { processMock, clientMock, registryMock } = vi.hoisted(() => ({
  processMock: vi.fn(),
  clientMock: {},
  registryMock: {},
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => clientMock,
}))
vi.mock('@/utils/siteforge/operations/handlers', () => ({
  createSiteForgeHandlerRegistry: () => registryMock,
}))
vi.mock('@/utils/siteforge/operations/outbox', () => ({
  processSiteForgeOutbox: processMock,
}))

describe('GET /api/cron/siteforge-outbox', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects an invalid cron secret', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/siteforge-outbox', {
      headers: { authorization: 'Bearer wrong-secret' },
    }) as NextRequest)

    expect(response.status).toBe(401)
    expect(processMock).not.toHaveBeenCalled()
  })

  it('processes leased outbox events with request tracing', async () => {
    processMock.mockResolvedValue({ claimed: 2, delivered: 1, retrying: 1, deadLettered: 0 })
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/siteforge-outbox', {
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      claimed: 2,
      delivered: 1,
    })
    expect(processMock).toHaveBeenCalledWith(
      clientMock,
      registryMock,
      expect.objectContaining({ workerId: expect.stringContaining('siteforge-outbox:') })
    )
  })
})
