/**
 * Claude Connector for PropertyAudit
 * Uses Anthropic API for GEO audits
 */

import Anthropic from '@anthropic-ai/sdk'
import { 
  AnswerBlockSchema, 
  type AnswerBlock, 
  type Connector, 
  type ConnectorContext, 
  type ConnectorResult,
  getGeoConfig 
} from './types'
import { performWebSearch, formatSearchResultsForLLM } from './web-search'

function buildPrompt(context: ConnectorContext): string {
  const domains = context.brandDomains.join(', ')
  const competitors = context.competitors.join(', ')
  const location = context.propertyLocation
  
  const lines = [
    `Task: Perform a GEO audit for this specific real estate property and return ONLY valid JSON matching the exact schema.`,
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
    lines.push(`Do NOT confuse with other AMLI properties in different cities (e.g., Denver, Austin, Chicago).`)
    lines.push(`All information must be specific to the ${location.city}, ${location.state} location.`)
    lines.push(`If you cite URLs, ensure they reference the ${location.city} property, not other locations.`)
  }

  lines.push(``)
  lines.push(`Query: ${context.queryText}`)
  lines.push(`Brand: ${context.brandName}`)
  lines.push(`Brand domains: ${domains || '—'}`)
  lines.push(`Competitors: ${competitors || '—'}`)
  lines.push(``)
  lines.push(`Requirements:`)
  lines.push(`- Produce an ordered list of providers/brands relevant to the query (name, domain, rationale, position starting at 1).`)
  lines.push(`- Include citations with absolute URLs and their domains.`)
  lines.push(`- Summarize the answer in 1-2 sentences.`)
  lines.push(`- If no grounded sources are available, set notes.flags to include "no_sources".`)
  lines.push(``)
  lines.push(`Output format - Return ONLY raw JSON (no markdown code blocks, no explanations, no text before or after):`)
  lines.push(`{`)
  lines.push(`  "ordered_entities": [`)
  lines.push(`    {"name": "...", "domain": "...", "rationale": "...", "position": 1}`)
  lines.push(`  ],`)
  lines.push(`  "citations": [`)
  lines.push(`    {"url": "...", "domain": "...", "entity_ref": "1"}`)
  lines.push(`  ],`)
  lines.push(`  "answer_summary": "...",`)
  lines.push(`  "notes": {"flags": []}`)
  lines.push(`}`)
  
  return lines.join('\n')
}

