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

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: query }] }],
      systemInstruction:
        'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.',
      generationConfig: {
        temperature: config.temperature,
        topP: config.topP,
      },
    } as any)

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
