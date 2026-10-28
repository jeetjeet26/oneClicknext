import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({auth: vi.fn(), fetch: vi.fn()}))
vi.mock('@/utils/marketvision/decision-store', async () => ({...await vi.importActual<object>('@/utils/marketvision/decision-store'), requireMarketOperator: mocks.auth}))
vi.mock('@/utils/services/runtime-config', () => ({getDataEngineUrl: () => 'https://engine.example', getDataEngineHeaders: () => ({'X-API-Key': 'test-key'})}))
import { POST } from './route'
import { MarketStoreError } from '@/utils/marketvision/decision-store'
const propertyId = '11111111-1111-1111-1111-111111111111'
const body = {propertyId, radiusMiles: 3, maxCompetitors: 20}
const request = (input = body) => new NextRequest('http://localhost/api/marketvision/discover', {method: 'POST', body: JSON.stringify(input)})
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false'); mocks.auth.mockResolvedValue('actor') })
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs()})
it('authorizes property access and searches without automatic additions or price imports', async () => {
  mocks.fetch.mockResolvedValue(Response.json({success: true, data: {success: true, property_name: 'Subject', competitors: [{name: 'Nearby', address: '123 Main', website_url: 'https://example.com', units: [{rent_min: 2000}]}]}}))
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(mocks.auth).toHaveBeenCalledWith(propertyId)
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({property_id: propertyId, radius_miles: 3, max_competitors: 20, auto_add: false})
  const data = await response.json()
  expect(data.candidates[0].values).toMatchObject({name: 'Nearby', website_url: 'https://example.com'})
  expect(data.candidates[0].values).not.toHaveProperty('units')
})
it('does not contact the engine without access', async () => {
  mocks.auth.mockRejectedValue(new MarketStoreError('Forbidden', 403))
  expect((await POST(request())).status).toBe(403)
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it('honors the outbound pause', async () => {
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'true')
  expect((await POST(request())).status).toBe(409)
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it.each([0, 26])('rejects an invalid search radius of %s', async radiusMiles => {
  expect((await POST(request({...body, radiusMiles}))).status).toBe(400)
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it('does not misreport a failed engine response as zero results or leak provider details', async () => {
  mocks.fetch.mockResolvedValue(Response.json({detail: 'secret provider error'}, {status: 500}))
  const response = await POST(request())
  expect(response.status).toBe(503)
  expect(JSON.stringify(await response.json())).not.toContain('secret')
})
it('rejects malformed successful responses', async () => {
  mocks.fetch.mockResolvedValue(Response.json({success: true}))
  expect((await POST(request())).status).toBe(502)
})
