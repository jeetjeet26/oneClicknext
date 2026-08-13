import { describe, expect, it, vi } from 'vitest'

vi.mock('./source-adapters', async importOriginal => ({
  ...(await importOriginal<typeof import('./source-adapters')>()),
  resolveAssetSourceCredential: vi.fn().mockResolvedValue({
    accessToken: 'server-token',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  }),
  discoverAssetSourceFiles: vi.fn().mockResolvedValue({
    files: [
      {
        sourceIdentity: 'google_drive:file-1',
        providerFileId: 'file-1',
        name: 'lobby.jpg',
        mediaType: 'image/jpeg',
        size: 4,
        modifiedAt: '2026-08-10T12:00:00.000Z',
        providerHash: 'provider-hash',
        downloadRef: 'file-1',
      },
    ],
    checkpoint: { modifiedAfter: '2026-08-10T12:00:00.000Z' },
  }),
  downloadAssetSourceFile: vi.fn().mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mediaType: 'image/jpeg',
  }),
}))

vi.mock('./image-analysis', () => ({
  analyzeImageContent: vi.fn().mockResolvedValue({
    metadata: {
      contentHash: 'a'.repeat(64),
      byteLength: 4,
      width: 1,
      height: 1,
    },
    suggestedRole: 'gallery',
    mode: 'deterministic',
    observedElements: [],
    qualityNotes: [],
    altText: 'Lobby',
    focalPoint: null,
    cropSuggestion: null,
    qualityScore: 1,
  }),
}))

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
  checkpoint: {},
  last_synced_at: null,
  last_error: null,
  created_by: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
}

describe('concurrent asset ingestion', () => {
  it('cleans only its attempt path and reconciles to the winning asset', async () => {
    const runId = '55555555-5555-4555-8555-555555555555'
    const winnerId = '66666666-6666-4666-8666-666666666666'
    const removed: string[][] = []
    const runUpdates: Record<string, unknown>[] = []
    let contentLookup = 0

    const service = {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          remove: vi.fn(async (paths: string[]) => {
            removed.push(paths)
            return { error: null }
          }),
          getPublicUrl: vi.fn((path: string) => ({
            data: { publicUrl: `https://assets.example/${path}` },
          })),
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'siteforge_asset_ingest_runs') {
          const row = {
            id: runId,
            source_id: source.id,
            org_id: source.org_id,
            property_id: source.property_id,
            website_id: null,
            status: 'running',
            source_checkpoint: {},
            result_manifest: {},
          }
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              runUpdates.push(payload)
              const chain: Record<string, unknown> = {}
              chain.eq = vi.fn(() => chain)
              chain.select = vi.fn(() => chain)
              chain.single = vi
                .fn()
                .mockResolvedValue({ data: { ...row, ...payload }, error: null })
              return chain
            }),
          }
        }
        if (table === 'content_assets') {
          const queryChain = () => {
            const chain: Record<string, unknown> = {}
            chain.select = vi.fn(() => chain)
            chain.eq = vi.fn(() => chain)
            chain.is = vi.fn(() => chain)
            chain.maybeSingle = vi.fn(async () => {
              contentLookup += 1
              return contentLookup === 1
                ? { data: null, error: null }
                : { data: { id: winnerId }, error: null }
            })
            return chain
          }
          return {
            ...queryChain(),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              })),
            })),
          }
        }
        if (table === 'siteforge_asset_sources') {
          return {
            update: vi.fn(() => {
              const chain: Record<string, unknown> = {}
              chain.eq = vi.fn(() => chain)
              chain.then = (
                resolve: (value: { data: null; error: null }) => unknown
              ) => Promise.resolve({ data: null, error: null }).then(resolve)
              return chain
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const completed = await runAssetSourceIngestion({
      source: source as never,
      userId: source.created_by,
      supabase: service as never,
    })

    const attemptPath = `${source.property_id}/siteforge/sources/${source.id}/attempts/${runId}/${'a'.repeat(64)}.jpg`
    expect(removed).toEqual([[attemptPath]])
    expect(completed).toMatchObject({
      status: 'succeeded',
      imported_count: 0,
      duplicate_count: 1,
    })
    expect(runUpdates[0]?.result_manifest).toEqual(
      expect.objectContaining({
        duplicates: [
          {
            assetId: winnerId,
            sourceIdentity: 'google_drive:file-1',
          },
        ],
      })
    )
  })
})
