/**
 * Gemini Natural Connector for PropertyAudit
 * Phase 1: Get a natural answer from Gemini, preferably with Google grounding.
 * Phase 2: Reuse the existing analyzer to extract structured GEO fields.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  type NaturalAnalyzeContext,
  type NaturalAnalyzeResult,
  type NaturalConnector,
  type NaturalResponse,
  type WebSearchSource,
  getGeoConfig,
} from './types'
import { OpenAINaturalConnector } from './openai-natural-connector'
import { ClaudeNaturalConnector } from './claude-natural-connector'

type RetryableError = Error & {
  status?: number
  statusCode?: number
  code?: number | string
  response?: {
    headers?: {
      get?: (name: string) => string | null
      [key: string]: unknown
    }
  }
}

let geminiThrottleQueue: Promise<void> = Promise.resolve()
let lastGeminiRequestAt = 0

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withGeminiThrottle<T>(operation: () => Promise<T>): Promise<T> {
  const minIntervalMs = parsePositiveInt(process.env.GEO_GEMINI_THROTTLE_MS, 1000)
  const queued = geminiThrottleQueue.then(async () => {
    const elapsed = Date.now() - lastGeminiRequestAt
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed)
    }
    lastGeminiRequestAt = Date.now()
    return operation()
  })
  geminiThrottleQueue = queued.then(() => undefined, () => undefined)
  return queued
}

function isRateLimitError(error: unknown): boolean {
  const candidate = error as RetryableError
  const status = candidate?.status ?? candidate?.statusCode ?? candidate?.code
  if (status === 429 || status === '429') return true
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase()
  return message.includes('429') || message.includes('too many requests') || message.includes('rate limit')
}

function getRetryAfterMs(error: unknown): number | null {
  const headers = (error as RetryableError)?.response?.headers
  const retryAfter = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : typeof headers?.['retry-after'] === 'string'
      ? headers['retry-after']
      : null
  if (!retryAfter) return null
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(retryAfter)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null
}

async function withGeminiRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxRetries = parsePositiveInt(process.env.GEO_GEMINI_MAX_RETRIES, 3)
  const baseBackoffMs = parsePositiveInt(process.env.GEO_GEMINI_BASE_BACKOFF_MS, 5000)
  const maxBackoffMs = parsePositiveInt(process.env.GEO_GEMINI_MAX_BACKOFF_MS, 90000)

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withGeminiThrottle(operation)
    } catch (error) {
      lastError = error
      if (!isRateLimitError(error) || attempt === maxRetries) {
        throw error
      }

      const retryAfterMs = getRetryAfterMs(error)
      const exponentialBackoff = Math.min(maxBackoffMs, baseBackoffMs * (3 ** attempt))
      const jitter = Math.floor(Math.random() * Math.min(1000, Math.max(1, exponentialBackoff * 0.2)))
      const delayMs = retryAfterMs ?? Math.min(maxBackoffMs, exponentialBackoff + jitter)
      console.warn(`[geo] Gemini rate limited; retrying attempt ${attempt + 2}/${maxRetries + 1} in ${delayMs}ms`)
      await sleep(delayMs)
    }
  }

  throw lastError
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function extractSourcesFromGeminiResponse(response: any): WebSearchSource[] {
  const chunks: any[] =
    response?.candidates?.[0]?.groundingMetadata?.groundingChunks ||
    response?.response?.candidates?.[0]?.groundingMetadata?.groundingChunks ||
    []

  const seen = new Set<string>()
  return chunks.reduce<WebSearchSource[]>((acc, chunk) => {
    const uri = chunk?.web?.uri || chunk?.retrievedContext?.uri
    if (!uri || seen.has(uri)) return acc
    seen.add(uri)
    acc.push({
      title: chunk?.web?.title || chunk?.retrievedContext?.title || uri,
      url: uri,
      domain: extractDomain(uri),
      snippet: chunk?.web?.snippet || chunk?.retrievedContext?.text || '',
    })
    return acc
  }, [])
}

async function delegateAnalysis(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
  const config = getGeoConfig()
  if (config.openaiApiKey) {
    return new OpenAINaturalConnector().analyzeResponse(context)
  }
  return new ClaudeNaturalConnector().analyzeResponse(context)
}

export class GeminiNaturalConnector implements NaturalConnector {
  surface = 'gemini' as const

  async getNaturalResponse(query: string): Promise<NaturalResponse> {
    const config = getGeoConfig()
    if (!config.geminiApiKey) {
      throw new Error('GOOGLE_GEMINI_API_KEY is required for Gemini GEO measurement')
    }

    const client = new GoogleGenerativeAI(config.geminiApiKey)
    const model = client.getGenerativeModel({
      model: config.geminiModel,
      ...(process.env.GEO_ENABLE_WEB_SEARCH === 'true'
        ? ({ tools: [{ googleSearchRetrieval: {} }] } as any)
        : {}),
    } as any)

    const result = await withGeminiRetry(() => model.generateContent({
      contents: [{ role: 'user', parts: [{ text: query }] }],
      systemInstruction:
        'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.',
      generationConfig: {
        temperature: config.temperature,
        topP: config.topP,
      },
    } as any))

    const response = await result.response
    const text = typeof response.text === 'function' ? response.text() : String(response.text || '')
    const searchSources = extractSourcesFromGeminiResponse(response)
    const usageMetadata = response?.usageMetadata as
      | { totalTokenCount?: number; total_token_count?: number }
      | undefined

    return {
      text,
      model: config.geminiModel,
      tokensUsed:
        usageMetadata?.totalTokenCount ||
        usageMetadata?.total_token_count ||
        0,
      usedWebSearch: searchSources.length > 0,
      searchSources,
      rawResponse: response,
    }
  }

  async analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
    return delegateAnalysis(context)
  }
}
