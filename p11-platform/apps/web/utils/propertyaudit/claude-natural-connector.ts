/**
 * Claude Natural Connector for PropertyAudit (Two-phase GEO)
 * Phase 1: Natural conversational response (no property context)
 * Phase 2: Analyzer extracts structured GEO fields from the natural response
 * 
 * Uses Anthropic's native web_search_20250305 tool to capture actual LLM sources
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  type NaturalConnector,
  type NaturalResponse,
  type NaturalAnalyzeContext,
  type NaturalAnalyzeResult,
  type WebSearchSource,
  NaturalExtractionEnvelopeSchema,
  getGeoConfig,
} from './types'

const ALLOWED_FLAGS = new Set([
  'no_sources',
  'possible_hallucination',
  'outdated_info',
  'nap_mismatch',
  'conflicting_prices'
] as const)

function coerceFlags(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj
  const record = obj as Record<string, unknown>
  
  // Coerce answer_block.notes.flags
  const answerBlock = record.answer_block as Record<string, unknown> | undefined
  if (answerBlock?.notes && typeof answerBlock.notes === 'object') {
    const notes = answerBlock.notes as Record<string, unknown>
    if (Array.isArray(notes.flags)) {
      notes.flags = notes.flags.filter(
        (f): f is string => typeof f === 'string' && ALLOWED_FLAGS.has(f as any)
      )
    }
  }
  
  return record
}

function tryParseJson(content: string): unknown {
  // direct parse
  try {
    return JSON.parse(content)
  } catch {
    // continue
  }

  // Strip markdown code blocks
  let cleaned = content.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '')
  cleaned = cleaned.replace(/\n?```\s*$/i, '')
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // continue
  }

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(jsonCandidate)
    } catch {
      // continue
    }
  }

  const match = content.match(/\{[\s\S]*\}$/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      // ignore
    }
  }

  return null
}

function buildAnalyzerPrompt(ctx: NaturalAnalyzeContext): string {
  const expected =
    ctx.expectedCity && ctx.expectedState ? `${ctx.expectedCity}, ${ctx.expectedState}` : 'Unknown'

  return [
    `You are a GEO audit analyzer extracting structured data from a natural LLM response.`,
    ``,
    `IMPORTANT: Be objective. Extract what was ACTUALLY said, not what should have been said.`,
    `Do not invent citations or URLs.`,
    ``,
    `Original Query: "${ctx.queryText}"`,
    `Brand Being Tracked: "${ctx.brandName}"`,
    `Expected Location: ${expected}`,
    `Known brand domains (for inference only): ${ctx.brandDomains.join(', ') || '—'}`,
    `Known competitor domains (for inference only): ${ctx.competitors.join(', ') || '—'}`,
    `Provider search sources (API metadata; may not appear as URLs in the prose):`,
    !ctx.searchSources?.length
      ? 'None provided.'
      : ctx.searchSources
        .filter(source => source.url)
        .map((source, index) => `${index + 1}. ${source.title || source.domain || source.url} — ${source.url}`)
        .join('\n'),
    ``,
    `LLM's Natural Response to Analyze:`,
    `"""`,
    ctx.naturalResponse,
    `"""`,
    ``,
    `Return ONLY raw JSON with this exact schema:`,
    `{`,
    `  "answer_block": {`,
    `    "ordered_entities": [{"name":"...","domain":"...","rationale":"...","position":1}],`,
    `    "citations": [{"url":"...","domain":"...","entity_ref":"..."}],`,
    `    "answer_summary": "...",`,
    `    "notes": {"flags": []}`,
    `  },`,
    `  "analysis": {`,
    `    "ordered_entities": [{"name":"...","domain":"...","position":1,"prominence":"primary","mention_count":1,"first_mention_quote":"..."}],`,
    `    "citations": [{"url":"...","domain":"...","citation_type":"explicit"}],`,
    `    "brand_analysis": {"mentioned": true, "position": 1, "location_stated": "City, ST", "location_correct": true, "prominence": "primary"},`,
    `    "extraction_confidence": 85`,
    `  }`,
    `}`,
    ``,
    `Rules:`,
    `- Extract EVERY named property, community, builder, or listing brand. An empty ordered_entities array is only valid if the response names none of those.`,
    `- If the tracked brand is named, it MUST appear in answer_block.ordered_entities with a 1-based position.`,
    `- Do not flag possible_hallucination when the tracked brand is named in the response.`,
    `- answer_block.ordered_entities MUST be ordered by prominence (best-effort).`,
    `- Put the first_mention_quote into answer_block.ordered_entities[].rationale (include it verbatim).`,
    `- You may include provider search sources in citations even when the prose has no URLs.`,
    `- Do not invent extra URLs. no_sources is set later from the final citation list; do not flag it when provider sources were supplied.`,
  ].join('\n')
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Extract source URLs from Claude's web search tool results
 */
