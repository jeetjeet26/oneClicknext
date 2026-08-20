/**
 * OpenAI Natural Connector for PropertyAudit (Two-phase GEO)
 * Phase 1: Natural conversational response (no property context)
 * Phase 2: Analyzer extracts structured GEO fields from the natural response
 * 
 * Uses OpenAI's Responses API with web_search_preview to capture actual LLM sources
 */

import OpenAI from 'openai'
import {
  type NaturalConnector,
  type NaturalResponse,
  type NaturalAnalyzeContext,
  type NaturalAnalyzeResult,
  type WebSearchSource,
  NaturalExtractionEnvelopeSchema,
  getGeoConfig,
} from './types'

const NaturalExtractionEnvelopeJsonSchema = {
  type: 'object',
  required: ['answer_block', 'analysis'],
  additionalProperties: false,
  properties: {
    answer_block: {
      type: 'object',
      required: ['ordered_entities', 'citations', 'answer_summary', 'notes'],
      additionalProperties: false,
      properties: {
        ordered_entities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'domain', 'rationale', 'position'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              domain: { type: 'string' },
              rationale: { type: 'string' },
              position: { type: 'integer', minimum: 1 },
            },
          },
        },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['url', 'domain', 'entity_ref'],
            additionalProperties: false,
            properties: {
              url: { type: 'string' },
              domain: { type: 'string' },
              entity_ref: { type: 'string' },
            },
          },
        },
        answer_summary: { type: 'string' },
        notes: {
          type: 'object',
          required: ['flags'],
          additionalProperties: false,
          properties: {
            flags: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'no_sources',
                  'possible_hallucination',
                  'outdated_info',
                  'nap_mismatch',
                  'conflicting_prices',
                ],
              },
            },
          },
        },
      },
    },
    analysis: {
      type: 'object',
      required: ['ordered_entities', 'citations', 'brand_analysis', 'extraction_confidence'],
      additionalProperties: false,
      properties: {
        ordered_entities: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'name',
              'domain',
              'position',
              'prominence',
              'mention_count',
              'first_mention_quote',
            ],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              domain: { type: 'string' },
              position: { type: 'integer', minimum: 1 },
              prominence: { type: 'string' },
              mention_count: { type: 'integer', minimum: 0 },
              first_mention_quote: { type: 'string' },
            },
          },
        },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['url', 'domain', 'citation_type'],
            additionalProperties: false,
            properties: {
              url: { type: 'string' },
              domain: { type: 'string' },
              citation_type: { type: 'string', enum: ['explicit', 'inferred'] },
            },
          },
        },
        brand_analysis: {
          type: 'object',
          required: ['mentioned', 'position', 'location_stated', 'location_correct', 'prominence'],
          additionalProperties: false,
          properties: {
            mentioned: { type: 'boolean' },
            position: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
            location_stated: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            location_correct: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
            prominence: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        extraction_confidence: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
  },
} as const

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}$/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}

function buildAnalyzerPrompt(ctx: NaturalAnalyzeContext): string {
  const expected =
    ctx.expectedCity && ctx.expectedState ? `${ctx.expectedCity}, ${ctx.expectedState}` : 'Unknown'

  const lines: string[] = []
  lines.push(
    `You are a GEO audit analyzer extracting structured data from a natural LLM response.`,
    ``,
    `IMPORTANT: Be objective. Extract what was ACTUALLY said, not what should have been said.`,
    `Do not invent citations or URLs. Only extract or infer when clearly implied.`,
    ``,
    `Original Query: "${ctx.queryText}"`,
    `Brand Being Tracked: "${ctx.brandName}"`,
    `Expected Location: ${expected}`,
    `Known brand domains (for inference only): ${ctx.brandDomains.join(', ') || '—'}`,
    `Known competitor domains (for inference only): ${ctx.competitors.join(', ') || '—'}`,
    `Provider search sources (API metadata; may not appear as URLs in the prose):`,
    formatProviderSources(ctx.searchSources),
    ``,
    `LLM's Natural Response to Analyze:`,
    `"""`,
    ctx.naturalResponse,
    `"""`,
    ``,
    `Return ONLY JSON matching the required schema.`,
    ``,
    `Rules:`,
    `- ordered_entities in answer_block MUST be ordered by prominence (best-effort): frequency + early mention + emphasis.`,
    `- For answer_block.ordered_entities[].rationale: include a short reason + the first_mention_quote in-line.`,
    `- You may include provider search sources in citations even when the prose has no URLs.`,
    `- Do not invent extra URLs. no_sources is set later from the final citation list; do not flag it when provider sources were supplied.`,
    `- brand_analysis.location_correct should be false if a different city/state is stated than Expected Location (when Expected Location is known).`,
  )
  return lines.join('\n')
}

/**
 * Extract domain from URL
 */
