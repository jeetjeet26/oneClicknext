/**
 * ForgeStudio social content contract.
 *
 * The versioned shape of a content revision: one coordinated concept with
 * genuinely channel-specific variants, plus explicit claims and citations so
 * every factual statement is traceable to the stored context snapshot.
 */

import { z } from 'zod'

export const CONTENT_CONTRACT_VERSION = 'forgestudio.social.v1'

export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'x'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const CONTENT_FORMATS = ['text', 'image', 'video', 'reel', 'carousel', 'story'] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

/** Practical caption limits per channel (X uses weighted counting; 280 is the safe ceiling for plain text). */
export const PLATFORM_CAPTION_LIMITS: Record<SocialPlatform, number> = {
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
  tiktok: 2200,
  x: 280,
}

export const PLATFORM_HASHTAG_LIMITS: Record<SocialPlatform, number> = {
  instagram: 30,
  facebook: 10,
  linkedin: 10,
  tiktok: 10,
  x: 5,
}

/** Channels that cannot publish without media. */
export const MEDIA_REQUIRED_PLATFORMS: SocialPlatform[] = ['instagram', 'tiktok']

export const claimTypeSchema = z.enum([
  'pricing',
  'concession',
  'availability',
  'testimonial',
  'accessibility',
  'neighborhood',
  'amenity',
  'general',
])

/** Claim types that must cite a fresh authoritative source or fail closed. */
export const SENSITIVE_CLAIM_TYPES: z.infer<typeof claimTypeSchema>[] = [
  'pricing',
  'concession',
  'availability',
  'testimonial',
  'accessibility',
  'neighborhood',
]

export const citationSchema = z.object({
  sourceType: z.enum([
    'property_field',
    'structured_offer',
    'brand_section',
    'kb_document',
    'asset',
    'operator_input',
  ]),
  sourceId: z.string().min(1),
  snippet: z.string().max(500).optional(),
})

export const claimSchema = z.object({
  text: z.string().min(1).max(500),
  type: claimTypeSchema,
  citations: z.array(citationSchema).default([]),
})

export const variantSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  caption: z.string().min(1),
  hashtags: z.array(z.string().min(1).max(100)).default([]),
  callToAction: z.string().max(300).nullish(),
  linkUrl: z.string().url().nullish(),
  assetIds: z.array(z.string().uuid()).default([]),
  mediaUrls: z.array(z.string().url()).default([]),
  altText: z.string().max(1000).nullish(),
  contentFormat: z.enum(CONTENT_FORMATS).default('text'),
  platformOptions: z.record(z.string(), z.unknown()).default({}),
})

export const revisionContentSchema = z.object({
  contractVersion: z.literal(CONTENT_CONTRACT_VERSION).default(CONTENT_CONTRACT_VERSION),
  conceptSummary: z.string().min(1).max(2000),
  variants: z.array(variantSchema).min(1),
  claims: z.array(claimSchema).default([]),
})

export type RevisionContent = z.infer<typeof revisionContentSchema>
export type ContentVariant = z.infer<typeof variantSchema>
export type ContentClaim = z.infer<typeof claimSchema>

export type VariantValidationIssue = {
  code: string
  message: string
}

/** Deterministic per-channel validation, independent of the LLM. */
export function validateVariant(variant: ContentVariant): VariantValidationIssue[] {
  const issues: VariantValidationIssue[] = []
  const limit = PLATFORM_CAPTION_LIMITS[variant.platform]
  const hashtagSuffix = variant.hashtags.length
    ? `\n\n${variant.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`
    : ''
  const fullLength = variant.caption.length + hashtagSuffix.length

  if (fullLength > limit) {
    issues.push({
      code: 'caption_too_long',
      message: `Caption with hashtags is ${fullLength} characters; ${variant.platform} allows ${limit}.`,
    })
  }

  if (variant.hashtags.length > PLATFORM_HASHTAG_LIMITS[variant.platform]) {
    issues.push({
      code: 'too_many_hashtags',
      message: `${variant.hashtags.length} hashtags exceeds the ${PLATFORM_HASHTAG_LIMITS[variant.platform]} recommended for ${variant.platform}.`,
    })
  }

  const hasMedia = variant.mediaUrls.length > 0 || variant.assetIds.length > 0
  if (MEDIA_REQUIRED_PLATFORMS.includes(variant.platform) && !hasMedia) {
    issues.push({
      code: 'media_required',
      message: `${variant.platform} posts require an image or video.`,
    })
  }

  if (hasMedia && variant.contentFormat === 'text') {
    issues.push({
      code: 'format_media_mismatch',
      message: 'Media is attached but the content format is text.',
    })
  }

  if ((variant.contentFormat !== 'text') && !hasMedia) {
    issues.push({
      code: 'missing_media_for_format',
      message: `Content format ${variant.contentFormat} requires media.`,
    })
  }

  if (variant.mediaUrls.some((url) => !url.startsWith('https://'))) {
    issues.push({
      code: 'insecure_media_url',
      message: 'All media URLs must use https.',
    })
  }

  return issues
}

/**
 * Claims of sensitive types must carry at least one authoritative citation.
 * Returns the offending claims (empty array means the revision is safe).
 */
export function findUnsupportedClaims(claims: ContentClaim[]): ContentClaim[] {
  return claims.filter(
    (claim) => SENSITIVE_CLAIM_TYPES.includes(claim.type) && claim.citations.length === 0
  )
}