function tryParseJson(content: string): unknown {
  // First, try direct JSON parse
  try {
    return JSON.parse(content)
  } catch {
    // Continue to fallbacks
  }

  // Strip markdown code blocks
  let cleaned = content.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '')
  cleaned = cleaned.replace(/\n?```\s*$/i, '')
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // Continue to fallbacks
  }

  // Extract JSON object from text
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(jsonCandidate)
    } catch {
      // Continue to fallbacks
    }
  }

  // Fallback: regex match from end
  const match = content.match(/\{[\s\S]*\}$/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      // All parsing attempts failed
    }
  }

  return null
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

  const orderedEntities: AnswerBlock['ordered_entities'] = []
  
  if (entitiesSource) {
    for (let i = 0; i < entitiesSource.length; i++) {
      const item = entitiesSource[i]
      if (!item || typeof item !== 'object') continue
      
      const ent = item as Record<string, unknown>
      const name = typeof ent.name === 'string' ? ent.name : null
      const domain = typeof ent.domain === 'string' ? ent.domain : null
      
      if (!name || !domain) continue
      
      orderedEntities.push({
        name,
        domain,
        rationale: typeof ent.rationale === 'string' ? ent.rationale : 'No rationale provided.',
        position: typeof ent.position === 'number' ? ent.position : i + 1
      })
    }
  }

  // Extract citations
  const citations: AnswerBlock['citations'] = []
  
  if (Array.isArray(obj.citations)) {
    for (const c of obj.citations) {
      if (!c || typeof c !== 'object') continue
      const cit = c as Record<string, unknown>
      const url = typeof cit.url === 'string' ? cit.url : null
      const domain = typeof cit.domain === 'string' ? cit.domain : null
      if (!url || !domain) continue
      const citation: any = {
        url,
        domain
      }
      if (typeof cit.entity_ref === 'string') {
        citation.entity_ref = cit.entity_ref
      }
      citations.push(citation)
    }
  }

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

export class ClaudeConnector implements Connector {
  surface = 'claude' as const

  async invoke(context: ConnectorContext): Promise<ConnectorResult> {
    const config = getGeoConfig()
    const client = new Anthropic({ 
      apiKey: config.anthropicApiKey,
      timeout: 600000, // 10 minutes timeout for slow API responses
    })
    const prompt = buildPrompt(context)
    const enableWebSearch = process.env.GEO_ENABLE_WEB_SEARCH === 'true'

    console.log('[claude] Query:', context.queryText)
    console.log('[claude] Brand:', context.brandName)
    if (enableWebSearch) {
      console.log('[claude] Web search: enabled')
    }

    let raw: unknown = null
    let parsed: AnswerBlock | null = null
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: prompt
      }
    ]

    try {
      // First call - with web search tool if enabled
      const firstResponse = await client.messages.create({
        model: config.claudeModel,
        max_tokens: 2000,
        temperature: config.temperature,
        system: enableWebSearch
          ? 'You are a precise GEO audit assistant. Use web search to find current, accurate information about real estate properties. After searching, output strict JSON only.'
          : 'You are a precise GEO audit assistant. You must output ONLY valid JSON without any markdown formatting, code blocks, or explanatory text. Return raw JSON that can be directly parsed.',
        messages,
        ...(enableWebSearch ? {
          tools: [
            {
              name: 'web_search',
              description: 'Search the web for current information about real estate properties, reviews, listings, and competitive analysis',
              input_schema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query to execute'
                  }
                },
                required: ['query']
              }
            }
          ]
        } : {})
      })

      raw = firstResponse

      // Check if Claude wants to use web search
      const toolUseBlock = firstResponse.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      )

      if (toolUseBlock && toolUseBlock.name === 'web_search') {
        console.log('[claude] Tool use requested:', toolUseBlock.input)
        
        // Execute web search
        const searchQuery = (toolUseBlock.input as any).query || context.queryText
        const searchResults = await performWebSearch(searchQuery)
        const formattedResults = formatSearchResultsForLLM(searchResults)

        console.log('[claude] Search completed, ${searchResults.results.length} results')

        // Send search results back to Claude
        messages.push({
          role: 'assistant',
          content: firstResponse.content
        })
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: formattedResults
            },
            {
              type: 'text',
              text: 'Based on these search results, provide your answer in the required JSON format with ordered_entities and citations.'
            }
          ]
        })

        // Second call - get structured response
        const secondResponse = await client.messages.create({
          model: config.claudeModel,
          max_tokens: 1200,
          temperature: config.temperature,
          system: 'You are a precise GEO audit assistant. Output ONLY valid JSON without any markdown formatting. Return raw JSON that can be directly parsed.',
          messages
        })

        const textBlocks = (secondResponse.content ?? []).filter(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        )
        const contentText = textBlocks.map(b => b.text).join('\n')

        const jsonValue = tryParseJson(contentText)
        if (jsonValue) {
          parsed = coerceToAnswerBlock(jsonValue)
          if (parsed) {
            console.log('[claude] ✓ Parsed', parsed.ordered_entities.length, 'entities,', parsed.citations.length, 'citations (with search)')
          }
        }
      } else {
        // No tool use - direct response
        const textBlocks = (firstResponse.content ?? []).filter(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        )
        const contentText = textBlocks.map(b => b.text).join('\n')

        const jsonValue = tryParseJson(contentText)
        if (jsonValue) {
          parsed = coerceToAnswerBlock(jsonValue)
          if (parsed) {
            console.log('[claude] ✓ Parsed', parsed.ordered_entities.length, 'entities,', parsed.citations.length, 'citations')
          }
        }
      }
    } catch (error) {
      console.error('[claude] API error:', error)
      raw = { error: error instanceof Error ? error.message : String(error) }
    }

    if (!parsed) {
      console.warn('[claude] Returning fallback answer')
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

