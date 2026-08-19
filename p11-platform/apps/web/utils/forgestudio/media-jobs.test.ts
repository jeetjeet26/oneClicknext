import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

vi.mock('@/utils/storage/asset-service', () => ({
  STORAGE_BUCKETS: { CONTENT_ASSETS: 'content-assets' },
  uploadAndSaveGeneratedAsset: vi.fn(),
}))

function insertBuilder(result: { data: unknown; error: unknown }) {
  return {
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

describe('ForgeStudio media jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calculates bounded costs for image and video tiers', async () => {
    const { estimateMediaCost } = await import('./media-jobs')
    expect(estimateMediaCost({
      modality: 'image',
      tier: 'final',
      prompt: 'Create campaign art',
      aspectRatio: '1:1',
      altText: 'Campaign art',
      name: 'Campaign art',
      maxCostUsd: 1,
    })).toBe(0.04)
    expect(estimateMediaCost({
      modality: 'video',
      tier: 'social',
      prompt: 'Animate the approved property image',
      aspectRatio: '9:16',
      altText: 'Animated property image',
      name: 'Property reel',
      maxCostUsd: 5,
      durationSeconds: 8,
      generateAudio: true,
    })).toBeCloseTo(1.2)
  })

  it('rejects requests whose estimated cost exceeds the caller ceiling', async () => {
    const { enqueueMediaGeneration } = await import('./media-jobs')
    await expect(enqueueMediaGeneration({
      orgId: '11111111-1111-4111-8111-111111111111',
      propertyId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      request: {
        modality: 'video',
        tier: 'premium',
        prompt: 'Create a premium property video',
        aspectRatio: '16:9',
        altText: 'Premium property video',
        name: 'Premium video',
        maxCostUsd: 1,
        durationSeconds: 8,
        generateAudio: true,
      },
    })).rejects.toThrow(/exceeds the request ceiling/)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('persists an idempotent shared job with model and cost metadata', async () => {
    const queued = {
      id: 'job-1',
      domain: 'forgestudio.media',
      lifecycle_status: 'queued',
    }
    const builder = insertBuilder({ data: queued, error: null })
    fromMock.mockReturnValue(builder)

    const { enqueueMediaGeneration } = await import('./media-jobs')
    const result = await enqueueMediaGeneration({
      orgId: '11111111-1111-4111-8111-111111111111',
      propertyId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      request: {
        modality: 'image',
        tier: 'final',
        prompt: 'Create approved campaign art',
        aspectRatio: '1:1',
        altText: 'Campaign art',
        name: 'Campaign art',
        maxCostUsd: 1,
      },
    })

    expect(result).toEqual(queued)
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'forgestudio.media',
      dedupe_key: expect.stringMatching(/^forgestudio-media:/),
      payload: expect.objectContaining({
        model: 'google/imagen-4.0-generate-001',
        estimatedCostUsd: 0.04,
      }),
    }))
  })
})
