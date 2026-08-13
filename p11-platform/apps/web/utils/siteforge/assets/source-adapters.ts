import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import type { AssetSourceProvider } from './contracts'

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DROPBOX_SCOPES = ['files.metadata.read', 'files.content.read'] as const
const MAX_PROVIDER_PAGES = 100

const storedCredentialSchema = z.object({
  provider: z.enum(['google_drive', 'dropbox']),
  accessToken: z.string().min(1),
  orgId: z.string().uuid(),
  propertyId: z.guid(),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.iso.datetime().nullable().optional(),
})

export class AssetProviderError extends Error {
  readonly retryable: boolean

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message)
    this.name = 'AssetProviderError'
    this.retryable = options?.retryable === true
  }
}

export type AssetSourceFile = {
  sourceIdentity: string
  providerFileId: string
  name: string
  mediaType: string
  size: number | null
  modifiedAt: string | null
  providerHash: string | null
  downloadRef: string
}

export type AssetSourceCheckpoint = Record<string, unknown>

type FetchLike = typeof fetch
type Sleep = (milliseconds: number) => Promise<void>

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function safeProviderMessage(provider: AssetSourceProvider, status: number) {
  return `${provider === 'google_drive' ? 'Google Drive' : 'Dropbox'} request failed (${status})`
}

export async function fetchProviderWithRetry(
  url: string,
  init: RequestInit,
  options?: {
    fetchFn?: FetchLike
    sleep?: Sleep
    attempts?: number
    provider?: AssetSourceProvider
  }
): Promise<Response> {
  const fetchFn = options?.fetchFn || fetch
  const sleep = options?.sleep || defaultSleep
  const attempts = options?.attempts || 3
  const provider = options?.provider || 'google_drive'

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      if (attempt === attempts) {
        throw new AssetProviderError(
          `${provider === 'google_drive' ? 'Google Drive' : 'Dropbox'} is unavailable`,
          { retryable: true }
        )
      }
      await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
      continue
    }
    if (response.ok) return response
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === attempts) {
      throw new AssetProviderError(
        safeProviderMessage(provider, response.status),
        { retryable }
      )
    }
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(
      retryAfter > 0
        ? Math.min(retryAfter * 1_000, 5_000)
        : Math.min(250 * 2 ** (attempt - 1), 2_000)
    )
  }
  throw new AssetProviderError('Asset provider request failed')
}

export async function resolveAssetSourceCredential(input: {
  credentialRef: string | null
  provider: AssetSourceProvider
  orgId: string
  propertyId: string
}): Promise<{ accessToken: string; scopes: string[] }> {
  if (!input.credentialRef) {
    throw new AssetProviderError('Asset source credential is unavailable')
  }

  let serialized: string | null = null
  const vaultMatch = /^supabase-vault:([0-9a-f-]{36})$/i.exec(
    input.credentialRef
  )
  if (vaultMatch) {
    const service = createServiceClient()
    const { data, error } = await service.rpc('get_siteforge_credential_secret', {
      p_secret_id: vaultMatch[1],
    })
    if (error || !data) {
      throw new AssetProviderError('Asset source credential is unavailable')
    }
    serialized = data
  } else {
    const envMatch = /^env:(SITEFORGE_ASSET_(?:GOOGLE_DRIVE|DROPBOX)_[A-Z0-9_]+)$/i.exec(
      input.credentialRef
    )
    if (!envMatch) {
      throw new AssetProviderError('Unsupported asset credential reference')
    }
    const expectedPrefix =
      input.provider === 'google_drive'
        ? 'SITEFORGE_ASSET_GOOGLE_DRIVE_'
        : 'SITEFORGE_ASSET_DROPBOX_'
    if (!envMatch[1].toUpperCase().startsWith(expectedPrefix)) {
      throw new AssetProviderError('Credential provider does not match source')
    }
    serialized = process.env[envMatch[1].toUpperCase()] || null
  }

  let credential: z.infer<typeof storedCredentialSchema>
  try {
    credential = storedCredentialSchema.parse(JSON.parse(serialized || ''))
  } catch {
    throw new AssetProviderError('Asset source credential is invalid')
  }
  if (
    credential.provider !== input.provider ||
    credential.orgId !== input.orgId ||
    credential.propertyId !== input.propertyId
  ) {
    throw new AssetProviderError('Asset source credential tenant mismatch')
  }
  if (credential.expiresAt && new Date(credential.expiresAt) <= new Date()) {
    throw new AssetProviderError('Asset source credential has expired')
  }
  const requiredScopes =
    input.provider === 'google_drive'
      ? [GOOGLE_DRIVE_SCOPE]
      : [...DROPBOX_SCOPES]
  if (!requiredScopes.every((scope) => credential.scopes.includes(scope))) {
    throw new AssetProviderError('Asset source credential lacks required scopes')
  }
  return { accessToken: credential.accessToken, scopes: credential.scopes }
}

