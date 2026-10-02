import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const readMock = vi.hoisted(()=>vi.fn())
vi.mock('@/utils/marketvision/analysis-store',()=>({readMarketAnalysis:readMock}))
const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('marketvision analysis route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')

    const response = await GET(makeNextRequest('http://localhost/api/marketvision/analysis?propertyId=property-1'))
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')

    const response = await GET(makeNextRequest('http://localhost/api/marketvision/analysis?propertyId=property-1'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

const property='33333333-3333-3333-3333-333333333333'
describe('report snapshot contract',()=>{
 beforeEach(()=>{vi.clearAllMocks();createClientMock.mockResolvedValue({auth:{getUser:authGetUserMock}});authGetUserMock.mockResolvedValue({data:{user:{id:'actor'}},error:null});validatePropertyAccessMock.mockResolvedValue({authorized:true})})
 it('returns complete unknown-aware evidence with private no-store caching',async()=>{
   readMock.mockResolvedValue({propertyId:property,propertyName:'Test',snapshotAt:'2026-09-22T12:00:00Z',windowStart:'2026-09-15T12:00:00Z',windowDays:7,competitors:[],units:[],history:[],captures:[]})
   const {GET}=await import('./route'),r=await GET(makeNextRequest(`http://localhost/api/marketvision/analysis?propertyId=${property}&days=7&bedrooms=0`))
   expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');const data=await r.json();expect(data.summary.marketTrend).toBe('insufficient_data');expect(data.summary.lastUpdated).toBeNull();expect(readMock).toHaveBeenCalledWith(property,'actor',7)
 })
 it.each(['days=bad','days=0','days=367','bedrooms=1x','days=7&days=30','unitType=A&bedrooms=1','unexpected=true'])('rejects malformed or ambiguous filters %s',async query=>{const {GET}=await import('./route');const r=await GET(makeNextRequest(`http://localhost/api/marketvision/analysis?propertyId=${property}&${query}`));expect(r.status).toBe(400);expect(readMock).not.toHaveBeenCalled()})
 it('does not turn an unavailable snapshot into an empty report',async()=>{readMock.mockRejectedValue(new Error('db unavailable'));const {GET}=await import('./route');const r=await GET(makeNextRequest(`http://localhost/api/marketvision/analysis?propertyId=${property}`));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('summary')})
})
