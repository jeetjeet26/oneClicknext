export const FORGESTUDIO_MODEL_POLICY_VERSION = 'forgestudio.models.2026-08-13'

export const VERIFIED_FORGESTUDIO_MODELS = {
  text: {
    quality: 'openai/gpt-5.4',
    challenger: 'anthropic/claude-sonnet-4.6',
    utility: 'google/gemini-3.1-flash-lite',
  },
  image: {
    iterative: 'google/gemini-3.1-flash-image',
    draft: 'google/imagen-4.0-fast-generate-001',
    final: 'google/imagen-4.0-generate-001',
    premium: 'google/imagen-4.0-ultra-generate-001',
    challenger: 'openai/gpt-image-2',
  },
  video: {
    preview: 'google/veo-3.1-lite-generate-001',
    social: 'google/veo-3.1-fast-generate-001',
    premium: 'google/veo-3.1-generate-001',
  },
} as const

const verifiedModelIds = new Set<string>(
  Object.values(VERIFIED_FORGESTUDIO_MODELS)
    .flatMap((group) => Object.values(group))
)

export type ForgeStudioTextTier = keyof typeof VERIFIED_FORGESTUDIO_MODELS.text
export type ForgeStudioImageTier = keyof typeof VERIFIED_FORGESTUDIO_MODELS.image
export type ForgeStudioVideoTier = keyof typeof VERIFIED_FORGESTUDIO_MODELS.video

function configuredModel(envName: string, fallback: string): string {
  const configured = process.env[envName]?.trim()
  if (!configured) return fallback
  if (!verifiedModelIds.has(configured)) {
    throw new Error(
      `${envName} references an unverified ForgeStudio model (${configured}); update the verified model policy first`
    )
  }
  return configured
}

export function resolveForgeStudioTextModel(tier: ForgeStudioTextTier = 'quality'): string {
  return configuredModel(
    `FORGESTUDIO_TEXT_MODEL_${tier.toUpperCase()}`,
    VERIFIED_FORGESTUDIO_MODELS.text[tier]
  )
}

export function resolveForgeStudioImageModel(tier: ForgeStudioImageTier): string {
  return configuredModel(
    `FORGESTUDIO_IMAGE_MODEL_${tier.toUpperCase()}`,
    VERIFIED_FORGESTUDIO_MODELS.image[tier]
  )
}

export function resolveForgeStudioVideoModel(tier: ForgeStudioVideoTier): string {
  return configuredModel(
    `FORGESTUDIO_VIDEO_MODEL_${tier.toUpperCase()}`,
    VERIFIED_FORGESTUDIO_MODELS.video[tier]
  )
}

export function forgeStudioGatewayOptions(input: {
  propertyId: string
  actorId?: string | null
  operation: 'text' | 'image' | 'video'
  tier: string
}) {
  return {
    user: input.actorId || input.propertyId,
    tags: [
      'feature:forgestudio',
      `operation:${input.operation}`,
      `tier:${input.tier}`,
      `property:${input.propertyId}`,
    ],
  }
}
