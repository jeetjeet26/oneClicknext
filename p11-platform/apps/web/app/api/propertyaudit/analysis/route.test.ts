import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const readMeasurementsMock = vi.fn()
vi.mock('@/utils/propertyaudit/read-measurements', () => ({readMeasurements:readMeasurementsMock}))

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
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

describe('propertyaudit analysis route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const request = makeNextRequest('http://localhost/api/propertyaudit/analysis?propertyId=property-1', {
      method: 'GET',
    })

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { GET } = await import('./route')
    const request = makeNextRequest('http://localhost/api/propertyaudit/analysis?propertyId=property-1', {
      method: 'GET',
    })

    const response = await GET(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('GET returns 403 when batch resolves to unauthorized property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [{ property_id: 'property-1' }],
                error: null,
              }),
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const request = makeNextRequest('http://localhost/api/propertyaudit/analysis?batchId=batch-1', {
      method: 'GET',
    })

    const response = await GET(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('retires unrecorded model execution without reading or writing provider data', async () => {
    const {POST}=await import('./route')
    const response=await POST()
    expect(response.status).toBe(410)
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
  })
  it('never lets an allowed property authorize a different property batch', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    readMeasurementsMock.mockImplementation(async (actor, property, input) => ({state:'ready',batchId:input.batchId,runs:property === 'allowed-property' ? [] : [{run:{id:'private',cross_model_analysis:'PRIVATE OTHER PROPERTY ANALYSIS'},scores:[]}]}))
    const {GET}=await import('./route')
    const response=await GET(makeNextRequest('http://localhost/api/propertyaudit/analysis?propertyId=allowed-property&batchId=foreign-batch'))
    expect(validatePropertyAccessMock).toHaveBeenCalledWith('user-1','allowed-property')
    expect(readMeasurementsMock).toHaveBeenCalledWith('user-1','allowed-property',{kind:'batch',batchId:'foreign-batch'})
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('PRIVATE OTHER PROPERTY ANALYSIS')
  })

})
