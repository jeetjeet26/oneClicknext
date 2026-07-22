// SiteForge model configuration
// Single source of truth for LLM model ids used across the SiteForge pipeline.
// Override via env without code changes.

export const SITEFORGE_CLAUDE_MODEL =
  process.env.SITEFORGE_CLAUDE_MODEL || 'claude-sonnet-4-20250514'

export const SITEFORGE_EMBEDDING_MODEL =
  process.env.SITEFORGE_EMBEDDING_MODEL || 'text-embedding-3-small'
