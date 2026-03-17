import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

describe('reports send cron auth', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('rejects unauthorized POST requests', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/reports/send', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects unauthorized GET requests', async () => {
    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/reports/send', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
