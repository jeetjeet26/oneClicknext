import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/utils/intelligence/recommendations', () => ({ generatePropertyRecommendations: mocks.generate }))
import { IntelligenceError } from '@/utils/intelligence/store'
import { POST } from './route'
const propertyId = '11111111-1111-4111-8111-111111111111'
const body = { propertyId, start: '2026-10-01', end: '2026-10-31' }
const request = (value: unknown, origin = 'http://localhost') => new NextRequest('http://localhost/api/intelligence/recommendations', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(value) })
beforeEach(() => { vi.clearAllMocks(); mocks.generate.mockResolvedValue({ document: { id: 'report' }, reused: false }) })
it('requires same-origin generation and an explicit valid community and closed reporting window', async () => {
  expect((await POST(request(body, 'https://unrelated.example'))).status).toBe(403)
  for (const value of [{ start: body.start, end: body.end }, { ...body, actorId: propertyId }, { ...body, end: '2099-01-01' }, { ...body, start: '2026-11-01' }]) {
    expect((await POST(request(value))).status).toBe(400)
  }
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('delegates only the selected property and dates, returning a private non-cached analysis', async () => {
  const response = await POST(request(body))
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(mocks.generate).toHaveBeenCalledWith(propertyId, body.start, body.end)
})
it('preserves authentication and property authorization failures without leaking provider errors', async () => {
  for (const status of [401, 403]) {
    mocks.generate.mockRejectedValueOnce(new IntelligenceError('Access unavailable', status))
    expect((await POST(request(body))).status).toBe(status)
  }
  mocks.generate.mockRejectedValueOnce(new Error('Sensitive provider URL and credentials'))
  const response = await POST(request(body))
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('credentials')
})
