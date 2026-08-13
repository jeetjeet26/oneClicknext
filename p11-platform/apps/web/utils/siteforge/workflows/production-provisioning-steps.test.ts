import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createServiceClient,
  from,
  waitForOperation,
  getApplication,
  createWordPressApplicationPassword,
  storeWordPressCredentialReference,
} = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  from: vi.fn(),
  waitForOperation: vi.fn(),
  getApplication: vi.fn(),
  createWordPressApplicationPassword: vi.fn(),
  storeWordPressCredentialReference: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/siteforge/providers/cloudways-provider', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/utils/siteforge/providers/cloudways-provider')
  >()),
  CloudwaysProviderClient: vi.fn(function CloudwaysProviderClient() {
    return { waitForOperation, getApplication }
  }),
}))
vi.mock('@/utils/siteforge/wordpress/wordpress-installer', () => ({
  createWordPressApplicationPassword,
}))
vi.mock('@/utils/siteforge/wordpress/credential-vault', () => ({
  storeWordPressCredentialReference,
}))
vi.mock('@/utils/siteforge/workflows/staging-steps', () => ({
  readCloudwaysProvisioningCheckpoint: vi.fn(() => ({
    operationId: 'operation-123',
    applicationId: null,
  })),
}))

function builder(result: unknown) {
  const value: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'update']) {
    value[method] = vi.fn(() => value)
  }
  value.single = vi.fn().mockResolvedValue(result)
  value.maybeSingle = vi.fn().mockResolvedValue(result)
  return value
}

describe('production WordPress provisioning workflow step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CLOUDWAYS_API_KEY', 'cw-token')
    vi.stubEnv('CLOUDWAYS_EMAIL', 'ops@example.com')
    vi.stubEnv('SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY', 'private\\nkey')
    createServiceClient.mockReturnValue({ from })
  })

  it('resolves the app, mints a REST password, and links the target', async () => {
    waitForOperation.mockResolvedValue({
      operation_id: 'operation-123',
      app_id: 'application-456',
      is_completed: '1',
    })
    getApplication.mockResolvedValue({
      id: 'application-456',
      app_fqdn: 'wordpress-123-456.cloudwaysapps.com',
      app_user: 'application-user',
      app_password: 'application-ssh-password',
      public_ip: '192.0.2.10',
      master_user: 'master-user',
      sys_user: 'system-user',
    })
    createWordPressApplicationPassword.mockResolvedValue({
      username: 'siteforge-admin',
      applicationPassword: 'abcd efgh ijkl mnop qrst uvwx',
    })
    storeWordPressCredentialReference.mockResolvedValue(
      'supabase-vault:11111111-1111-4111-8111-111111111111'
    )
    const queues: Record<string, ReturnType<typeof builder>[]> = {
      shared_jobs: [
        builder({ data: { id: 'job-1' }, error: null }),
        builder({ data: { id: 'job-1' }, error: null }),
        builder({ data: { id: 'job-1' }, error: null }),
        builder({ data: { id: 'job-1' }, error: null }),
      ],
      siteforge_wordpress_targets: [
        builder({
          data: {
            id: 'target-1',
            metadata: {
              provisioningCheckpoint: { operationId: 'operation-123' },
            },
            provider_application_id: null,
            provider_server_id: 'server-123',
            credential_ref: null,
            site_url: null,
            admin_url: null,
            dashboard_url: null,
          },
          error: null,
        }),
        builder({ data: { id: 'target-1' }, error: null }),
      ],
      property_websites: [
        builder({ data: { id: 'website-1' }, error: null }),
      ],
    }
    from.mockImplementation((table: string) => {
      const next = queues[table]?.shift()
      if (!next) throw new Error(`Unexpected ${table} query`)
      return next
    })
    const { runProductionProvisioning } = await import(
      './production-provisioning-steps'
    )
    const result = await runProductionProvisioning({
      sharedJobId: 'job-1',
      targetId: 'target-1',
      websiteId: 'website-1',
      propertyId: 'property-1',
      orgId: 'org-1',
      serverId: 'server-123',
      startedAt: '2026-08-06T20:00:00.000Z',
    })

    expect(waitForOperation).toHaveBeenCalledWith('operation-123')
    expect(createWordPressApplicationPassword).toHaveBeenCalledWith({
      ssh: expect.objectContaining({
        host: '192.0.2.10',
        username: 'master-user',
        privateKey: 'private\nkey',
        applicationRoot:
          '/home/master/applications/system-user/public_html',
      }),
    })
    expect(storeWordPressCredentialReference).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId: 'website-1',
        credentials: expect.objectContaining({
          username: 'siteforge-admin',
          password: 'abcd efgh ijkl mnop qrst uvwx',
          providerMetadata: expect.objectContaining({
            applicationId: 'application-456',
            serverId: 'server-123',
          }),
        }),
      })
    )
    expect(result).toEqual({
      applicationId: 'application-456',
      siteUrl: 'https://wordpress-123-456.cloudwaysapps.com',
      adminUrl: 'https://wordpress-123-456.cloudwaysapps.com/wp-admin',
      dashboardUrl:
        'https://platform.cloudways.com/apps/application-456/access-details',
    })
  })
})
