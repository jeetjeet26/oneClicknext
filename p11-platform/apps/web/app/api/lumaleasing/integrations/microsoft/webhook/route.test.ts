import { describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'

describe('Microsoft integration webhook route', () => {
  it('echoes Microsoft Graph validation tokens', async () => {
    const { POST } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integrations/microsoft/webhook?validationToken=abc123',
      { method: 'POST' }
    ) as NextRequest
    Object.defineProperty(request, 'nextUrl', {
      value: new URL(request.url),
      configurable: true,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('abc123')
  })
})