async function discoverGoogleDriveFiles(input: {
  folderId: string
  accessToken: string
  checkpoint: AssetSourceCheckpoint
  fetchFn?: FetchLike
  sleep?: Sleep
}) {
  const files: AssetSourceFile[] = []
  let pageToken: string | null = null
  const modifiedAfter =
    typeof input.checkpoint.modifiedAfter === 'string'
      ? input.checkpoint.modifiedAfter
      : null
  let latestModifiedAt = modifiedAfter

  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const queryParts = [
      `'${input.folderId.replaceAll("'", "\\'")}' in parents`,
      'trashed = false',
    ]
    if (modifiedAfter) {
      queryParts.push(`modifiedTime > '${modifiedAfter.replaceAll("'", "")}'`)
    }
    const params = new URLSearchParams({
      q: queryParts.join(' and '),
      pageSize: '1000',
      fields:
        'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetchProviderWithRetry(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.accessToken}` },
      },
      {
        fetchFn: input.fetchFn,
        sleep: input.sleep,
        provider: 'google_drive',
      }
    )
    const payload = (await response.json()) as {
      nextPageToken?: string
      files?: Array<{
        id?: string
        name?: string
        mimeType?: string
        size?: string
        md5Checksum?: string
        modifiedTime?: string
      }>
    }
    for (const file of payload.files || []) {
      if (
        !file.id ||
        !file.name ||
        !file.mimeType?.startsWith('image/')
      ) {
        continue
      }
      files.push({
        sourceIdentity: `google_drive:${file.id}`,
        providerFileId: file.id,
        name: file.name,
        mediaType: file.mimeType,
        size: file.size ? Number(file.size) : null,
        modifiedAt: file.modifiedTime || null,
        providerHash: file.md5Checksum || null,
        downloadRef: file.id,
      })
      if (
        file.modifiedTime &&
        (!latestModifiedAt || file.modifiedTime > latestModifiedAt)
      ) {
        latestModifiedAt = file.modifiedTime
      }
    }
    pageToken = payload.nextPageToken || null
    if (!pageToken) {
      return {
        files,
        checkpoint: {
          modifiedAfter: latestModifiedAt || new Date().toISOString(),
        },
      }
    }
  }
  throw new AssetProviderError('Google Drive pagination limit exceeded')
}

async function discoverDropboxFiles(input: {
  folderId: string
  accessToken: string
  checkpoint: AssetSourceCheckpoint
  fetchFn?: FetchLike
  sleep?: Sleep
}) {
  const files: AssetSourceFile[] = []
  let cursor =
    typeof input.checkpoint.cursor === 'string'
      ? input.checkpoint.cursor
      : null

  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const continuing = Boolean(cursor)
    const response = await fetchProviderWithRetry(
      continuing
        ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
        : 'https://api.dropboxapi.com/2/files/list_folder',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          continuing
            ? { cursor }
            : {
                path: input.folderId,
                recursive: false,
                include_deleted: false,
                include_non_downloadable_files: false,
              }
        ),
      },
      {
        fetchFn: input.fetchFn,
        sleep: input.sleep,
        provider: 'dropbox',
      }
    )
    const payload = (await response.json()) as {
      cursor?: string
      has_more?: boolean
      entries?: Array<{
        '.tag'?: string
        id?: string
        name?: string
        path_lower?: string
        size?: number
        content_hash?: string
        server_modified?: string
      }>
    }
    for (const file of payload.entries || []) {
      const extension = file.name?.split('.').pop()?.toLowerCase()
      const mediaType =
        extension === 'png'
          ? 'image/png'
          : extension === 'webp'
            ? 'image/webp'
            : extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : null
      if (
        file['.tag'] !== 'file' ||
        !file.id ||
        !file.name ||
        !file.path_lower ||
        !mediaType
      ) {
        continue
      }
      files.push({
        sourceIdentity: `dropbox:${file.id}`,
        providerFileId: file.id,
        name: file.name,
        mediaType,
        size: file.size ?? null,
        modifiedAt: file.server_modified || null,
        providerHash: file.content_hash || null,
        downloadRef: file.path_lower,
      })
    }
    if (!payload.cursor) {
      throw new AssetProviderError('Dropbox omitted its sync checkpoint')
    }
    cursor = payload.cursor
    if (!payload.has_more) return { files, checkpoint: { cursor } }
  }
  throw new AssetProviderError('Dropbox pagination limit exceeded')
}

export async function discoverAssetSourceFiles(input: {
  provider: AssetSourceProvider
  folderId: string
  accessToken: string
  checkpoint: AssetSourceCheckpoint
  fetchFn?: FetchLike
  sleep?: Sleep
}) {
  if (input.provider === 'google_drive') {
    return discoverGoogleDriveFiles(input)
  }
  return discoverDropboxFiles(input)
}

export async function downloadAssetSourceFile(input: {
  provider: AssetSourceProvider
  file: AssetSourceFile
  accessToken: string
  fetchFn?: FetchLike
  sleep?: Sleep
}): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response =
    input.provider === 'google_drive'
      ? await fetchProviderWithRetry(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.file.downloadRef)}?alt=media`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${input.accessToken}` },
          },
          {
            fetchFn: input.fetchFn,
            sleep: input.sleep,
            provider: input.provider,
          }
        )
      : await fetchProviderWithRetry(
          'https://content.dropboxapi.com/2/files/download',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${input.accessToken}`,
              'Dropbox-API-Arg': JSON.stringify({
                path: input.file.downloadRef,
              }),
            },
          },
          {
            fetchFn: input.fetchFn,
            sleep: input.sleep,
            provider: input.provider,
          }
        )
  const mediaType =
    response.headers.get('content-type')?.split(';')[0] || input.file.mediaType
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) {
    throw new AssetProviderError('Provider returned an unsupported image type')
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mediaType,
  }
}

export const assetSourceScopeManifest = {
  google_drive: {
    scopes: [GOOGLE_DRIVE_SCOPE],
    access: 'read_only',
    resource: 'configured_folder',
  },
  dropbox: {
    scopes: [...DROPBOX_SCOPES],
    access: 'read_only',
    resource: 'configured_folder',
  },
} as const
