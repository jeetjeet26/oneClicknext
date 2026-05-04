/**
 * Perplexity Natural Connector for PropertyAudit
 * Uses Perplexity's chat API to capture a citation-rich natural answer.
 */

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

function toSources(payload: any): WebSearchSource[] {
  const rawSources = [
    ...(Array.isArray(payload?.citations) ? payload.citations : []),
    ...(Array.isArray(payload?.search_results) ? payload.search_results : []),
    ...(Array.isArray(payload?.choices?.[0]?.message?.citations) ? payload.choices[0].message.citations : []),
  ]

  const seen = new Set<string>()
  return rawSources.reduce<WebSearchSource[]>((acc, source) => {
    const url =
      (typeof source === 'string' ? source : null) ||
      source?.url ||
      source?.link ||
      source?.uri
    if (!url || seen.has(url)) return acc
    seen.add(url)
    acc.push({
      title: source?.title || source?.name || url,
      url,
      domain: extractDomain(url),
      snippet: source?.snippet || source?.description || '',
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

export class PerplexityNaturalConnector implements NaturalConnector {
  surface = 'perplexity' as const

  async getNaturalResponse(query: string): Promise<NaturalResponse> {
    const config = getGeoConfig()
    if (!config.perplexityApiKey) {
      throw new Error('PERPLEXITY_API_KEY is required for Perplexity GEO measurement')
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.perplexityModel,
        temperature: config.temperature,
        top_p: config.topP,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.status}`)
    }

    const payload = await response.json()
    return {
      text: payload?.choices?.[0]?.message?.content || '',
      model: config.perplexityModel,
      tokensUsed: payload?.usage?.total_tokens || 0,
      usedWebSearch: true,
      searchSources: toSources(payload),
      rawResponse: payload,
    }
  }

  async analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
    return delegateAnalysis(context)
  }
}
