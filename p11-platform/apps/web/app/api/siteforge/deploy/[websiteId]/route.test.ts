import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authGetUser,
  createClient,
  createServiceClient,
  validatePropertyAccess,
  from,
  start,
} = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  validatePropertyAccess: vi.fn(),
  from: vi.fn(),
  start: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess }))
vi.mock('workflow/api', () => ({ start }))
vi.mock('@/utils/siteforge/wordpress/credential-vault', () => ({
  getWordPressCredentialReference: vi.fn(),
}))
vi.mock('@/workflows/siteforge-staging-deployment', () => ({
  siteForgeStagingDeploymentWorkflow: vi.fn(),
}))

const ids = {
  website: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  property: '33333333-3333-4333-8333-333333333333',
  artifact: '44444444-4444-4444-8444-444444444444',
  approval: '55555555-5555-4555-8555-555555555555',
  target: '66666666-6666-4666-8666-666666666666',
  job: '77777777-7777-4777-8777-777777777777',
  deployment: '88888888-8888-4888-8888-888888888888',
}

function request(path: string): NextRequest {
  const url = `http://localhost${path}`
  const value = new Request(url, { method: 'POST' }) as NextRequest
  Object.defineProperty(value, 'nextUrl', { value: new URL(url) })
  return value
}

function builder(result: unknown) {
  const value: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'contains', 'neq', 'limit', 'insert', 'update']) {
    value[method] = vi.fn(() => value)
  }
  value.single = vi.fn().mockResolvedValue(result)
  value.maybeSingle = vi.fn().mockResolvedValue(result)
  return value
}

describe('Cloudways staging deployment route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'test')
    createClient.mockResolvedValue({ auth: { getUser: authGetUser } })
    createServiceClient.mockReturnValue({ from })
  })

  it('requires authentication', async () => {
    authGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('./route')
    const response = await POST(request(`/api/siteforge/deploy/${ids.website}`), {
      params: Promise.resolve({ websiteId: ids.website }),
    })
    expect(response.status).toBe(401)
  })

  it('preserves tenant-safe property authorization', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyAccess.mockResolvedValue({ authorized: false })
    from.mockReturnValueOnce(
      builder({
        data: {
          id: ids.website,
          org_id: ids.org,
          property_id: ids.property,
          current_artifact_version_id: ids.artifact,
        },
        error: null,
      })
    )
    const { POST } = await import('./route')
    const response = await POST(request(`/api/siteforge/deploy/${ids.website}`), {
      params: Promise.resolve({ websiteId: ids.website }),
    })
    expect(response.status).toBe(403)
  })

  it('queues an exact staging release without writing a legacy job', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyAccess.mockResolvedValue({ authorized: true })
    start.mockResolvedValue({ runId: 'staging-run-1', cancel: vi.fn() })

    const queues: Record<string, ReturnType<typeof builder>[]> = {
      property_websites: [
        builder({
          data: {
            id: ids.website,
            org_id: ids.org,
            property_id: ids.property,
            current_artifact_version_id: ids.artifact,
            canonical_preview_artifact_id: ids.artifact,
            canonical_preview_content_hash: 'a'.repeat(64),
            wordpress_credential_ref: null,
            staging_artifact_id: null,
            staging_content_hash: null,
            staging_url: null,
          },
          error: null,
        }),
        builder({ data: { id: ids.website }, error: null }),
      ],
      siteforge_blueprint_versions: [
        builder({
          data: {
            id: ids.artifact,
            content_hash: 'a'.repeat(64),
            asset_manifest_hash: 'b'.repeat(64),
            base_theme_package_sha256: 'c'.repeat(64),
            overlay_package_sha256: null,
            deployment_decision: 'approved',
            deployment_approved_at: '2026-07-30T20:00:00.000Z',
            confirmed_approval_id: ids.approval,
          },
          error: null,
        }),
      ],
      siteforge_wordpress_targets: [
        builder({ data: null, error: null }),
        builder({ data: { id: ids.target }, error: null }),
      ],
      shared_jobs: [
        builder({ data: null, error: null }),
        builder({ data: { id: ids.job }, error: null }),
        builder({ data: { id: ids.job }, error: null }),
      ],
      siteforge_artifact_deployments: [
        builder({ data: null, error: null }),
        builder({ data: { id: ids.deployment }, error: null }),
        builder({ data: { id: ids.deployment }, error: null }),
      ],
    }
    from.mockImplementation((table: string) => {
      const next = queues[table]?.shift()
      if (!next) throw new Error(`Unexpected ${table} query`)
      return next
    })

    const { POST } = await import('./route')
    const response = await POST(
      request(`/api/siteforge/deploy/${ids.website}?simulate=1`),
      { params: Promise.resolve({ websiteId: ids.website }) }
    )
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        jobId: ids.job,
        deploymentId: ids.deployment,
        targetId: ids.target,
        promotionPolicy: 'Push to Live is available only in Cloudways.',
      })
    )
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({
        artifactId: ids.artifact,
        deploymentId: ids.deployment,
        targetId: ids.target,
        localSimulation: true,
      }),
    ])
    expect(from).not.toHaveBeenCalledWith('siteforge_jobs')
  })
})
