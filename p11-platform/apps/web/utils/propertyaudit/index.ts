/**
 * PropertyAudit Module
 * GEO (Generative Engine Optimization) tracking for properties
 */

// Types
export * from './types'

// Connectors
export { OpenAIConnector } from './openai-connector'
export { ClaudeConnector } from './claude-connector'
export { OpenAINaturalConnector } from './openai-natural-connector'
export { ClaudeNaturalConnector } from './claude-natural-connector'
export { GeminiNaturalConnector } from './gemini-natural-connector'
export { PerplexityNaturalConnector } from './perplexity-natural-connector'
export { GoogleProxyNaturalConnector } from './google-proxy-natural-connector'

// Evaluator
export {
  evaluateAnswer,
  scoreAnswer,
  scoreCollapsedMetrics,
  reconcileCitationFlags,
  mergeSearchSourcesIntoAnswer,
  aggregateScores,
  getScoreBucket,
  getScoreColor,
  getScoreBgColor,
  type ScoreBucket
} from './evaluator'

export {
  CLIENT_HEADLINE_SURFACES,
  isClientHeadlineSurface,
  isBrandedQuery,
  isDiscoveryQuery,
  isGenericCityCategoryQuery,
  buildHeadlineRates,
  buildClientHeadline,
} from './client-headline'









