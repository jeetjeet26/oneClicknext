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

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit findings export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/findings/export?propertyId=property-1')
    )

    expect(response.status).toBe(401)
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false, error: 'Forbidden' })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/findings/export?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('exports CSV with the deliverable column format and escaping', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const findings = [
      {
        category: 'titles',
        title: 'Over-length title tags',
        description: 'Titles exceed limits, including "quoted" text.',
        occurrences: 30,
        first_detected_at: '2026-07-17T10:00:00Z',
        fixed_at: null,
        status: 'todo',
        owner: 'web_developer',
        notes: null,
      },
    ]

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'properties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { name: 'Somerset Cove' }, error: null }),
              })),
            })),
          }
        }
        if (table === 'geo_site_findings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: findings, error: null }),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/findings/export?propertyId=property-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain('somerset-cove-technical-findings.csv')

    const csv = await response.text()
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('Type,Issue,Description,Occurrences,Date Discovered,Date Fixed,Owner,Status,Notes')
    expect(row).toContain('Titles')
    expect(row).toContain('Over-length title tags')
    expect(row).toContain('""quoted""')
    expect(row).toContain('30')
  })
})
