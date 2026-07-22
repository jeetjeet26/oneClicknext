/**
 * ForgeStudio structured content generation.
 *
 * Converts a trusted context bundle + brief into one coordinated concept with
 * genuinely channel-specific variants, using AI SDK structured output against
 * a versioned schema. Claims must cite sources from the bundle; sensitive
 * claims without authoritative citations fail closed before anything is saved.
 *
 * Model routing prefers the AI Gateway (`AI_GATEWAY_API_KEY`) and falls back
 * to direct OpenAI. Tests inject a deterministic fake model.
 */

import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  CONTENT_CONTRACT_VERSION,
  CONTENT_FORMATS,
  findUnsupportedClaims,
  MEDIA_REQUIRED_PLATFORMS,
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_HASHTAG_LIMITS,
  SOCIAL_PLATFORMS,
  type ContentClaim,
  type RevisionContent,
  type SocialPlatform,
} from '@/utils/forgestudio/content-contract'
import type { TrustedContextBundle } from '@/utils/forgestudio/context-assembler'

export const GENERATION_PROMPT_VERSION = 'forgestudio.generation.v1'
const DEFAULT_MODEL_ID = 'gpt-4o-mini'

export class GenerationClaimError extends Error {
  unsupportedClaims: ContentClaim[]

  constructor(unsupportedClaims: ContentClaim[]) {
    super(
      `Generation produced ${unsupportedClaims.length} sensitive claim(s) without an authoritative citation: ` +
        unsupportedClaims.map((claim) => `${claim.type}: "${claim.text}"`).join('; ')
    )
    this.name = 'GenerationClaimError'
    this.unsupportedClaims = unsupportedClaims
  }
}

/** Schema the LLM must emit. Claims cite context source ids, not free text. */
export const generationOutputSchema = z.object({
  conceptSummary: z
    .string()
    .min(1)
    .describe('One or two sentences describing the coordinated creative concept.'),
  variants: z.array(
    z.object({
      platform: z.enum(SOCIAL_PLATFORMS),
      caption: z.string().min(1).describe('Channel-native caption, no placeholder text.'),
      hashtags: z.array(z.string()).describe('Hashtags without the # prefix.'),
      callToAction: z.string().nullable(),
      altText: z
        .string()
        .nullable()
        .describe('Accessibility alt text describing the attached media, if any.'),
      contentFormat: z.enum(CONTENT_FORMATS),
      selectedAssetId: z
        .string()
        .nullable()
        .describe('The id of one provided community asset to attach, or null.'),
    })
  ),
  claims: z.array(
    z.object({
      text: z.string().min(1),
      type: z.enum([
        'pricing',
        'concession',
        'availability',
        'testimonial',
        'accessibility',
        'neighborhood',
        'amenity',
        'general',
      ]),
      sourceIds: z
        .array(z.string())
        .describe('Ids of the context sources that support this claim.'),
    })
  ),
})

export type GenerationOutput = z.infer<typeof generationOutputSchema>

type SourceKind =
  | 'property_field'
  | 'structured_offer'
  | 'brand_section'
  | 'kb_document'
  | 'asset'
  | 'operator_input'

function citationSourceType(sourceId: string): SourceKind {
  const prefix = sourceId.split(':')[0]
  switch (prefix) {
    case 'property_field':
    case 'brand_section':
    case 'kb_document':
    case 'asset':
    case 'operator_input':
      return prefix
    case 'channel_settings':
      return 'property_field'
    default:
      return 'operator_input'
  }
}

export function buildGenerationPrompt(input: {
  bundle: TrustedContextBundle
  objective: string
  topic?: string | null
  audience?: string | null
  constraints?: Record<string, unknown>
  channels: SocialPlatform[]
}): { system: string; prompt: string } {
  const { bundle } = input

  const sourceList = bundle.sources
    .map((source) => `- [${source.id}] (${source.kind}) ${source.label}: ${source.content}`)
    .join('\n')

  const assetList = bundle.assets.length
    ? bundle.assets
        .map(
          (asset) =>
            `- [${asset.id}] ${asset.name} (${asset.assetType}${asset.description ? `: ${asset.description}` : ''})`
        )
        .join('\n')
    : '(none provided)'

  const channelRules = input.channels
    .map((platform) => {
      const mediaNote = MEDIA_REQUIRED_PLATFORMS.includes(platform)
        ? ' Media is REQUIRED — select one of the provided assets.'
        : ''
      return `- ${platform}: caption ≤ ${PLATFORM_CAPTION_LIMITS[platform]} chars including hashtags, ≤ ${PLATFORM_HASHTAG_LIMITS[platform]} hashtags.${mediaNote}`
    })
    .join('\n')

  const constraints = input.constraints ?? {}
  const mustInclude = Array.isArray(constraints.mustInclude) ? constraints.mustInclude : []
  const mustAvoid = Array.isArray(constraints.mustAvoid) ? constraints.mustAvoid : []

  const system = `You are the content strategist for a multifamily residential community.
You write coordinated social media content that is warm, specific, and channel-native — never generic AI filler.

${bundle.brandVoice ? `Brand voice: ${bundle.brandVoice}` : 'Tone: professional yet approachable.'}
${input.audience || bundle.targetAudience ? `Audience: ${input.audience || bundle.targetAudience}` : ''}

HARD RULES:
1. Use ONLY facts found in the provided context sources. Do not invent pricing, availability, move-in specials, testimonials, neighborhood claims, or amenity details.
2. Every factual claim you make must appear in the claims array, citing the supporting source ids.
3. Claims about pricing, concessions, availability, testimonials, accessibility, or the neighborhood REQUIRE at least one supporting source id. If no source supports such a claim, do not make it.
4. Produce one variant per requested channel; each variant must feel native to that channel (different hooks, structure, and length), not the same text copied.
5. Hashtags must not include the # symbol. Never use placeholder text like [Property Name].
6. Only reference assets from the provided asset list by their exact id.`

  const prompt = `OBJECTIVE: ${input.objective}
${input.topic ? `TOPIC: ${input.topic}` : ''}
${mustInclude.length ? `MUST INCLUDE: ${mustInclude.join('; ')}` : ''}
${mustAvoid.length ? `MUST AVOID: ${mustAvoid.join('; ')}` : ''}

REQUESTED CHANNELS AND RULES:
${channelRules}

CONTEXT SOURCES (cite these ids in claims):
${sourceList}

AVAILABLE COMMUNITY ASSETS:
${assetList}

Create one coordinated concept with a channel-specific variant for every requested channel.`

  return { system, prompt }
}

