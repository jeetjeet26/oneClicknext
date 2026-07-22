import { describe, expect, it } from 'vitest'
import {
  CONTENT_CONTRACT_VERSION,
  findUnsupportedClaims,
  PLATFORM_CAPTION_LIMITS,
  revisionContentSchema,
  validateVariant,
  variantSchema,
  type ContentVariant,
} from './content-contract'

function makeVariant(overrides: Partial<ContentVariant> = {}): ContentVariant {
  return variantSchema.parse({
    platform: 'facebook',
    caption: 'A great day at the community pool.',
    ...overrides,
  })
}

describe('validateVariant', () => {
  it('accepts a simple valid text variant', () => {
    expect(validateVariant(makeVariant())).toEqual([])
  })

  it('flags captions exceeding the platform limit including hashtags', () => {
    const variant = makeVariant({
      platform: 'x',
      caption: 'a'.repeat(PLATFORM_CAPTION_LIMITS.x - 5),
      hashtags: ['apartmentliving'],
    })
    const issues = validateVariant(variant)
    expect(issues.map((issue) => issue.code)).toContain('caption_too_long')
  })

  it('flags too many hashtags for the platform', () => {
    const variant = makeVariant({
      platform: 'x',
      caption: 'short',
      hashtags: ['one', 'two', 'three', 'four', 'five', 'six'],
    })
    expect(validateVariant(variant).map((issue) => issue.code)).toContain('too_many_hashtags')
  })

  it('requires media for instagram and tiktok', () => {
    for (const platform of ['instagram', 'tiktok'] as const) {
      const issues = validateVariant(makeVariant({ platform }))
      expect(issues.map((issue) => issue.code)).toContain('media_required')
    }
  })

  it('flags text format when media is attached', () => {
    const variant = makeVariant({
      mediaUrls: ['https://cdn.example.com/photo.jpg'],
      contentFormat: 'text',
    })
    expect(validateVariant(variant).map((issue) => issue.code)).toContain('format_media_mismatch')
  })

  it('flags media formats without media', () => {
    const variant = makeVariant({ contentFormat: 'image' })
    expect(validateVariant(variant).map((issue) => issue.code)).toContain('missing_media_for_format')
  })

  it('rejects non-https media urls', () => {
    const variant = makeVariant({
      mediaUrls: ['http://cdn.example.com/photo.jpg'],
      contentFormat: 'image',
    })
    expect(validateVariant(variant).map((issue) => issue.code)).toContain('insecure_media_url')
  })
})

describe('findUnsupportedClaims', () => {
  it('returns sensitive claims without citations', () => {
    const unsupported = findUnsupportedClaims([
      { text: 'Rents start at $1,200', type: 'pricing', citations: [] },
      {
        text: 'One month free',
        type: 'concession',
        citations: [{ sourceType: 'structured_offer', sourceId: 'offer-1' }],
      },
      { text: 'We love our residents', type: 'general', citations: [] },
    ])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0].type).toBe('pricing')
  })
})

describe('revisionContentSchema', () => {
  it('parses a full revision and defaults the contract version', () => {
    const parsed = revisionContentSchema.parse({
      conceptSummary: 'Pool season kickoff',
      variants: [
        {
          platform: 'instagram',
          caption: 'Pool season is here.',
          mediaUrls: ['https://cdn.example.com/pool.jpg'],
          contentFormat: 'image',
        },
      ],
    })
    expect(parsed.contractVersion).toBe(CONTENT_CONTRACT_VERSION)
    expect(parsed.claims).toEqual([])
  })

  it('rejects a revision without variants', () => {
    const result = revisionContentSchema.safeParse({
      conceptSummary: 'Empty',
      variants: [],
    })
    expect(result.success).toBe(false)
  })
})
