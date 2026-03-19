import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const embeddingCreateMock = vi.fn()
const completionCreateMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    embeddings = {
      create: embeddingCreateMock,
    }

    chat = {
      completions: {
        create: completionCreateMock,
      },
    }
  },
}))

describe('chat route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingCreateMock.mockReset()
    completionCreateMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.com' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('creates a conversation without inventing a new lead record', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'u@example.com', user_metadata: { full_name: 'User Test' } } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const leadSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const leadEmailEqMock = vi.fn().mockReturnValue({ single: leadSingleMock })
    const leadPropertyEqMock = vi.fn().mockReturnValue({ eq: leadEmailEqMock })
    const leadSelectMock = vi.fn().mockReturnValue({ eq: leadPropertyEqMock })

    const conversationInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'conversation-1' },
      error: null,
    })
    const conversationInsertSelectMock = vi.fn().mockReturnValue({ single: conversationInsertSingleMock })
    const conversationInsertMock = vi.fn().mockReturnValue({ select: conversationInsertSelectMock })
    const conversationStateSingleMock = vi.fn().mockResolvedValue({
      data: { is_human_mode: false },
      error: null,
    })
    const conversationStateEqMock = vi.fn().mockReturnValue({ single: conversationStateSingleMock })
    const conversationStateSelectMock = vi.fn().mockReturnValue({ eq: conversationStateEqMock })

    const messagesInsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return { select: leadSelectMock }
        }
        if (table === 'conversations') {
          return {
            insert: conversationInsertMock,
            select: conversationStateSelectMock,
          }
        }
        if (table === 'messages') {
          return { insert: messagesInsertMock }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: rpcMock,
    })

    embeddingCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })
    completionCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'Hello there' } }],
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      content: 'Hello there',
      conversationId: 'conversation-1',
    })
    expect(conversationInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: 'property-1',
        lead_id: null,
        channel: 'chat',
      })
    )
  })
})
