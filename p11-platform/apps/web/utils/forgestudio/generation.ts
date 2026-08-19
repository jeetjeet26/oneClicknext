/**
 * ForgeStudio structured content generation.
 *
 * Converts a trusted context bundle + brief into one coordinated concept with
 * genuinely channel-specific variants, using AI SDK structured output against
 * a versioned schema. Claims must cite sources from the bundle; sensitive
 * claims without authoritative citations fail closed before anything is saved.
 *
 * Model routing uses the AI Gateway with Vercel OIDC or a Gateway API key.
 * Tests inject a deterministic fake model.
 */

import { generateText, Output } from 'ai'
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
  type FormatPlanItem,
  type RevisionContent,
  type SocialPlatform,
} from '@/utils/forgestudio/content-contract'
import type { TrustedContextBundle } from '@/utils/forgestudio/context-assembler'
import {
  FORGESTUDIO_MODEL_POLICY_VERSION,
  forgeStudioGatewayOptions,
  resolveForgeStudioTextModel,
  type ForgeStudioTextTier,
} from '@/utils/forgestudio/model-policy'

export const GENERATION_PROMPT_VERSION = 'forgestudio.generation.v1'

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
      variantKey: z.string().min(3).max(200),
      sequenceIndex: z.number().int().min(0),
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
      selectedAssetIds: z
        .array(z.string())
        .max(10)
        .default([])
        .describe('Ordered asset ids for this variant; carousels may select several.'),
      storyboard: z.array(z.object({
        index: z.number().int().min(0),
        description: z.string().min(1).max(1000),
        durationSeconds: z.number().positive().max(30).nullable(),
        overlayText: z.string().max(300).nullable(),
      })).max(20).default([]),
      overlayText: z.array(z.string().max(300)).max(20).default([]),
      safeArea: z.object({
        topPercent: z.number().min(0).max(40),
        rightPercent: z.number().min(0).max(40),
        bottomPercent: z.number().min(0).max(40),
        leftPercent: z.number().min(0).max(40),
      }),
      subtitleText: z.string().max(5000).nullable(),
      thumbnailAssetId: z.string().nullable(),
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
  | 'approved_snapshot'
  | 'legal_policy'
  | 'structured_inventory'
  | 'approved_poi'
  | 'approved_testimonial'
  | 'market_signal'
  | 'performance_signal'

