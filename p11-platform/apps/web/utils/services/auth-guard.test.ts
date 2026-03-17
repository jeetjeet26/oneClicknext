import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const createClientMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

function makeQueryBuilder<T>(result: T) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

function makeSupabaseClient(options: {
  profileResult?: { data: { org_id?: string | null } | null; error: unknown }
  propertyResult?: { data: { org_id?: string | null } | null; error: unknown }
  authUserResult?: {
    data: { user: { id: string; email?: string } | null }
    error: unknown
  }
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return makeQueryBuilder(
          options.profileResult ?? { data: { org_id: 'org-1' }, error: null }
        )
      }

      if (table === 'properties') {
        return makeQueryBuilder(
          options.propertyResult ?? { data: { org_id: 'org-1' }, error: null }
        )
      }

      throw new Error(`Unexpected table ${table}`)
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue(
        options.authUserResult ?? {
          data: { user: { id: 'user-1', email: 'user@example.com' } },
          error: null,
        }
      ),
    },
  }
}

describe('auth guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an error when userId or propertyId is missing', async () => {
    const { validatePropertyAccess } = await import('./auth-guard')

    await expect(validatePropertyAccess('', 'property-1')).resolves.toEqual({
      authorized: false,
      error: 'Missing userId or propertyId',
    })
  })

  it('authorizes access when profile org matches property org', async () => {
    createServiceClientMock.mockReturnValue(
      makeSupabaseClient({
        profileResult: { data: { org_id: 'org-1' }, error: null },
        propertyResult: { data: { org_id: 'org-1' }, error: null },
      })
    )

    const { validatePropertyAccess } = await import('./auth-guard')

    await expect(
      validatePropertyAccess('user-1', 'property-1')
    ).resolves.toEqual({
      authorized: true,
      orgId: 'org-1',
    })
  })

  it('falls back to the server client when service client creation fails', async () => {
    createServiceClientMock.mockImplementation(() => {
      throw new Error('missing service role')
    })
    createClientMock.mockResolvedValue(
      makeSupabaseClient({
        profileResult: { data: { org_id: 'org-2' }, error: null },
        propertyResult: { data: { org_id: 'org-2' }, error: null },
      })
    )

    const { validatePropertyAccess } = await import('./auth-guard')

    await expect(
      validatePropertyAccess('user-2', 'property-2')
    ).resolves.toEqual({
      authorized: true,
      orgId: 'org-2',
    })
  })

  it('denies access when orgs do not match', async () => {
    createServiceClientMock.mockReturnValue(
      makeSupabaseClient({
        profileResult: { data: { org_id: 'org-1' }, error: null },
        propertyResult: { data: { org_id: 'org-2' }, error: null },
      })
    )

    const { validatePropertyAccess } = await import('./auth-guard')

    await expect(
      validatePropertyAccess('user-1', 'property-1')
    ).resolves.toEqual({
      authorized: false,
      error: 'Forbidden',
    })
  })

  it('returns unauthorized from authenticateAndAuthorize when no user exists', async () => {
    createClientMock.mockResolvedValue(
      makeSupabaseClient({
        authUserResult: { data: { user: null }, error: new Error('auth failed') },
      })
    )

    const { authenticateAndAuthorize } = await import('./auth-guard')

    await expect(authenticateAndAuthorize('property-1')).resolves.toEqual({
      user: null,
      access: { authorized: false, error: 'Unauthorized' },
      error: 'Unauthorized',
    })
  })
})
