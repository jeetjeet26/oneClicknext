// MarketVision model configuration
// Single source of truth for LLM model roles used across MarketVision.
// Override via env without code changes. Resolved model ids are recorded on
// generated artifacts (briefs, insights) for provenance.

/** Extraction: structured data out of scraped competitor content. */
export const MARKETVISION_EXTRACTION_MODEL =
  process.env.MARKETVISION_EXTRACTION_MODEL || 'gpt-4o-mini'

/** Synthesis: brief narratives and recommendation text over deterministic changes. */
export const MARKETVISION_SYNTHESIS_MODEL =
  process.env.MARKETVISION_SYNTHESIS_MODEL || 'gpt-4o-mini'

/** Embedding: semantic search over competitor content chunks. */
export const MARKETVISION_EMBEDDING_MODEL =
  process.env.MARKETVISION_EMBEDDING_MODEL || 'text-embedding-3-small'

/** Schema version stamped on persisted Market Briefs. */
export const MARKET_BRIEF_SCHEMA_VERSION = '1.0'
