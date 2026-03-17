export type ForgeStudioDraftReadiness = {
  state: 'partial' | 'ready'
  isReady: boolean
  blockers: string[]
}

type DraftReadinessInput = {
  caption?: unknown
  platform?: unknown
  contentType?: unknown
  mediaType?: unknown
  mediaUrls?: unknown
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasAtLeastOneUrl(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0)
}

export function evaluateForgeStudioDraftReadiness(input: DraftReadinessInput): ForgeStudioDraftReadiness {
  const blockers: string[] = []

  if (!hasText(input.caption)) {
    blockers.push('caption_missing')
  }

  if (!hasText(input.platform)) {
    blockers.push('platform_missing')
  }

  if (!hasText(input.contentType)) {
    blockers.push('content_type_missing')
  }

  const mediaType = typeof input.mediaType === 'string' ? input.mediaType : 'none'
  if (mediaType !== 'none' && !hasAtLeastOneUrl(input.mediaUrls)) {
    blockers.push('media_required_but_missing')
  }

  const isReady = blockers.length === 0
  return {
    state: isReady ? 'ready' : 'partial',
    isReady,
    blockers,
  }
}
