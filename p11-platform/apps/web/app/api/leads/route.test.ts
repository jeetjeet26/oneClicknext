import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const leadsInsertSingleMock = vi.fn()
const fromMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const syncLeadToCRMMock = vi.fn()
const startWorkflowMock = vi.fn()
const logAuditEventMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/crm-sync', () => ({
  syncLeadToCRM: syncLeadToCRMMock,
}))

vi.mock('@/utils/services/workflow-processor', () => ({
  startWorkflow: startWorkflowMock,
}))

vi.mock('@/utils/audit', () => ({
  logAuditEvent: logAuditEventMock,
}))

describe('POST /api/leads', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    createClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUserMock,
      },
      from: fromMock,
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: leadsInsertSingleMock,
            })),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    syncLeadToCRMMock.mockResolvedValue(undefined)
    startWorkflowMock.mockResolvedValue({ success: true, workflowId: 'wf-1' })
    logAuditEventMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the request is unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error('Unauthorized'),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
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

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('creates a lead and triggers downstream automation', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    leadsInsertSingleMock.mockResolvedValue({
      data: { id: 'lead-1' },
      error: null,
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '555-111-2222',
        source: 'manual',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      lead: { id: 'lead-1' },
    })

    expect(syncLeadToCRMMock).toHaveBeenCalledWith(
      'property-1',
      'lead-1',
      expect.objectContaining({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        phone: '555-111-2222',
        source: 'manual',
        status: 'new',
      })
    )
    expect(startWorkflowMock).toHaveBeenCalledWith(
      'lead-1',
      'property-1',
      'lead_created'
    )
    expect(logAuditEventMock).toHaveBeenCalled()
  })

  it('still starts the workflow when CRM sync throws unexpectedly', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    leadsInsertSingleMock.mockResolvedValue({
      data: { id: 'lead-1' },
      error: null,
    })
    syncLeadToCRMMock.mockRejectedValue(new Error('crm exploded'))

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(startWorkflowMock).toHaveBeenCalledWith(
      'lead-1',
      'property-1',
      'lead_created'
    )
  })
})
