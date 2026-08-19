import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser, validateOwnerOperator } = vi.hoisted(() => ({
  getUser: vi.fn(),
  validateOwnerOperator: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validateSiteForgeOwnerOperatorAccess: validateOwnerOperator,
}))

describe('SiteForge launch owner/operator authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({
      data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
      error: null,
    })
  })

  it('denies launch authority to authenticated users without capability', async () => {
    validateOwnerOperator.mockResolvedValue({
      authorized: false,
      capability: 'siteforge.owner_operator',
    })
    const { requireLaunchManager } = await import('./auth')
    const result = await requireLaunchManager(
      '22222222-2222-4222-8222-222222222222'
    )

    expect(result.user).toBeNull()
    expect(result.response?.status).toBe(403)
    await expect(result.response?.json()).resolves.toMatchObject({
      capability: 'siteforge.owner_operator',
    })
  })

  it('permits the canonical owner/operator capability', async () => {
    validateOwnerOperator.mockResolvedValue({
      authorized: true,
      capability: 'siteforge.owner_operator',
      orgId: '33333333-3333-4333-8333-333333333333',
      role: 'manager',
    })
    const { requireLaunchManager } = await import('./auth')
    const result = await requireLaunchManager(
      '22222222-2222-4222-8222-222222222222'
    )

    expect(result.user?.id).toBe('11111111-1111-4111-8111-111111111111')
    expect(result.response).toBeNull()
  })
})
