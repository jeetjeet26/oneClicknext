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
  aggregateScores,
  getScoreBucket,
  getScoreColor,
  getScoreBgColor,
  type ScoreBucket
} from './evaluator'









