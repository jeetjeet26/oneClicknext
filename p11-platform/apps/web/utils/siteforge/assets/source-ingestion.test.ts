import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCredentialMock = vi.hoisted(() => vi.fn())
const discoverFilesMock = vi.hoisted(() => vi.fn())

vi.mock('./source-adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./source-adapters')>()),
  resolveAssetSourceCredential: resolveCredentialMock,
  discoverAssetSourceFiles: discoverFilesMock,
}))

import { AssetProviderError } from './source-adapters'
import { runAssetSourceIngestion } from './source-ingestion'

const source = {
  id: '11111111-1111-4111-8111-111111111111',
  org_id: '22222222-2222-4222-8222-222222222222',
  property_id: '33333333-3333-4333-8333-333333333333',
  website_id: null,
  provider: 'google_drive',
  status: 'active',
  external_folder_id: 'folder-1',
  external_folder_name: 'Photos',
  credential_ref: 'env:SITEFORGE_ASSET_GOOGLE_DRIVE_TEST',
  scope_manifest: {},
  checkpoint: { modifiedAfter: '2026-08-01T00:00:00.000Z' },
  last_synced_at: null,
  last_error: null,
  created_by: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
}

function serviceClient() {
  const runUpdates: Array<Record<string, unknown>> = []
  const sourceUpdates: Array<Record<string, unknown>> = []
  const run = {
    id: '55555555-5555-4555-8555-555555555555',
    source_id: source.id,
    org_id: source.org_id,
    property_id: source.property_id,
    website_id: null,
    shared_job_id: null,
    status: 'running',
    source_checkpoint: source.checkpoint,
    result_manifest: {},
    discovered_count: 0,
    imported_count: 0,
    duplicate_count: 0,
    rejected_count: 0,
    error_message: null,
    started_at: '2026-08-10T00:00:00.000Z',
    completed_at: null,
    created_at: '2026-08-10T00:00:00.000Z',
  }

  function chain(result?: Record<string, unknown>) {
    const value: Record<string, unknown> = {}
    value.eq = vi.fn(() => value)
    value.select = vi.fn(() => value)
    value.single = vi.fn().mockResolvedValue({
      data: result || null,
      error: null,
    })
    value.then = (
      resolve: (result: { data: null; error: null }) => unknown
    ) => Promise.resolve({ data: null, error: null }).then(resolve)
    return value
  }

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_asset_ingest_runs') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: run, error: null }),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              runUpdates.push(payload)
              return chain({
                ...run,
                ...payload,
              })
            }),
          }
        }
        if (table === 'siteforge_asset_sources') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              sourceUpdates.push(payload)
              return chain()
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    },
    runUpdates,
    sourceUpdates,
  }
}

describe('runAssetSourceIngestion checkpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveCredentialMock.mockResolvedValue({
      accessToken: 'not-exposed',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  })

  it('advances the source checkpoint only after a successful run', async () => {
    discoverFilesMock.mockResolvedValue({
      files: [],
      checkpoint: { modifiedAfter: '2026-08-10T12:00:00.000Z' },
    })
    const service = serviceClient()

    await runAssetSourceIngestion({
      source: source as never,
      userId: source.created_by,
      supabase: service.client as never,
    })

    expect(service.runUpdates).toContainEqual(
      expect.objectContaining({
        status: 'succeeded',
        source_checkpoint: {
          modifiedAfter: '2026-08-10T12:00:00.000Z',
        },
      })
    )
    expect(service.sourceUpdates).toContainEqual(
      expect.objectContaining({
        checkpoint: { modifiedAfter: '2026-08-10T12:00:00.000Z' },
        status: 'active',
      })
    )
  })

  it('retains the old checkpoint when the provider fails', async () => {
    discoverFilesMock.mockRejectedValue(
      new AssetProviderError('Google Drive request failed (503)', {
        retryable: true,
      })
    )
    const service = serviceClient()

    await expect(
      runAssetSourceIngestion({
        source: source as never,
        userId: source.created_by,
        supabase: service.client as never,
      })
    ).rejects.toThrow('Google Drive request failed (503)')

    expect(service.runUpdates).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        result_manifest: { checkpointAdvanced: false },
      })
    )
    expect(service.sourceUpdates).toContainEqual({
      status: 'error',
      last_error: 'Google Drive request failed (503)',
    })
    expect(service.sourceUpdates.some((update) => 'checkpoint' in update)).toBe(
      false
    )
  })
})
