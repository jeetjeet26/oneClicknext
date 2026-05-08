/**
 * OpenAI Connector for PropertyAudit
 * Uses OpenAI Responses API with structured outputs for GEO audits
 */

import OpenAI from 'openai'
import { 
  AnswerBlockSchema, 
  type AnswerBlock, 
  type Connector, 
  type ConnectorContext, 
  type ConnectorResult,
  getGeoConfig 
} from './types'

// JSON Schema for OpenAI structured outputs
const AnswerBlockJsonSchema = {
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
          position: { type: 'integer', minimum: 1 }
        }
      }
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'domain'],
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          domain: { type: 'string' }
        }
      }
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
              'conflicting_prices'
            ]
          }
        }
      }
    }
  }
} as const

function buildPrompt(context: ConnectorContext): string {
  const domains = context.brandDomains.join(', ')
  const competitors = context.competitors.join(', ')
  const location = context.propertyLocation
  
  const lines = [
    `Task: Perform a GEO audit for this specific real estate property and return ONLY the JSON object matching the schema.`,
  ]

  // Add property location context if available (prevents hallucinations)
  if (location && location.city && location.state) {
    lines.push(``)
    lines.push(`Property Details:`)
    lines.push(`- Name: ${context.brandName}`)
    lines.push(`- Location: ${location.city}, ${location.state}`)
    if (location.fullAddress) {
      lines.push(`- Address: ${location.fullAddress}`)
    }
    if (location.websiteUrl) {
      lines.push(`- Official Website: ${location.websiteUrl}`)
    }
    lines.push(``)
    lines.push(`CRITICAL: This property is located in ${location.city}, ${location.state}.`)
    lines.push(`Do NOT confuse with properties in other cities or states.`)
    lines.push(`Verify all information relates to the ${location.city}, ${location.state} location.`)
  }
  
  lines.push(``)
  lines.push(`Query: ${context.queryText}`)
  lines.push(`Brand: ${context.brandName}`)
  lines.push(`Brand domains: ${domains || '—'}`)
  lines.push(`Competitors: ${competitors || '—'}`)
  lines.push(`Requirements:`)
  lines.push(`- Produce an ordered list of providers/brands relevant to the query (name, domain, rationale, position starting at 1).`)
  lines.push(`- Include citations with absolute URLs and their domains.`)
  lines.push(`- Summarize the answer in 1-2 sentences.`)
  lines.push(`- If no grounded sources are available, set notes.flags to include "no_sources".`)
  lines.push(`Output: Return ONLY the JSON object, no markdown, no explanations.`)
  
  return lines.join('\n')
}

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