function resolveModel(): Parameters<typeof generateObject>[0]['model'] {
  const modelId = process.env.FORGESTUDIO_GENERATION_MODEL || DEFAULT_MODEL_ID
  if (process.env.AI_GATEWAY_API_KEY) {
    // Plain "provider/model" strings route through the AI Gateway.
    return modelId.includes('/') ? modelId : `openai/${modelId}`
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('No AI provider configured: set AI_GATEWAY_API_KEY or OPENAI_API_KEY')
  }
  return createOpenAI({ apiKey })(modelId.includes('/') ? modelId.split('/')[1] : modelId)
}

export type GenerationResult = {
  content: RevisionContent
  metadata: {
    model: string
    promptVersion: string
    contractVersion: string
    contextHash: string
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    finishReason: string
  }
}

/**
 * Generate revision content for a brief from a trusted context bundle.
 * Fails closed (GenerationClaimError) when sensitive claims lack citations.
 */
export async function generateRevisionContent(input: {
  bundle: TrustedContextBundle
  objective: string
  topic?: string | null
  audience?: string | null
  constraints?: Record<string, unknown>
  channels: SocialPlatform[]
  /** Test seam: inject a deterministic model. */
  model?: Parameters<typeof generateObject>[0]['model']
}): Promise<GenerationResult> {
  const { system, prompt } = buildGenerationPrompt(input)
  const model = input.model ?? resolveModel()

  const result = await generateObject({
    model,
    schema: generationOutputSchema,
    system,
    prompt,
    temperature: 0.7,
  })

  const output = result.object
  const validSourceIds = new Set(input.bundle.sources.map((source) => source.id))
  const assetById = new Map(input.bundle.assets.map((asset) => [asset.id, asset]))

  // Convert LLM claims (source id references) into contract claims (citations),
  // dropping citations that reference source ids not in the bundle.
  const claims: ContentClaim[] = output.claims.map((claim) => ({
    text: claim.text,
    type: claim.type,
    citations: claim.sourceIds
      .filter((sourceId) => validSourceIds.has(sourceId))
      .map((sourceId) => ({
        sourceType: citationSourceType(sourceId),
        sourceId,
      })),
  }))

  // Fail closed: sensitive claims must survive with at least one real citation.
  const unsupported = findUnsupportedClaims(claims)
  if (unsupported.length > 0) {
    throw new GenerationClaimError(unsupported)
  }

  // Only generate variants for requested channels; attach selected assets.
  const requested = new Set(input.channels)
  const variants = output.variants
    .filter((variant) => requested.has(variant.platform))
    .map((variant) => {
      const asset = variant.selectedAssetId ? assetById.get(variant.selectedAssetId) : undefined
      const mediaUrls = asset ? [asset.fileUrl] : []
      const inferredFormat =
        asset && variant.contentFormat === 'text'
          ? asset.assetType === 'video'
            ? ('video' as const)
            : ('image' as const)
          : variant.contentFormat
      return {
        platform: variant.platform,
        caption: variant.caption,
        hashtags: variant.hashtags.map((tag) => tag.replace(/^#/, '')).filter(Boolean),
        callToAction: variant.callToAction,
        linkUrl: null,
        assetIds: asset ? [asset.id] : [],
        mediaUrls,
        altText: variant.altText,
        contentFormat: inferredFormat,
        platformOptions: {},
      }
    })

  const missingChannels = input.channels.filter(
    (channel) => !variants.some((variant) => variant.platform === channel)
  )
  if (missingChannels.length > 0) {
    throw new Error(`Generation did not produce variants for: ${missingChannels.join(', ')}`)
  }

  const content: RevisionContent = {
    contractVersion: CONTENT_CONTRACT_VERSION,
    conceptSummary: output.conceptSummary,
    variants,
    claims,
  }

  return {
    content,
    metadata: {
      model:
        typeof model === 'string'
          ? model
          : (model as { modelId?: string }).modelId ?? DEFAULT_MODEL_ID,
      promptVersion: GENERATION_PROMPT_VERSION,
      contractVersion: CONTENT_CONTRACT_VERSION,
      contextHash: input.bundle.contextHash,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
      },
      finishReason: String(result.finishReason ?? 'unknown'),
    },
  }
}
