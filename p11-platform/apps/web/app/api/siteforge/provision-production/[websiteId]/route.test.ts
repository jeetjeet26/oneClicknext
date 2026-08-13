import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authGetUser,
  createClient,
  createServiceClient,
  validatePropertyManagerAccess,
  from,
  createApplication,
  start,
} = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  validatePropertyManagerAccess: vi.fn(),
  from: vi.fn(),
  createApplication: vi.fn(),
  start: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess,
}))
vi.mock('workflow/api', () => ({ start }))
vi.mock('@/utils/siteforge/providers/cloudways-provider', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/utils/siteforge/providers/cloudways-provider')
  >()),
  CloudwaysProviderClient: vi.fn(function CloudwaysProviderClient() {
    return { createApplication }
  }),
  parseCloudwaysApplicationHostname: vi.fn(() => ({
    serverId: 'server-123',
    applicationId: 'preview-123',
  })),
}))
vi.mock('@/workflows/siteforge-production-provisioning', () => ({
  siteForgeProductionProvisioningWorkflow: vi.fn(),
}))

const ids = {
  website: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  property: '33333333-3333-4333-8333-333333333333',
  target: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555',
}

function request(): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/provision-production/${ids.website}`,
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
    'in',
    'contains',
    'neq',
    'limit',
    'insert',
    'update',
    'filter',
  ]) {
    value[method] = vi.fn(() => value)
  }
  value.single = vi.fn().mockResolvedValue(result)
  value.maybeSingle = vi.fn().mockResolvedValue(result)
  return value
}

describe('production WordPress provisioning route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CLOUDWAYS_API_KEY', 'cw-token')
    vi.stubEnv('CLOUDWAYS_EMAIL', 'ops@example.com')
    vi.stubEnv(
      'SITEFORGE_PREVIEW_WP_URL',
      'https://wordpress-123-456.cloudwaysapps.com'
    )
    createClient.mockResolvedValue({ auth: { getUser: authGetUser } })
    createServiceClient.mockReturnValue({ from })
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyManagerAccess.mockResolvedValue({ authorized: true })
  })

  it('requires manager authorization', async () => {
    validatePropertyManagerAccess.mockResolvedValue({ authorized: false })
    from.mockReturnValueOnce(
      builder({
        data: {
          id: ids.website,
          org_id: ids.org,
          property_id: ids.property,
          wordpress_credential_ref: null,
          production_target_id: null,
        },
        error: null,
      })
    )
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: ids.website }),
    })
    expect(response.status).toBe(403)
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('rejects a website that already has a production credential', async () => {
    from.mockReturnValueOnce(
      builder({
        data: {
          id: ids.website,
          org_id: ids.org,
          property_id: ids.property,
          wordpress_credential_ref: 'supabase-vault:existing',
          production_target_id: ids.target,
        },
        error: null,
      })
    )
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: ids.website }),
    })
    expect(response.status).toBe(409)
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('fails safe when a prior provider initiation claim is unresolved', async () => {
    const queues: Record<string, ReturnType<typeof builder>[]> = {
      property_websites: [
        builder({
          data: {
            id: ids.website,
            org_id: ids.org,
            property_id: ids.property,
            wordpress_credential_ref: null,
            production_target_id: null,
          },
          error: null,
        }),
      ],
      siteforge_wordpress_targets: [
        builder({
          data: {
            id: ids.target,
            status: 'failed',
            metadata: {
              provisioningCheckpoint: {
                state: 'initiating',
                claimId: 'claim-123',
              },
            },
            provider_application_id: null,
            credential_ref: null,
            site_url: null,
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
    expect(createApplication).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('accepts access-token-only auth and starts the checkpointed workflow', async () => {
    vi.stubEnv('CLOUDWAYS_ACCESS_TOKEN', 'modern-cloudways-access-token')
    vi.stubEnv('CLOUDWAYS_API_KEY', '')
    vi.stubEnv('CLOUDWAYS_EMAIL', '')
    createApplication.mockResolvedValue({
      operationId: 'operation-123',
      applicationId: null,
    })
    start.mockResolvedValue({ runId: 'workflow-run-123', cancel: vi.fn() })
    const targetRow = {
      id: ids.target,
      status: 'pending',
      metadata: { provisioningPolicy: 'siteforge-production-provisioning-v1' },
      provider_application_id: null,
      credential_ref: null,
      site_url: null,
    }
    const queues: Record<string, ReturnType<typeof builder>[]> = {
      property_websites: [
        builder({
          data: {
            id: ids.website,
            org_id: ids.org,
            property_id: ids.property,
            wordpress_credential_ref: null,
            production_target_id: null,
          },
          error: null,
        }),
      ],
      siteforge_wordpress_targets: [
        builder({ data: null, error: null }),
        builder({ data: targetRow, error: null }),
        builder({ data: { id: ids.target }, error: null }),
        builder({ data: { id: ids.target }, error: null }),
      ],
      shared_jobs: [
        builder({ data: null, error: null }),
        builder({ data: { id: ids.job }, error: null }),
        builder({ data: { id: ids.job }, error: null }),
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
    expect(createApplication).toHaveBeenCalledTimes(1)
    expect(createApplication).toHaveBeenCalledWith({
      serverId: 'server-123',
      label: `siteforge-production-${ids.website.slice(0, 8)}`,
    })
    expect(start).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({
      jobId: ids.job,
      targetId: ids.target,
      workflowRunId: 'workflow-run-123',
    })
  })
})