function citationSourceType(sourceId: string): SourceKind {
  const prefix = sourceId.split(':')[0]
  switch (prefix) {
    case 'property_field':
    case 'brand_section':
    case 'kb_document':
    case 'asset':
    case 'operator_input':
    case 'approved_snapshot':
    case 'legal_policy':
    case 'structured_inventory':
    case 'approved_poi':
    case 'approved_testimonial':
    case 'market_signal':
    case 'performance_signal':
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
  formatPlan: FormatPlanItem[]
}): { system: string; prompt: string } {
  const { bundle } = input

  const sourceList = bundle.sources
    .map((source) =>
      `- [${source.id}] (${source.kind}; authority=${source.authority}; uses=${source.allowedUses.join(',')}; stale=${Boolean(source.stale)}; conflicted=${Boolean(source.conflicted)}) ${source.label}: ${source.content}`
    )
    .join('\n')

  const assetList = bundle.assets.length
    ? bundle.assets
        .map(
          (asset) =>
            `- [${asset.id}] ${asset.name} (${asset.assetType}${asset.description ? `: ${asset.description}` : ''})`
        )
        .join('\n')
    : '(none provided)'

  const channelRules = input.formatPlan
    .flatMap((plan) =>
      Array.from({ length: plan.quantity }, (_, sequenceIndex) => ({ ...plan, sequenceIndex }))
    )
    .map(({ platform, contentFormat, sequenceIndex, objective }) => {
      const mediaNote = MEDIA_REQUIRED_PLATFORMS.includes(platform)
        ? ' Media is REQUIRED — select one of the provided assets.'
        : ''
      return `- key=${platform}:${contentFormat}:${sequenceIndex + 1}; platform=${platform}; format=${contentFormat}; sequence=${sequenceIndex}; caption ≤ ${PLATFORM_CAPTION_LIMITS[platform]} chars including hashtags; ≤ ${PLATFORM_HASHTAG_LIMITS[platform]} hashtags.${mediaNote}${objective ? ` Objective: ${objective}` : ''}`
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
6. Only reference assets from the provided asset list by their exact id.
7. A source may support a public factual claim only when its allowed uses include "claim" and it is neither stale nor conflicted.
8. Advisory market/performance signals may guide topic, timing, or format but must never be restated as facts about the property or competitors.
9. Do not use demographic personas, protected-class proxies, neighborhood safety language, or exclusionary audience language.
10. Produce exactly one variant for every requested format-plan key. Carousels need ordered assets and slide overlays; stories/reels/videos need safe areas, storyboard frames, subtitles, and thumbnail guidance.`

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

function resolveModel(tier: ForgeStudioTextTier): Parameters<typeof generateText>[0]['model'] {
  return resolveForgeStudioTextModel(tier)
}

export type GenerationResult = {
  content: RevisionContent
  metadata: {
    model: string
    promptVersion: string
    contractVersion: string
    contextHash: string
    modelPolicyVersion: string
    tier: ForgeStudioTextTier
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    finishReason: string
    warnings: unknown[]
    providerMetadata: Record<string, unknown>
    generationId?: string
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
  formatPlan: FormatPlanItem[]
  actorId?: string | null
  tier?: ForgeStudioTextTier
  /** Test seam: inject a deterministic model. */
  model?: Parameters<typeof generateText>[0]['model']
}): Promise<GenerationResult> {
  const { system, prompt } = buildGenerationPrompt(input)
  const tier = input.tier ?? 'quality'
  const model = input.model ?? resolveModel(tier)
  const gatewayOptions = forgeStudioGatewayOptions({
    propertyId: input.bundle.propertyId,
    actorId: input.actorId,
    operation: 'text',
    tier,
  })

  const result = await generateText({
    model,
    output: Output.object({ schema: generationOutputSchema }),
    system,
    prompt,
    temperature: 0.7,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(120_000),
    ...(typeof model === 'string'
      ? { providerOptions: { gateway: gatewayOptions } }
      : {}),
  })

  const output = result.output
  const validSourceIds = new Set(
    input.bundle.sources
      .filter((source) =>
        source.allowedUses.includes('claim') &&
        !source.stale &&
        !source.conflicted
      )
      .map((source) => source.id)
  )
  const approvedWebsiteUrl = input.bundle.sources.find(
    (source) =>
      source.id === 'property_field:website_url' &&
      source.allowedUses.includes('claim') &&
      source.content.startsWith('https://')
  )?.content ?? null
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
      const orderedAssetIds = [
        ...variant.selectedAssetIds,
        ...(variant.selectedAssetId ? [variant.selectedAssetId] : []),
      ].filter((id, index, values) => values.indexOf(id) === index)
      const selectedAssets = orderedAssetIds
        .map((id) => assetById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const primaryAsset = selectedAssets[0] ?? asset
      const mediaUrls = selectedAssets.length
        ? selectedAssets.map((item) => item.fileUrl)
        : asset
          ? [asset.fileUrl]
          : []
      const inferredFormat =
        primaryAsset && variant.contentFormat === 'text'
          ? primaryAsset.assetType === 'video'
            ? ('video' as const)
            : ('image' as const)
          : variant.contentFormat
      return {
        variantKey: variant.variantKey,
        sequenceIndex: variant.sequenceIndex,
        platform: variant.platform,
        caption: variant.caption,
        hashtags: variant.hashtags.map((tag) => tag.replace(/^#/, '')).filter(Boolean),
        callToAction: variant.callToAction,
        linkUrl: approvedWebsiteUrl,
        assetIds: selectedAssets.length
          ? selectedAssets.map((item) => item.id)
          : asset
            ? [asset.id]
            : [],
        mediaUrls,
        altText: variant.altText,
        contentFormat: inferredFormat,
        platformOptions: {},
        storyboard: variant.storyboard,
        overlayText: variant.overlayText,
        safeArea: variant.safeArea,
        subtitleText: variant.subtitleText,
        thumbnailAssetId: variant.thumbnailAssetId &&
          assetById.has(variant.thumbnailAssetId)
          ? variant.thumbnailAssetId
          : null,
      }
    })

  const expectedVariantKeys = input.formatPlan.flatMap((plan) =>
    Array.from(
      { length: plan.quantity },
      (_, index) => `${plan.platform}:${plan.contentFormat}:${index + 1}`
    )
  )
  const missingVariantKeys = expectedVariantKeys.filter(
    (key) => !variants.some((variant) => variant.variantKey === key)
  )
  if (missingVariantKeys.length > 0) {
    throw new Error(`Generation did not produce variants for: ${missingVariantKeys.join(', ')}`)
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
          : (model as { modelId?: string }).modelId ?? resolveForgeStudioTextModel(tier),
      promptVersion: GENERATION_PROMPT_VERSION,
      contractVersion: CONTENT_CONTRACT_VERSION,
      contextHash: input.bundle.contextHash,
      modelPolicyVersion: FORGESTUDIO_MODEL_POLICY_VERSION,
      tier,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
      },
      finishReason: String(result.finishReason ?? 'unknown'),
      warnings: result.warnings ?? [],
      providerMetadata: (result.providerMetadata ?? {}) as Record<string, unknown>,
      generationId: result.response?.headers?.['x-vercel-ai-gateway-generation-id'],
    },
  }
}
