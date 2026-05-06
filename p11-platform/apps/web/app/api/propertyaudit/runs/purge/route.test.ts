import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

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

describe('propertyaudit runs purge route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 400 when only invalid surfaces are provided', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['not-valid'] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid surfaces.',
    })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('deletes runs for validated surfaces without clearing property-level overview history', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const inMock = vi.fn().mockResolvedValue({ error: null })
    const eqMock = vi.fn(() => ({ in: inMock }))
    const deleteMock = vi.fn(() => ({ eq: eqMock }))

    const fromMock = vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return { delete: deleteMock }
    })
    createServiceClientMock.mockReturnValue({
      from: fromMock,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      propertyId: 'property-1',
      surfaces: ['openai'],
      resetScope: 'run_history',
      aiOverviewsCleared: false,
    })
    expect(inMock).toHaveBeenCalledWith('surface', ['openai'])
    expect(fromMock).not.toHaveBeenCalledWith('geo_ai_overviews')
  })

  it('clears AI Overview history and run history for a full property reset', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const overviewEqMock = vi.fn().mockResolvedValue({ error: null })
    const overviewDeleteMock = vi.fn(() => ({ eq: overviewEqMock }))
    const runsEqMock = vi.fn().mockResolvedValue({ error: null })
    const runsDeleteMock = vi.fn(() => ({ eq: runsEqMock }))

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_ai_overviews') return { delete: overviewDeleteMock }
        if (table === 'geo_runs') return { delete: runsDeleteMock }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      propertyId: 'property-1',
      surfaces: 'all',
      resetScope: 'all_geo_results',
      aiOverviewsCleared: true,
    })
    expect(overviewEqMock).toHaveBeenCalledWith('property_id', 'property-1')
    expect(runsEqMock).toHaveBeenCalledWith('property_id', 'property-1')
  })
})
