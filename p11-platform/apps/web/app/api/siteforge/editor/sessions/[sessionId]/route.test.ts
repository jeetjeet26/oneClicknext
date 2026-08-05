import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  createClient,
  createServiceClient,
  getUser,
  listMessages,
  serviceFrom,
  validateAccess,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
  listMessages: vi.fn(),
  serviceFrom: vi.fn(),
  validateAccess: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/siteforge/editor/repository', () => ({
  listEditorMessages: listMessages,
}))

const sessionId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const session = {
  id: sessionId,
  property_id: propertyId,
  website_id: '44444444-4444-4444-8444-444444444444',
  status: 'active',
}
const messages = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    session_id: sessionId,
    status: 'completed',
  },
]

function query(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(async () => result)
  return builder
}

function request(): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/editor/sessions/${sessionId}`
  ) as NextRequest
}

function context(id = sessionId) {
  return { params: Promise.resolve({ sessionId: id }) }
}

describe('SiteForge semantic editor session detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
    createServiceClient.mockReturnValue({ from: serviceFrom })
    getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    validateAccess.mockResolvedValue({ authorized: true })
    serviceFrom.mockReturnValue(query({ data: session, error: null }))
    listMessages.mockResolvedValue(messages)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('validates the session identifier before authentication', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(), context('not-a-uuid'))

    expect(response.status).toBe(400)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('requires authentication before loading session data', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('does not expose a session outside the user property access', async () => {
    validateAccess.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(validateAccess).toHaveBeenCalledWith(userId, propertyId)
    expect(listMessages).not.toHaveBeenCalled()
  })

  it('returns the authorized session and its messages', async () => {
    const serviceClient = { from: serviceFrom }
    createServiceClient.mockReturnValue(serviceClient)
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ session, messages })
    expect(listMessages).toHaveBeenCalledWith(sessionId, serviceClient)
  })
})
