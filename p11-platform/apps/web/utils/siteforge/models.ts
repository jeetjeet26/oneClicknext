// SiteForge model configuration
// Single source of truth for LLM model ids used across the SiteForge pipeline.
// Override via env without code changes.

export const SITEFORGE_CLAUDE_MODEL =
  process.env.SITEFORGE_CLAUDE_MODEL || 'claude-fable-5'

export const SITEFORGE_EDITOR_MODEL =
  process.env.SITEFORGE_EDITOR_MODEL || 'anthropic/claude-fable-5'

export const SITEFORGE_EMBEDDING_MODEL =
  process.env.SITEFORGE_EMBEDDING_MODEL || 'text-embedding-3-small'

export const SITEFORGE_SEMANTIC_EDITOR_MODELS = {
  targeted:
    process.env.SITEFORGE_SEMANTIC_EDITOR_MODEL_TARGETED ||
    'claude-sonnet-5',
  structural:
    process.env.SITEFORGE_SEMANTIC_EDITOR_MODEL_STRUCTURAL ||
    'claude-sonnet-5',
  creative:
    process.env.SITEFORGE_SEMANTIC_EDITOR_MODEL_CREATIVE ||
    'claude-fable-5',
} as const

export type SiteForgeSemanticEditorTier =
  keyof typeof SITEFORGE_SEMANTIC_EDITOR_MODELS

const structuralIntent =
  /\b(add|remove|move|reorder|layout|structure|section|page|navigation|header|footer|redesign)\b/i
const creativeIntent =
  /\b(full[- ]site|whole site|site[- ]wide|redesign|rebrand|custom css|javascript|php|animation|interaction|extension)\b/i

export function resolveSiteForgeSemanticEditorTier(input: {
  scope: 'section' | 'page' | 'site'
  userIntent: string
}): SiteForgeSemanticEditorTier {
  if (input.scope === 'site') {
    return creativeIntent.test(input.userIntent) ? 'creative' : 'structural'
  }
  if (structuralIntent.test(input.userIntent)) return 'structural'
  return 'targeted'
}

export function siteForgeSemanticEditorEscalationTier(
  tier: SiteForgeSemanticEditorTier
): SiteForgeSemanticEditorTier | null {
  if (tier === 'targeted') return 'structural'
  if (tier === 'structural') return 'creative'
  return null
}

export function resolveSiteForgeSemanticEditorModel(
  tier: SiteForgeSemanticEditorTier
): string {
  return SITEFORGE_SEMANTIC_EDITOR_MODELS[tier]
}
