/**
 * ReviewFlow model routing.
 *
 * Single source of truth for the model ids and API endpoint used by ReviewFlow
 * AI calls. Everything is env-configurable so production can route through an
 * AI gateway (set REVIEWFLOW_AI_BASE_URL + REVIEWFLOW_AI_API_KEY) without code
 * changes, while local development defaults to the OpenAI API.
 */

/** Fast model for extraction/classification workloads. */
export const REVIEWFLOW_FAST_MODEL = process.env.REVIEWFLOW_FAST_MODEL || 'gpt-4o-mini'

/**
 * Stronger model reserved for ambiguous policy review and high-value response
 * generation (negative/sensitive reviews).
 */
export const REVIEWFLOW_REASONING_MODEL = process.env.REVIEWFLOW_REASONING_MODEL || 'gpt-4o'

/** Prompt versions recorded alongside every persisted analysis/response. */
export const ANALYSIS_PROMPT_VERSION = 'analysis-v2'
export const RESPONSE_PROMPT_VERSION = 'response-v2'

export function getReviewflowAiClientConfig(): { apiKey: string | undefined; baseURL?: string } {
  const baseURL = process.env.REVIEWFLOW_AI_BASE_URL?.trim()
  return {
    apiKey: process.env.REVIEWFLOW_AI_API_KEY || process.env.OPENAI_API_KEY,
    ...(baseURL ? { baseURL } : {}),
  }
}
