import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('Lead workflow route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized on GET', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error('unauthorized'),
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/workflow') as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns workflow data for an authorized lead', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'lead_workflows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'workflow-1',
                        status: 'active',
                        current_step: 0,
                        workflow: {
                          name: 'New Lead Nurture',
                          steps: [
                            { id: 0, delay_hours: 1, action: 'sms', template_slug: 'intro_sms' },
                            { id: 1, delay_hours: 24, action: 'email', template_slug: 'amenities_email' },
                          ],
                        },
                        actions: [
                          {
                            id: 'action-1',
                            step_number: 0,
                            action_type: 'sms',
                            status: 'sent',
                            created_at: '2026-03-16T10:00:00.000Z',
                            error_message: null,
                          },
                        ],
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/workflow') as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json.workflow).toMatchObject({
      id: 'workflow-1',
      status: 'active',
      action_visibility: {
        counts: {
          pending: 1,
          skipped: 0,
          retried: 0,
          paused: 0,
          failed: 0,
        },
        recent_issues: [],
      },
    })
  })
})
