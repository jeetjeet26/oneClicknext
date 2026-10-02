import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {NextRequest} from 'next/server'
const mocks = vi.hoisted(() => ({auth: vi.fn(), access: vi.fn(), find: vi.fn(), record: vi.fn(), rate: vi.fn()}))
vi.mock('@/utils/supabase/server', () => ({createClient: async () => ({auth: {getUser: mocks.auth}})}))
vi.mock('@/utils/supabase/admin', () => ({createServiceClient: () => ({})}))
vi.mock('@/utils/services/auth-guard', () => ({validatePropertyAccess: mocks.access}))
vi.mock('@/utils/services/tour-outcomes', async original => ({...await original<object>(), findTourForOutcome: mocks.find, recordTourOutcome: mocks.record}))
vi.mock('@/utils/services/rate-limiter', () => ({adminLimiter: {check: mocks.rate}, getRateLimitKey: () => 'test', rateLimitHeaders: () => ({})}))
vi.mock('@/utils/services/audit-logger', () => ({auditLog: vi.fn(), getRequestIp: () => '127.0.0.1'}))
import {POST} from './route'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function request(body: unknown = {tourId: id,requestId:id}) {return new Request('http://localhost/api/tours/complete', {method: 'POST', body: JSON.stringify(body)}) as NextRequest}
describe('tour completion API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rate.mockReturnValue({allowed: true})
    mocks.auth.mockResolvedValue({data: {user: {id: 'user'}}, error: null})
    mocks.access.mockResolvedValue({authorized: true})
    mocks.find.mockResolvedValue({id, property_id: 'property', lead_id: 'lead', source: 'tours'})
    mocks.record.mockResolvedValue({state: 'applied', outcome: {outcome_at: '2026-09-15T12:00:00Z', followup_state: 'configured'}})
  })
  it('rejects unauthenticated writes before lookup', async () => {
    mocks.auth.mockResolvedValue({data: {user: null}})
    expect((await POST(request())).status).toBe(401); expect(mocks.find).not.toHaveBeenCalled()
  })
  it('rejects property access before mutation', async () => {
    mocks.access.mockResolvedValue({authorized: false})
    expect((await POST(request())).status).toBe(403); expect(mocks.record).not.toHaveBeenCalled()
  })
  it('validates identifiers and malformed JSON', async () => {
    expect((await POST(request({tourId: 'bad'}))).status).toBe(400)
    expect((await POST(new Request('http://localhost/api/tours/complete', {method:'POST', body:'{bad'}) as NextRequest)).status).toBe(400)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('reports a missing tour with request identity', async () => {
    mocks.find.mockResolvedValue(null)
    const response = await POST(request()); expect(response.status).toBe(404); expect(response.headers.get('x-request-id')).toBeTruthy()
  })
  it('completes either source through the atomic operation', async () => {
    const response = await POST(request({tourId: id,requestId:id, notes: 'Attended'}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({success: true, replayed: false, followup: 'configured', tour: {id, status: 'completed'}})
    expect(mocks.record).toHaveBeenCalledWith({propertyId: 'property', leadId: 'lead', source: 'tours', tourId: id, outcome: 'completed', notes: 'Attended',actorId:'user',requestId:id}, {})
  })
  it('replays the original saved completion timestamp', async () => {
    mocks.record.mockResolvedValue({state: 'replayed', outcome: {outcome_at: '2026-09-01T12:00:00Z', followup_state: 'not_configured'}})
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({replayed: true, tour: {completedAt: '2026-09-01T12:00:00Z'}})
  })
  it.each(['conflict','not_due','delivery_busy'])('does not report %s as a completion', async state => {
    mocks.record.mockResolvedValue({state})
    expect((await POST(request())).status).toBe(409)
  })
  it('does not report failed persistence as success', async () => {
    mocks.record.mockRejectedValue(new Error('write unavailable'))
    expect((await POST(request())).status).toBe(500)
  })
})
