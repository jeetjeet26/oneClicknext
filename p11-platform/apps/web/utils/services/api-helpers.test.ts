import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import {
  buildCorsHeaders,
  hasValidCronAuth,
  hasValidInternalApiKey,
  safeError,
  unauthorized,
  validateCronAuth,
} from './api-helpers'

describe('api helpers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns a sanitized error response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = safeError('Nope', 500, new Error('sensitive details'), {
      'x-request-id': 'req-1',
    })

    expect(response.status).toBe(500)
    expect(response.headers.get('x-request-id')).toBe('req-1')
    await expect(response.json()).resolves.toEqual({ error: 'Nope' })

    errorSpy.mockRestore()
  })

  it('builds permissive dev cors headers', () => {
    Object.assign(process.env, { NODE_ENV: 'development' })

    const headers = buildCorsHeaders('http://localhost:3000')

    expect(headers['Access-Control-Allow-Origin']).toBe(
      'http://localhost:3000'
    )
  })

  it('restricts production cors headers to configured origins', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      LUMALEASING_ALLOWED_ORIGINS:
        'https://allowed.example,https://www.allowed.example',
    })

    const allowed = buildCorsHeaders('https://allowed.example')
    const blocked = buildCorsHeaders('https://blocked.example')

    expect(allowed['Access-Control-Allow-Origin']).toBe(
      'https://allowed.example'
    )
    expect(blocked['Access-Control-Allow-Origin']).toBe('')
  })

  it('builds an unauthorized response', async () => {
    const response = unauthorized({ 'x-request-id': 'req-2' })

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBe('req-2')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  describe('validateCronAuth', () => {
    it('returns null when CRON_SECRET is unset (allows local dev)', () => {
      delete process.env.CRON_SECRET
      const req = new Request('http://localhost/api/cron/test', { headers: {} })
      expect(validateCronAuth(req)).toBeNull()
    })

    it('returns null when Bearer token matches CRON_SECRET', () => {
      process.env.CRON_SECRET = 'my-secret'
      const req = new Request('http://localhost/api/cron/test', {
        headers: { authorization: 'Bearer my-secret' },
      })
      expect(validateCronAuth(req)).toBeNull()
    })

    it('returns 401 response when Bearer token is wrong', async () => {
      process.env.CRON_SECRET = 'my-secret'
      const req = new Request('http://localhost/api/cron/test', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
      const res = validateCronAuth(req)
      expect(res).not.toBeNull()
      expect(res!.status).toBe(401)
      await expect(res!.json()).resolves.toEqual({ error: 'Unauthorized' })
    })

    it('returns 401 when no authorization header', async () => {
      process.env.CRON_SECRET = 'my-secret'
      const req = new Request('http://localhost/api/cron/test', { headers: {} })
      const res = validateCronAuth(req)
      expect(res).not.toBeNull()
      expect(res!.status).toBe(401)
    })
  })

  describe('hasValidCronAuth', () => {
    it('returns false when CRON_SECRET is unset', () => {
      delete process.env.CRON_SECRET
      const req = new Request('http://localhost/api/cron/test', { headers: {} })
      expect(hasValidCronAuth(req)).toBe(false)
    })

    it('returns true when Bearer token matches CRON_SECRET', () => {
      process.env.CRON_SECRET = 'my-secret'
      const req = new Request('http://localhost/api/cron/test', {
        headers: { authorization: 'Bearer my-secret' },
      })
      expect(hasValidCronAuth(req)).toBe(true)
    })

    it('returns false when Bearer token does not match CRON_SECRET', () => {
      process.env.CRON_SECRET = 'my-secret'
      const req = new Request('http://localhost/api/cron/test', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
      expect(hasValidCronAuth(req)).toBe(false)
    })
  })

  describe('hasValidInternalApiKey', () => {
    it('returns false when INTERNAL_API_KEY is unset', () => {
      delete process.env.INTERNAL_API_KEY
      const req = new Request('http://localhost/api/internal/test', { headers: {} })
      expect(hasValidInternalApiKey(req)).toBe(false)
    })

    it('returns true when Bearer token matches INTERNAL_API_KEY', () => {
      process.env.INTERNAL_API_KEY = 'internal-secret'
      const req = new Request('http://localhost/api/internal/test', {
        headers: { authorization: 'Bearer internal-secret' },
      })
      expect(hasValidInternalApiKey(req)).toBe(true)
    })

    it('returns false when Bearer token does not match INTERNAL_API_KEY', () => {
      process.env.INTERNAL_API_KEY = 'internal-secret'
      const req = new Request('http://localhost/api/internal/test', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
      expect(hasValidInternalApiKey(req)).toBe(false)
    })
  })
})
