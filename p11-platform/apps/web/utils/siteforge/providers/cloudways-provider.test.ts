import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CloudwaysProviderClient,
  CloudwaysUnsupportedOperationError,
} from './cloudways-provider'

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Cloudways API v2 provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches a verified domain, installs SSL, and enforces HTTPS', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}))
    vi.stubGlobal('fetch', fetchMock)

    await new CloudwaysProviderClient({
      email: 'ops@example.com',
      apiKey: 'cw-key',
    }).configureApplicationDomain({
      applicationId: 'app-123',
      domain: 'apartments.example.com',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudways.com/api/v2/oauth/access_token',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudways.com/api/v2/applications/app-123/cname',
      expect.objectContaining({ method: 'PUT' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.cloudways.com/api/v2/applications/app-123/enforce-https',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('uses modern Cloudways access tokens directly as bearer credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await new CloudwaysProviderClient({
      email: 'ops@example.com',
      apiKey: 'cw_access-token',
    }).configureApplicationDomain({
      applicationId: 'app-123',
      domain: 'apartments.example.com',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudways.com/api/v2/applications/app-123/cname',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cw_access-token',
        }),
      })
    )
  })

  it('rejects invalid domains before provider mutations', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      new CloudwaysProviderClient({
        email: 'ops@example.com',
        apiKey: 'cw-key',
      }).configureApplicationDomain({
        applicationId: 'app-123',
        domain: 'not a domain',
      })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a staging application linked to its parent app', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(
        response({ operation_id: 'operation-1', app_id: 'staging-app-1' })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CloudwaysProviderClient({
      email: 'ops@example.com',
      apiKey: 'cw-key',
    }).createStagingApplication({
      serverId: 'server-1',
      parentApplicationId: 'parent-app-1',
      label: 'Property Staging',
    })

    expect(result).toEqual({
      operationId: 'operation-1',
      applicationId: 'staging-app-1',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudways.com/api/v2/app/createstaging',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"app_id":"parent-app-1"'),
      })
    )
  })

  it('checkpoints backup identity and polls the returned operation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: { operation_id: 'backup-op', backup_id: 'backup-1' } }))
      .mockResolvedValueOnce(response({ data: { status: 'completed' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new CloudwaysProviderClient({
      email: 'ops@example.com',
      apiKey: 'cw_access-token',
    })

    await expect(client.createApplicationBackup('production-app')).resolves.toEqual({
      operationId: 'backup-op',
      backupId: 'backup-1',
    })
    await client.waitForOperation('backup-op')

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudways.com/api/v2/operation/backup-op',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('uses an explicit manual fallback when push-to-live is unsupported', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ message: 'endpoint unavailable' }, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new CloudwaysProviderClient({
        email: 'ops@example.com',
        apiKey: 'cw_access-token',
      }).promoteStagingApplication({
        serverId: 'server-1',
        stagingApplicationId: 'staging-1',
        productionApplicationId: 'production-1',
      })
    ).rejects.toBeInstanceOf(CloudwaysUnsupportedOperationError)
  })
})
