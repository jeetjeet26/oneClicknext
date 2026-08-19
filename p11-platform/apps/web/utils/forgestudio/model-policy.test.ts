import { afterEach, describe, expect, it } from 'vitest'
import {
  forgeStudioGatewayOptions,
  resolveForgeStudioImageModel,
  resolveForgeStudioTextModel,
  resolveForgeStudioVideoModel,
} from './model-policy'

describe('ForgeStudio model policy', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses verified defaults for each modality', () => {
    expect(resolveForgeStudioTextModel()).toBe('openai/gpt-5.4')
    expect(resolveForgeStudioImageModel('final')).toBe('google/imagen-4.0-generate-001')
    expect(resolveForgeStudioVideoModel('social')).toBe('google/veo-3.1-fast-generate-001')
  })

  it('rejects unverified model overrides', () => {
    process.env.FORGESTUDIO_TEXT_MODEL_QUALITY = 'openai/gpt-4o'
    expect(() => resolveForgeStudioTextModel()).toThrow(/unverified ForgeStudio model/)
  })

  it('attributes Gateway calls to feature, property, operation, and tier', () => {
    expect(forgeStudioGatewayOptions({
      propertyId: 'property-1',
      actorId: 'user-1',
      operation: 'video',
      tier: 'social',
    })).toEqual({
      user: 'user-1',
      tags: [
        'feature:forgestudio',
        'operation:video',
        'tier:social',
        'property:property-1',
      ],
    })
  })
})