function coerceToAnswerBlock(candidate: unknown): AnswerBlock | null {
  const direct = AnswerBlockSchema.safeParse(candidate)
  if (direct.success) {
    return direct.data
  }

  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const obj = candidate as Record<string, unknown>

  // Try to extract ordered_entities from various formats
  const entitiesSource = Array.isArray(obj.ordered_entities)
    ? obj.ordered_entities
    : Array.isArray(obj.results)
    ? obj.results
    : Array.isArray(obj.providers)
    ? obj.providers
    : null

  if (!entitiesSource) {
    return null
  }

  const orderedEntities = entitiesSource
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') return null
      const i = item as Record<string, unknown>
      
      const name = typeof i.name === 'string' ? i.name : null
      const domain = typeof i.domain === 'string' ? i.domain : null
      
      if (!name || !domain) return null
      
      return {
        name,
        domain,
        rationale: typeof i.rationale === 'string' ? i.rationale : 'No rationale provided.',
        position: typeof i.position === 'number' ? i.position : index + 1
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  if (orderedEntities.length === 0) {
    return null
  }

  // Extract citations
  const citationsSource = Array.isArray(obj.citations) ? obj.citations : []
  const citations = citationsSource
    .map((c: unknown) => {
      if (!c || typeof c !== 'object') return null
      const cit = c as Record<string, unknown>
      const url = typeof cit.url === 'string' ? cit.url : null
      const domain = typeof cit.domain === 'string' ? cit.domain : null
      if (!url || !domain) return null
      return {
        url,
        domain,
        entity_ref: typeof cit.entity_ref === 'string' ? cit.entity_ref : undefined
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  // Extract summary
  const summary = typeof obj.answer_summary === 'string' 
    ? obj.answer_summary 
    : typeof obj.summary === 'string'
    ? obj.summary
    : 'No summary provided.'

  // Extract flags
  const notesObj = obj.notes as Record<string, unknown> | undefined
  const flagsRaw = Array.isArray(notesObj?.flags) ? notesObj.flags : []
  const allowedFlags = new Set([
    'no_sources',
    'possible_hallucination',
    'outdated_info',
    'nap_mismatch',
    'conflicting_prices'
  ])
  const flags = flagsRaw.filter((f): f is string => 
    typeof f === 'string' && allowedFlags.has(f)
  ) as AnswerBlock['notes']['flags']

  const normalized = {
    ordered_entities: orderedEntities,
    citations,
    answer_summary: summary,
    notes: { flags }
  }

  const validated = AnswerBlockSchema.safeParse(normalized)
  return validated.success ? validated.data : null
}

export class OpenAIConnector implements Connector {
  surface = 'openai' as const

  async invoke(context: ConnectorContext): Promise<ConnectorResult> {
    const config = getGeoConfig()
    const client = new OpenAI({ 
      apiKey: config.openaiApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
      maxRetries: 2
    })
    const prompt = buildPrompt(context)

    console.log('[openai] Query:', context.queryText)
    console.log('[openai] Brand:', context.brandName)
    console.log('[openai] Model:', config.openaiModel)

    let raw: unknown = null
    let parsed: AnswerBlock | null = null

    // Check if model requires default sampling (GPT-5, GPT-4.1+)
    const requiresDefaultSampling = /^gpt-5/i.test(config.openaiModel) || /^gpt-4\.[1-9]/i.test(config.openaiModel)
    
    // Check if web search is enabled
    const enableWebSearch = process.env.GEO_ENABLE_WEB_SEARCH === 'true'

    try {
      const requestOptions: Parameters<typeof client.chat.completions.create>[0] = {
        model: config.openaiModel,
        messages: [
          { role: 'system', content: 'You are a precise GEO audit assistant. Use web search when needed to find current, accurate information. Output strict JSON only.' },
          { role: 'user', content: prompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'AnswerBlock',
            strict: true,
            schema: AnswerBlockJsonSchema
          }
        }
      }

      // Add web search tool if enabled (GPT-5.2+ supports it)
      if (enableWebSearch && /^gpt-5/i.test(config.openaiModel)) {
        console.log('[openai] Web search enabled')
        // Note: OpenAI's web search is automatic when model supports it
        // No explicit tool configuration needed - model will search if appropriate
      }

      // Only set custom sampling for older models
      if (!requiresDefaultSampling) {
        requestOptions.temperature = config.temperature
        requestOptions.top_p = config.topP
        console.log('[openai] Using custom sampling - temp:', config.temperature, 'top_p:', config.topP)
      } else {
        console.log('[openai] Using default sampling (model requirement)')
      }

      const completion = await client.chat.completions.create(requestOptions)

      raw = completion
      const content = 'choices' in completion ? completion.choices?.[0]?.message?.content ?? '' : ''
      const jsonValue = tryParseJson(content)

      if (jsonValue) {
        parsed = coerceToAnswerBlock(jsonValue)
        if (parsed) {
          console.log('[openai] ✓ Parsed', parsed.ordered_entities.length, 'entities,', parsed.citations.length, 'citations')
        }
      }
    } catch (error) {
      console.error('[openai] API error:', error)
      raw = { error: error instanceof Error ? error.message : String(error) }
    }

    if (!parsed) {
      console.warn('[openai] Returning fallback answer')
      return {
        answer: {
          ordered_entities: [],
          citations: [],
          answer_summary: 'No structured sources returned',
          notes: { flags: ['no_sources'] }
        },
        raw
      }
    }

    return { answer: parsed, raw }
  }
}

