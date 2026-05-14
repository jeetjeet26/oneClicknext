import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeJsonRequest } from '@/test/route-test-helpers'

const mocks = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  editPropertyChatbotContextMock: vi.fn(),
  saveManualPropertyChatbotContextMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: mocks.createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: mocks.createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: mocks.validatePropertyAccessMock,
}))

vi.mock('@/utils/services/chatbot-context-editor', () => ({
  editPropertyChatbotContext: mocks.editPropertyChatbotContextMock,
  saveManualPropertyChatbotContext: mocks.saveManualPropertyChatbotContextMock,
}))

describe('chatbot context route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClientMock.mockResolvedValue({
      auth: { getUser: mocks.authGetUserMock },
    })
    mocks.createServiceClientMock.mockReturnValue({ from: vi.fn() })
  })

  it('PATCH returns 401 when unauthenticated', async () => {
    mocks.authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { PATCH } = await import('./route')
    const response = await PATCH(makeJsonRequest('http://localhost/api/chatbot-context', {
      method: 'PATCH',
      body: { propertyId: 'property-1', contextMarkdown: 'Edited context' },
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('PATCH validates required manual context text', async () => {
    mocks.authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { PATCH } = await import('./route')
    const response = await PATCH(makeJsonRequest('http://localhost/api/chatbot-context', {
      method: 'PATCH',
      body: { propertyId: 'property-1', contextMarkdown: '   ' },
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'contextMarkdown cannot be empty' })
    expect(mocks.validatePropertyAccessMock).not.toHaveBeenCalled()
  })

  it('PATCH returns 403 when property access is denied', async () => {
    mocks.authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { PATCH } = await import('./route')
    const response = await PATCH(makeJsonRequest('http://localhost/api/chatbot-context', {
      method: 'PATCH',
      body: { propertyId: 'property-1', contextMarkdown: 'Edited context' },
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('PATCH saves manual context edits for authorized users', async () => {
    const serviceClient = { from: vi.fn() }
    mocks.authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    mocks.createServiceClientMock.mockReturnValue(serviceClient)
    mocks.saveManualPropertyChatbotContextMock.mockResolvedValue({ success: true, status: 'current' })

    const { PATCH } = await import('./route')
    const response = await PATCH(makeJsonRequest('http://localhost/api/chatbot-context', {
      method: 'PATCH',
      body: { propertyId: 'property-1', contextMarkdown: 'Edited context' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, status: 'current' })
    expect(mocks.saveManualPropertyChatbotContextMock).toHaveBeenCalledWith(serviceClient, 'property-1', {
      contextMarkdown: 'Edited context',
    })
  })

  it('PATCH returns 404 when no generated context exists', async () => {
    mocks.authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    mocks.saveManualPropertyChatbotContextMock.mockResolvedValue({
      success: false,
      status: 'failed',
      error: 'Chatbot context not found',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(makeJsonRequest('http://localhost/api/chatbot-context', {
      method: 'PATCH',
      body: { propertyId: 'property-1', contextMarkdown: 'Edited context' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Chatbot context not found' })
  })
})
