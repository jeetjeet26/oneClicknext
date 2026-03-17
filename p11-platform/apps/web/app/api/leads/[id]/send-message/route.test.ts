import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const sendMessageMock = vi.fn()
const replaceTemplateVariablesMock = vi.fn((template: string) => template)

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/messaging', () => ({
  sendMessage: sendMessageMock,
  replaceTemplateVariables: replaceTemplateVariablesMock,
}))

describe('lead send-message route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/send-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'email', message: 'Hello' }),
    }) as NextRequest

    const response = await POST(request, { params: Promise.resolve({ id: 'lead-1' }) })

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when the lead has no recipient for the chosen channel', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'lead-1',
                    property_id: 'property-1',
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: null,
                    phone: null,
                    status: 'new',
                    properties: { id: 'property-1', name: 'The Beacon' },
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/send-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'email', message: 'Hello' }),
    }) as NextRequest

    const response = await POST(request, { params: Promise.resolve({ id: 'lead-1' }) })

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Lead has no email address',
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('sends the message, logs it, and updates the lead', async () => {
    const messageInsert = vi.fn().mockResolvedValue({ error: null })
    const leadUpdateEq = vi.fn().mockResolvedValue({ error: null })
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    sendMessageMock.mockResolvedValue({
      success: true,
      messageId: 'provider-message-1',
      channel: 'email',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'lead-1',
                    property_id: 'property-1',
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: 'jane@example.com',
                    phone: '5551112222',
                    status: 'new',
                    properties: { id: 'property-1', name: 'The Beacon' },
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: leadUpdateEq,
            })),
          }
        }

        if (table === 'follow_up_templates') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      body: 'Hello {{first_name}}',
                      subject: 'Welcome {{first_name}}',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'conversations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'conversation-1' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'messages') {
          return {
            insert: messageInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/send-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'email', templateSlug: 'welcome' }),
    }) as NextRequest

    const response = await POST(request, { params: Promise.resolve({ id: 'lead-1' }) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        channel: 'email',
      })
    )
    expect(messageInsert).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      role: 'assistant',
      content: 'Hello {{first_name}}',
    })
    expect(leadUpdateEq).toHaveBeenCalledWith('id', 'lead-1')
    expect(json).toEqual({
      success: true,
      messageId: 'provider-message-1',
      channel: 'email',
    })
  })
})
