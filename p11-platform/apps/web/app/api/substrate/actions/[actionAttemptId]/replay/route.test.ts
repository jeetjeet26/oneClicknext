import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const resumeSharedActionAttemptMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/shared-dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/utils/services/shared-dispatcher')>(
    '@/utils/services/shared-dispatcher'
  )
  return {
    ...actual,
    resumeSharedActionAttempt: resumeSharedActionAttemptMock,
  }
})

describe('POST /api/substrate/actions/[actionAttemptId]/replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost') as NextRequest, {
      params: Promise.resolve({ actionAttemptId: 'action-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('replays actions for authorized reviewers', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const profileSingleMock = vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null })
    const profileEqMock = vi.fn(() => ({ single: profileSingleMock }))
    const profileSelectMock = vi.fn(() => ({ eq: profileEqMock }))
    fromMock.mockReturnValue({ select: profileSelectMock })

    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { property_id: 'property-1' },
              error: null,
            }),
          })),
        })),
      })),
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    resumeSharedActionAttemptMock.mockResolvedValue({ success: true })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost') as NextRequest, {
      params: Promise.resolve({ actionAttemptId: 'action-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      result: { success: true },
    })
  })
})
