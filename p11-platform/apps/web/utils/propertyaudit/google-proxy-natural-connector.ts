/**
 * Google AI Proxy Natural Connector for PropertyAudit
 * Uses Google search results as the grounding layer, then synthesizes a natural answer.
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import {
  type NaturalAnalyzeContext,
  type NaturalAnalyzeResult,
  type NaturalConnector,
  type NaturalResponse,
  type WebSearchSource,
  getGeoConfig,
} from './types'
import { performWebSearch, formatSearchResultsForLLM } from './web-search'
import { OpenAINaturalConnector } from './openai-natural-connector'
import { ClaudeNaturalConnector } from './claude-natural-connector'

function toSearchSources(results: Awaited<ReturnType<typeof performWebSearch>>['results']): WebSearchSource[] {
  return results.map(result => ({
    title: result.title,
    url: result.link,
    domain: result.domain,
    snippet: result.snippet,
  }))
}

async function synthesizeWithOpenAI(prompt: string, apiKey: string, model: string): Promise<string> {
  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant summarizing search-grounded information into a concise natural answer. Do not output JSON.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })
  return response.choices?.[0]?.message?.content?.trim() || ''
}

async function synthesizeWithClaude(prompt: string, apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function synthesizeHeuristically(query: string, sources: WebSearchSource[]): string {
  if (sources.length === 0) {
    return `No Google search results were available for "${query}".`
  }

  const topSnippets = sources
    .slice(0, 4)
    .map(source => `${source.title}: ${source.snippet}`.trim())
    .filter(Boolean)

  return [
    `Based on Google search results for "${query}", the strongest recurring sources are:`,
    ...topSnippets.map((snippet, index) => `${index + 1}. ${snippet}`),
  ].join('\n')
}

async function delegateAnalysis(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
  const config = getGeoConfig()
  if (config.openaiApiKey) {
    return new OpenAINaturalConnector().analyzeResponse(context)
  }
  return new ClaudeNaturalConnector().analyzeResponse(context)
}

export class GoogleProxyNaturalConnector implements NaturalConnector {
  surface = 'google_ai' as const

  async getNaturalResponse(query: string): Promise<NaturalResponse> {
    const config = getGeoConfig()
    const searchResponse = await performWebSearch(query)
    const searchSources = toSearchSources(searchResponse.results)
    const formattedResults = formatSearchResultsForLLM(searchResponse)
    const prompt = [
      `Answer this user query as a helpful assistant using only the Google search evidence below.`,
      `Query: ${query}`,
      ``,
      formattedResults,
      ``,
      `Return a short, natural-language answer. Do not output JSON.`,
    ].join('\n')

    let text = ''
    if (config.openaiApiKey) {
      text = await synthesizeWithOpenAI(prompt, config.openaiApiKey, config.openaiModel)
    } else if (config.anthropicApiKey) {
      text = await synthesizeWithClaude(prompt, config.anthropicApiKey, config.claudeModel)
    } else {
      text = synthesizeHeuristically(query, searchSources)
    }

    return {
      text,
      model: config.googleProxyModel,
      tokensUsed: 0,
      usedWebSearch: searchSources.length > 0,
      searchSources,
      rawResponse: {
        query,
        google_results: searchResponse.results,
        synthesized_with: config.openaiApiKey
          ? 'openai'
          : config.anthropicApiKey
            ? 'claude'
            : 'heuristic',
      },
    }
  }

  async analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
    return delegateAnalysis(context)
  }
}