function extractSourcesFromResponse(response: any): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seenUrls = new Set<string>()

  // Look for web search results in the response content
  for (const item of response.content || []) {
    // Check for tool_result blocks that contain web search results
    if (item.type === 'tool_result' && item.content) {
      // Parse web search results from tool content
      try {
        const results = typeof item.content === 'string' 
          ? JSON.parse(item.content) 
          : item.content
        
        if (Array.isArray(results)) {
          for (const result of results) {
            if (result.url && !seenUrls.has(result.url)) {
              seenUrls.add(result.url)
              sources.push({
                title: result.title || '',
                url: result.url,
                domain: extractDomain(result.url),
                snippet: result.snippet || result.description || ''
              })
            }
          }
        }
      } catch {
        // Content wasn't JSON, try to extract URLs from text
      }
    }
    
    // Also check for citations in text blocks (newer Claude responses)
    if (item.type === 'text' && item.citations) {
      for (const citation of item.citations || []) {
        if (citation.url && !seenUrls.has(citation.url)) {
          seenUrls.add(citation.url)
          sources.push({
            title: citation.title || '',
            url: citation.url,
            domain: extractDomain(citation.url),
            snippet: citation.snippet || ''
          })
        }
      }
    }
  }

  return sources
}

export class ClaudeNaturalConnector implements NaturalConnector {
  surface = 'claude' as const

  async getNaturalResponse(query: string): Promise<NaturalResponse> {
    const config = getGeoConfig()
    const client = new Anthropic({ 
      apiKey: config.anthropicApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
    })
    const enableWebSearch = process.env.GEO_ENABLE_WEB_SEARCH === 'true'

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: query },
    ]

    // NOTE: We intentionally do NOT provide property/location context here.
    const systemPrompt = 'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.'

    if (enableWebSearch) {
      // Use Anthropic's native web_search_20250305 tool
      // This captures the actual sources Claude uses (like consumer Claude.ai)
      try {
        console.log('[claude-natural] Using native web search tool')
        
        const response = await client.messages.create({
          model: config.claudeModel,
          max_tokens: 2000,
          temperature: config.temperature,
          system: systemPrompt,
          messages,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 5,
            } as any, // Type assertion needed for newer tool type
          ],
        })

        // Extract text from response
        const textBlocks = (response.content ?? []).filter(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        )
        const text = textBlocks.map(b => b.text).join('\n')

        // Extract sources from the response
        const searchSources = extractSourcesFromResponse(response)
        
        // Also try to extract from any web_search_tool_result blocks
        for (const block of response.content || []) {
          if ((block as any).type === 'web_search_tool_result') {
            const results = (block as any).results || []
            for (const result of results) {
              if (result.url) {
                const exists = searchSources.some(s => s.url === result.url)
                if (!exists) {
                  searchSources.push({
                    title: result.title || '',
                    url: result.url,
                    domain: extractDomain(result.url),
                    snippet: result.snippet || ''
                  })
                }
              }
            }
          }
        }

        console.log(`[claude-natural] Extracted ${searchSources.length} sources from LLM response`)

        return {
          text,
          model: config.claudeModel,
          tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
          usedWebSearch: true,
          searchSources,
          rawResponse: response,
        }
      } catch (error) {
        console.error('[claude-natural] Web search tool error, falling back to no web search:', error)
        // Fall through to no web search
      }
    }

    // Fallback: No web search
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1400,
      temperature: config.temperature,
      system: systemPrompt,
      messages,
    })

    const textBlocks = (response.content ?? []).filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )
    const text = textBlocks.map(b => b.text).join('\n')

    return {
      text,
      model: config.claudeModel,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      usedWebSearch: false,
      searchSources: [],
      rawResponse: response,
    }
  }

  async analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
    const config = getGeoConfig()
    const client = new Anthropic({ 
      apiKey: config.anthropicApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
    })

    const prompt = buildAnalyzerPrompt(context)
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 4000, // Increased to avoid truncation
      temperature: 0,
      system:
        'You are a precise GEO extraction system. Output ONLY valid JSON without markdown or extra text.',
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response
    const textBlocks = (response.content ?? []).filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )
    const contentText = textBlocks.map(b => b.text).join('\n')
    const rawJsonValue = tryParseJson(contentText)

    if (rawJsonValue === null) {
      console.error('[claude-natural] JSON parsing failed - not valid JSON. Raw:', contentText.slice(0, 800))
      throw new Error('Failed to parse natural extraction envelope: response was not valid JSON')
    }

    // Coerce invalid flags to prevent Zod validation failures
    const jsonValue = coerceFlags(rawJsonValue)

    const parsed = NaturalExtractionEnvelopeSchema.safeParse(jsonValue)
    if (!parsed.success) {
      console.error('[claude-natural] Zod validation failed. Raw:', contentText.slice(0, 800))
      console.error('[claude-natural] Zod errors:', JSON.stringify(parsed.error.issues, null, 2))
      const firstError = parsed.error.issues?.[0]?.message || parsed.error.message || 'Schema validation failed'
      throw new Error(`Failed to parse natural extraction envelope JSON: ${firstError}`)
    }

    return { envelope: parsed.data, raw }
  }
}