function formatProviderSources(sources?: WebSearchSource[]): string {
  if (!sources || sources.length === 0) return 'None provided.'
  return sources
    .filter(source => source.url)
    .map((source, index) => `${index + 1}. ${source.title || source.domain || source.url} — ${source.url}`)
    .join('\n') || 'None provided.'
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Extract source URLs from OpenAI Responses API annotations
 */
function extractSourcesFromAnnotations(annotations: any[]): WebSearchSource[] {
  if (!annotations || !Array.isArray(annotations)) {
    return []
  }

  const sources: WebSearchSource[] = []
  const seenUrls = new Set<string>()

  for (const annotation of annotations) {
    if (annotation.type === 'url_citation' && annotation.url) {
      if (seenUrls.has(annotation.url)) continue
      seenUrls.add(annotation.url)

      sources.push({
        title: annotation.title || '',
        url: annotation.url,
        domain: extractDomain(annotation.url),
        snippet: '' // Annotations don't include snippets
      })
    }
  }

  return sources
}

export class OpenAINaturalConnector implements NaturalConnector {
  surface: 'openai' | 'chatgpt'

  constructor(surface: 'openai' | 'chatgpt' = 'openai') {
    this.surface = surface
  }

  private modelName() {
    const config = getGeoConfig()
    return this.surface === 'chatgpt' ? config.chatgptModel : config.openaiModel
  }

  async getNaturalResponse(query: string): Promise<NaturalResponse> {
    const config = getGeoConfig()
    const model = this.modelName()
    const client = new OpenAI({ 
      apiKey: config.openaiApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
      maxRetries: 2
    })

    const enableWebSearch = process.env.GEO_ENABLE_WEB_SEARCH === 'true'
    let searchSources: WebSearchSource[] = []

    // NOTE: We intentionally do NOT provide property/location context here.
    const systemPrompt = 'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.'

    if (enableWebSearch) {
      // Use OpenAI Responses API with web_search_preview tool
      // This captures the actual sources the LLM uses (like consumer ChatGPT)
      try {
        console.log('[openai-natural] Using Responses API with web search')
        
        const response = await client.responses.create({
          model,
          input: query,
          instructions: systemPrompt,
          tools: [{ type: 'web_search_preview' }],
        })

        // Extract text and annotations from the response
        let text = ''
        const allAnnotations: any[] = []

        for (const item of response.output || []) {
          if (item.type === 'message' && item.content) {
            for (const contentBlock of item.content) {
              if (contentBlock.type === 'output_text') {
                text += contentBlock.text || ''
                if (contentBlock.annotations) {
                  allAnnotations.push(...contentBlock.annotations)
                }
              }
            }
          }
        }

        // Extract sources from annotations
        searchSources = extractSourcesFromAnnotations(allAnnotations)
        console.log(`[openai-natural] Extracted ${searchSources.length} sources from LLM response`)

        return {
          text,
          model,
          tokensUsed: response.usage?.total_tokens ?? 0,
          usedWebSearch: true,
          searchSources,
          rawResponse: response,
        }
      } catch (error) {
        console.error('[openai-natural] Responses API error, falling back to Chat Completions:', error)
        // Fall through to Chat Completions API
      }
    }

    // Fallback: Use Chat Completions API (no web search sources)
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
    })

    const text = completion.choices?.[0]?.message?.content ?? ''

    return {
      text,
      model,
      tokensUsed: completion.usage?.total_tokens ?? 0,
      usedWebSearch: false,
      searchSources: [],
      rawResponse: completion,
    }
  }

  async analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult> {
    const config = getGeoConfig()
    const client = new OpenAI({ 
      apiKey: config.openaiApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
      maxRetries: 2
    })

    const prompt = buildAnalyzerPrompt(context)

    const completion = await client.chat.completions.create({
      model: this.modelName(),
      messages: [
        {
          role: 'system',
          content:
            'You are a precise GEO extraction system. Output strict JSON only. Do not include markdown or explanations.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'NaturalExtractionEnvelope',
          strict: true,
          schema: NaturalExtractionEnvelopeJsonSchema,
        },
      },
    })

    const raw = completion
    const content = completion.choices?.[0]?.message?.content ?? ''
    const jsonValue = tryParseJson(content)

    if (jsonValue === null) {
      console.error('[openai-natural] JSON parsing failed - not valid JSON. Raw:', content.slice(0, 800))
      throw new Error('Failed to parse natural extraction envelope: response was not valid JSON')
    }

    const parsed = NaturalExtractionEnvelopeSchema.safeParse(jsonValue)
    if (!parsed.success) {
      console.error('[openai-natural] Zod validation failed. Raw:', content.slice(0, 800))
      console.error('[openai-natural] Zod errors:', JSON.stringify(parsed.error.issues, null, 2))
      const firstError = parsed.error.issues?.[0]?.message || parsed.error.message || 'Schema validation failed'
      throw new Error(`Failed to parse natural extraction envelope JSON: ${firstError}`)
    }

    return { envelope: parsed.data, raw }
  }
}










