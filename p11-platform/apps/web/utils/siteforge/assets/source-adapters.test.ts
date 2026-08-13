import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AssetProviderError,
  discoverAssetSourceFiles,
  fetchProviderWithRetry,
  resolveAssetSourceCredential,
} from './source-adapters'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('SiteForge asset source adapters', () => {
  it('uses and advances a Google Drive modified-time checkpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        files: [
          {
            id: 'drive-file-1',
            name: 'exterior.jpg',
            mimeType: 'image/jpeg',
            size: '1234',
            md5Checksum: 'provider-md5',
            modifiedTime: '2026-08-10T12:00:00.000Z',
          },
        ],
      })
    )

    const result = await discoverAssetSourceFiles({
      provider: 'google_drive',
      folderId: 'folder-1',
      accessToken: 'not-logged',
      checkpoint: { modifiedAfter: '2026-08-01T00:00:00.000Z' },
      fetchFn,
      sleep: vi.fn(),
    })

    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('modifiedTime'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer not-logged' },
      })
    )
    expect(result.files[0]).toMatchObject({
      sourceIdentity: 'google_drive:drive-file-1',
      providerHash: 'provider-md5',
    })
    expect(result.checkpoint).toEqual({
      modifiedAfter: '2026-08-10T12:00:00.000Z',
    })
  })

  it('continues Dropbox from its durable cursor', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        cursor: 'cursor-next',
        has_more: false,
        entries: [
          {
            '.tag': 'file',
            id: 'id:dropbox-1',
            name: 'lobby.png',
            path_lower: '/photos/lobby.png',
            size: 42,
            content_hash: 'dropbox-hash',
          },
        ],
      })
    )

    const result = await discoverAssetSourceFiles({
      provider: 'dropbox',
      folderId: '/photos',
      accessToken: 'not-logged',
      checkpoint: { cursor: 'cursor-old' },
      fetchFn,
      sleep: vi.fn(),
    })

    expect(fetchFn.mock.calls[0]?.[0]).toContain('list_folder/continue')
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string)).toEqual({
      cursor: 'cursor-old',
    })
    expect(result.checkpoint).toEqual({ cursor: 'cursor-next' })
  })

  it('retries transient errors then fails closed with a sanitized error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('access_token=do-not-expose', { status: 503 })
    )
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(
      fetchProviderWithRetry(
        'https://www.googleapis.com/drive/v3/files',
        { headers: { Authorization: 'Bearer secret' } },
        {
          provider: 'google_drive',
          fetchFn,
          sleep,
          attempts: 3,
        }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'AssetProviderError',
        message: 'Google Drive request failed (503)',
        retryable: true,
      })
    )
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('rejects credentials bound to another tenant', async () => {
    vi.stubEnv(
      'SITEFORGE_ASSET_GOOGLE_DRIVE_TEST',
      JSON.stringify({
        provider: 'google_drive',
        accessToken: 'secret-token',
        orgId: '11111111-1111-4111-8111-111111111111',
        propertyId: '22222222-2222-4222-8222-222222222222',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
    )

    await expect(
      resolveAssetSourceCredential({
        credentialRef: 'env:SITEFORGE_ASSET_GOOGLE_DRIVE_TEST',
        provider: 'google_drive',
        orgId: '33333333-3333-4333-8333-333333333333',
        propertyId: '22222222-2222-4222-8222-222222222222',
      })
    ).rejects.toBeInstanceOf(AssetProviderError)
  })
})
