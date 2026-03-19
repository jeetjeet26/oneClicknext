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

describe('analytics upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(),
    })
  })

  it('returns 401 for POST when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/analytics/upload', {
        method: 'POST',
        body: JSON.stringify({
          csvContent: 'date,impressions\n2026-01-01,100',
          filename: 'report.csv',
          campaignName: 'Campaign 1',
          propertyId: 'property-1',
          platform: 'meta',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: 'Unauthorized',
    })
  })

  it('returns 403 for POST when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/analytics/upload', {
        method: 'POST',
        body: JSON.stringify({
          csvContent: 'date,impressions\n2026-01-01,100',
          filename: 'report.csv',
          campaignName: 'Campaign 1',
          propertyId: 'property-1',
          platform: 'meta',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: 'Forbidden',
    })
  })

  it('returns 403 for GET when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/analytics/upload?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for POST when user role cannot upload marketing data', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const profileSingleMock = vi.fn().mockResolvedValue({
      data: { role: 'member' },
      error: null,
    })
    const profileEqMock = vi.fn(() => ({ single: profileSingleMock }))
    const profileSelectMock = vi.fn(() => ({ eq: profileEqMock }))
    const fromMock = vi.fn((table: string) => {
      if (table === 'profiles') {
        return { select: profileSelectMock }
      }
      return { select: vi.fn() }
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/analytics/upload', {
        method: 'POST',
        body: JSON.stringify({
          csvContent: 'Date,Impressions,Clicks,Cost,Conversions\n2026-01-01,100,10,$50.00,2',
          filename: 'report.csv',
          campaignName: 'Campaign 1',
          propertyId: 'property-1',
          platform: 'google_ads',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: 'Forbidden',
      errors: ['Permission denied'],
    })
  })

  it('uses service client writes for successful POST upload', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const profileSingleMock = vi.fn().mockResolvedValue({
      data: { role: 'manager' },
      error: null,
    })
    const profileEqMock = vi.fn(() => ({ single: profileSingleMock }))
    const profileSelectMock = vi.fn(() => ({ eq: profileEqMock }))
    const fromMock = vi.fn((table: string) => {
      if (table === 'profiles') {
        return { select: profileSelectMock }
      }
      return { select: vi.fn() }
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })

    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const adminFromMock = vi.fn((table: string) => {
      if (table === 'fact_marketing_performance') {
        return { upsert: upsertMock }
      }
      if (table === 'marketing_data_uploads') {
        return { insert: insertMock }
      }
      return { upsert: upsertMock, insert: insertMock }
    })
    createServiceClientMock.mockReturnValue({ from: adminFromMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/analytics/upload', {
        method: 'POST',
        body: JSON.stringify({
          csvContent: 'Date,Impressions,Clicks,Cost,Conversions\n2026-01-01,100,10,$50.00,2',
          filename: 'report.csv',
          campaignName: 'Campaign 1',
          propertyId: 'property-1',
          platform: 'google_ads',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      imported: {
        reportType: 'time_series',
      },
    })
    expect(adminFromMock).toHaveBeenCalledWith('fact_marketing_performance')
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const upsertRecords = upsertMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(Array.isArray(upsertRecords)).toBe(true)
    expect(upsertRecords[0]).toMatchObject({
      property_id: 'property-1',
      channel_id: 'google_ads',
      campaign_name: 'Campaign 1',
    })
  })
})
