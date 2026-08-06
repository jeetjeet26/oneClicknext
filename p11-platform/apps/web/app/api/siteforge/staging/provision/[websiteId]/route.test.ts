import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authGetUser,
  createClient,
  createServiceClient,
  validatePropertyManagerAccess,
  getWordPressCredentialReference,
  createStagingApplication,
  from,
} = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  validatePropertyManagerAccess: vi.fn(),
  getWordPressCredentialReference: vi.fn(),
  createStagingApplication: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess,
}))
vi.mock('@/utils/siteforge/wordpress/credential-vault', () => ({
  getWordPressCredentialReference,
}))
vi.mock('@/utils/siteforge/providers/cloudways-provider', () => ({
  CloudwaysProviderClient: vi.fn(function CloudwaysProviderClient() {
    return { createStagingApplication }
  }),
}))

const ids = {
  website: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  property: '33333333-3333-4333-8333-333333333333',
  target: '44444444-4444-4444-8444-444444444444',
}

function request(): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/staging/provision/${ids.website}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }
  ) as NextRequest
}

function builder(result: unknown) {
  const value: Record<string, unknown> = {}
  for (const method of [
    'select',
    'eq',
    'insert',
    'update',
    'filter',
    'contains',
  ]) {
    value[method] = vi.fn(() => value)
  }
  value.single = vi.fn().mockResolvedValue(result)
  value.maybeSingle = vi.fn().mockResolvedValue(result)
  return value
}

describe('staging WordPress provisioning route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CLOUDWAYS_API_KEY', 'cw-token')
    vi.stubEnv('CLOUDWAYS_EMAIL', 'ops@example.com')
    createClient.mockResolvedValue({ auth: { getUser: authGetUser } })
    createServiceClient.mockReturnValue({ from })
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyManagerAccess.mockResolvedValue({ authorized: true })
    getWordPressCredentialReference.mockResolvedValue({
      provider: 'cloudways',
      providerMetadata: {
        serverId: 'server-123',
        applicationId: 'production-123',
        publicIp: '203.0.113.1',
      },
    })
  })

  it('requires manager authorization', async () => {
    validatePropertyManagerAccess.mockResolvedValue({ authorized: false })
    from.mockReturnValueOnce(
      builder({
        data: {
          id: ids.website,
          org_id: ids.org,
          property_id: ids.property,
          wordpress_credential_ref: 'supabase-vault:production',
        },
        error: null,
      })
    )

    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: ids.website }),
    })

    expect(response.status).toBe(403)
    expect(createStagingApplication).not.toHaveBeenCalled()
  })

  it('fails closed for an unresolved provider initiation claim', async () => {
    const queues: Record<string, ReturnType<typeof builder>[]> = {
      property_websites: [
        builder({
          data: {
            id: ids.website,
            org_id: ids.org,
            property_id: ids.property,
            wordpress_credential_ref: 'supabase-vault:production',
          },
          error: null,
        }),
      ],
      siteforge_wordpress_targets: [
        builder({
          data: {
            id: ids.target,
            status: 'provisioning',
            provider_application_id: null,
            provider_parent_application_id: 'production-123',
            metadata: {
              provisioningCheckpoint: {
                state: 'initiating',
                claimId: 'claim-123',
              },
            },
          },
          error: null,
        }),
      ],
    }
    from.mockImplementation((table: string) => {
      const next = queues[table]?.shift()
      if (!next) throw new Error(`Unexpected ${table} query`)
      return next
    })

    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: ids.website }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      requiresProviderReconciliation: true,
    })
    expect(createStagingApplication).not.toHaveBeenCalled()
  })

  it('claims the target and persists the Cloudways clone checkpoint', async () => {
    createStagingApplication.mockResolvedValue({
      operationId: 'operation-123',
      applicationId: null,
    })
    const target = {
      id: ids.target,
      status: 'pending',
      provider_application_id: null,
      provider_parent_application_id: 'production-123',
      metadata: { provisioningPolicy: 'siteforge-staging-provisioning-v1' },
    }
    const queues: Record<string, ReturnType<typeof builder>[]> = {
      property_websites: [
        builder({
          data: {
            id: ids.website,
            org_id: ids.org,
            property_id: ids.property,
            wordpress_credential_ref: 'supabase-vault:production',
          },
          error: null,
        }),
      ],
      siteforge_wordpress_targets: [
        builder({ data: target, error: null }),
        builder({ data: { id: ids.target }, error: null }),
        builder({ data: { id: ids.target }, error: null }),
      ],
    }
    from.mockImplementation((table: string) => {
      const next = queues[table]?.shift()
      if (!next) throw new Error(`Unexpected ${table} query`)
      return next
    })

    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: ids.website }),
    })

    expect(response.status).toBe(202)
    expect(createStagingApplication).toHaveBeenCalledWith({
      serverId: 'server-123',
      parentApplicationId: 'production-123',
      label: `siteforge-staging-${ids.website.slice(0, 8)}`,
    })
    await expect(response.json()).resolves.toMatchObject({
      targetId: ids.target,
      operationId: 'operation-123',
      status: 'provisioning',
    })
  })
})
