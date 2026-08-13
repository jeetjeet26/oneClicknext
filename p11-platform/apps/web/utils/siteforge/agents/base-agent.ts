// SiteForge Base Agent
// Foundation for all agentic capabilities
// Provides vector search, LLM access, property context
// Created: December 16, 2025

import Anthropic from '@anthropic-ai/sdk'
import {
  generateText,
  Output,
  type FlexibleSchema,
} from 'ai'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  SITEFORGE_CLAUDE_MODEL,
  SITEFORGE_EDITOR_MODEL,
  SITEFORGE_EMBEDDING_MODEL,
} from '@/utils/siteforge/models'
import type { Json } from '@/types/supabase'
import {
  brandContractToStorageSections,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'

export interface VectorSearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  similarity: number
}

export interface PropertyKnowledge {
  propertyId: string
  embeddings: VectorSearchResult[]
  insights: Map<string, VectorSearchResult[]>
}

function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Base Agent - All SiteForge agents inherit from this
 * Provides: Vector search, LLM access, property context
 */
export abstract class BaseAgent {
  protected supabase = createServiceClient()
  
  protected anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!
  })
  
  constructor(protected propertyId: string) {}
  
  /**
   * Helper function for retry with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts: number
      baseDelayMs: number
      operationName: string
    }
  ): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        console.warn(
          `⚠️ [${options.operationName}] Attempt ${attempt}/${options.maxAttempts} failed:`,
          lastError.message
        )
        
        if (attempt < options.maxAttempts) {
          const delay = options.baseDelayMs * Math.pow(2, attempt - 1)
          console.log(`🔄 [${options.operationName}] Retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    console.error(`❌ [${options.operationName}] All ${options.maxAttempts} attempts failed`)
    throw lastError
  }
  
  /**
   * Semantic search across property knowledge base
   * Uses same embeddings as LumaLeasing chatbot
   * Includes retry logic (2 attempts)
   */
  protected async vectorSearch(
    query: string,
    matchCount: number = 5,
    matchThreshold: number = 0.7
  ): Promise<VectorSearchResult[]> {
    
    try {
      return await this.withRetry(
        async () => {
          // Generate embedding for query
          const embedding = await this.embed(query)
          const queryEmbedding = formatEmbeddingForPgVector(embedding)
          
          // Search property KB using existing match_documents function
          const { data, error } = await this.supabase.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
            filter_property: this.propertyId
          })
          
          if (error) {
            throw new Error(`Supabase RPC error: ${error.message}`)
          }
          
          return (data || []).map((result) => ({
            id: result.id,
            content: result.content,
            metadata: isMetadataRecord(result.metadata) ? result.metadata : {},
            similarity: result.similarity
          }))
        },
        {
          maxAttempts: 2,
          baseDelayMs: 500,
          operationName: 'vectorSearch'
        }
      )
    } catch (error) {
      console.error('❌ Vector search failed after retries:', error)
      console.error(`   Query: "${query.substring(0, 100)}..."`)
      console.error(`   Property ID: ${this.propertyId}`)
      return []
    }
  }
  
  /**
   * Generate embedding using Anthropic's embed API
   * (Or fallback to OpenAI if needed)
   */
  protected async embed(text: string): Promise<number[]> {
    // Anthropic doesn't have embeddings API yet, use OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: SITEFORGE_EMBEDDING_MODEL,
        input: text
      })
    })
    
    const data = await openaiResponse.json()
    return data.data[0].embedding
  }
  
  /**
   * Generate schema-validated output through the AI SDK structured-output
   * contract. New SiteForge generation code must use this path.
   */
  protected async callClaudeStructured<T>(
    prompt: string,
    schema: FlexibleSchema<T>,
    options: {
      systemPrompt?: string
      maxTokens?: number
      name?: string
      description?: string
    } = {}
  ): Promise<T> {
    const result = await generateText({
      model: SITEFORGE_EDITOR_MODEL,
      instructions: options.systemPrompt || undefined,
      prompt,
      maxOutputTokens: options.maxTokens || 30_000,
      output: Output.object({
        schema,
        name: options.name,
        description: options.description,
      }),
    })

    return result.output
  }

  /**
   * Legacy text generation compatibility for agents not yet migrated to
   * callClaudeStructured. jsonMode does not provide a structured contract.
   */
  protected async callClaude(
    prompt: string,
    options: {
      systemPrompt?: string
      maxTokens?: number
      jsonMode?: boolean
    } = {}
  ): Promise<string> {

    // Newer Claude models require the conversation to end with a user message.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt }
    ]

    const message = await this.anthropic.messages.create({
      model: SITEFORGE_CLAUDE_MODEL,
      max_tokens: options.maxTokens || 30000,
      system: options.systemPrompt || '',
      messages
    })
    
    const textContent = message.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude response has no text content')
    }
    
    return textContent.text
  }
  
  /**
   * Legacy JSON compatibility parser. It intentionally accepts only a direct
   * JSON value or one exact historical wrapper; it is not the primary
   * generation contract and does not infer keys or extract arbitrary objects.
   */
  protected parseJSON<T>(response: string, agentName: string): T {
    try {
      return JSON.parse(response) as T
    } catch {
      const compatible = unwrapLegacyJson(response)
      try {
        return JSON.parse(compatible) as T
      } catch (error) {
        console.error(`[${agentName}] Legacy JSON compatibility parse failed`, {
          message: error instanceof Error ? error.message : 'invalid JSON',
          responseLength: response.length,
        })
        throw new Error(`${agentName} returned invalid legacy JSON`)
      }
    }
  }
  
  /**
   * Get property basic info
   */
  protected async getPropertyInfo(): Promise<PropertyInfo> {
    const { data: property, error } = await this.supabase
      .from('properties')
      .select(`
        id,
        name,
        address,
        property_type,
        unit_count,
        year_built,
        amenities,
        special_features
      `)
      .eq('id', this.propertyId)
      .single()
    
    if (error) throw error
    
    // Get floorplans separately if table exists
    const { data: floorplans } = await this.supabase
      .from('floorplans')
      .select('*')
      .eq('property_id', this.propertyId)
      .limit(10)
    
    return {
      ...property,
      floorplans: floorplans || []
    } as unknown as PropertyInfo
  }
  
  /**
   * Get BrandForge data if exists
   * Includes retry logic (3 attempts) and detailed error logging
   */
  protected async getBrandForgeData(): Promise<BrandForgeData | null> {
    try {
      return await this.withRetry(
        async () => {
          const { data, error } = await this.supabase
            .from('property_brand_assets')
            .select('*')
            .eq('property_id', this.propertyId)
            .maybeSingle()
          
          if (error) {
            // Log specific error details
            console.error('❌ [getBrandForgeData] Database query error:', {
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint,
              propertyId: this.propertyId
            })
            throw new Error(`Database query failed: ${error.message}`)
          }
          
          if (!data) {
            console.log('ℹ️ [getBrandForgeData] No brand assets found for property:', this.propertyId)
            return null
          }
          
          if (data.approval_status !== 'approved' && data.generation_status !== 'complete') {
            console.warn('⚠️ [getBrandForgeData] Brand contract not approved:', {
              propertyId: this.propertyId,
              status: data.approval_status,
              hasData: {
                introduction: !!data.section_1_introduction,
                positioning: !!data.section_2_positioning,
                colors: !!data.section_8_colors,
                typography: !!data.section_7_typography,
                logo: !!data.section_6_logo
              }
            })
            return null
          }
          
          const contract = normalizeBrandAssetRow(data as unknown as Record<string, unknown>)
          console.log('✅ [getBrandForgeData] Found approved brand contract for property:', this.propertyId)
          return {
            ...data,
            ...brandContractToStorageSections(contract),
            contract,
          } as BrandForgeData
        },
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          operationName: 'getBrandForgeData'
        }
      )
    } catch (error) {
      console.error('❌ [getBrandForgeData] Failed after all retries:', error)
      console.error(`   Property ID: ${this.propertyId}`)
      return null
    }
  }
  
  /**
   * Log agent action for debugging
   */
  protected async logAction(
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('mcp_audit_log').insert({
      platform: 'siteforge-agent',
      tool_name: action,
      operation_type: 'agent_action',
      property_id: this.propertyId,
      parameters: details as Json,
      success: true,
      created_at: new Date().toISOString()
    })
  }
}

function escapeControlCharactersInJsonStrings(input: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (const character of input) {
    if (!inString) {
      output += character
      if (character === '"') {
        inString = true
      }
      continue
    }

    if (escaped) {
      output += character
      escaped = false
      continue
    }

    if (character === '\\') {
      output += character
      escaped = true
      continue
    }

    if (character === '"') {
      output += character
      inString = false
      continue
    }

    switch (character) {
      case '\b':
        output += '\\b'
        break
      case '\f':
        output += '\\f'
        break
      case '\n':
        output += '\\n'
        break
      case '\r':
        output += '\\r'
        break
      case '\t':
        output += '\\t'
        break
      default:
        output += character.charCodeAt(0) < 0x20
          ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
          : character
    }
  }

  return output
}

function unwrapLegacyJson(response: string): string {
  const trimmed = response.trim()
  let value = trimmed

  if (value.startsWith('<json>') && value.endsWith('</json>')) {
    value = value.slice('<json>'.length, -'</json>'.length).trim()
  } else if (value.startsWith('```json') && value.endsWith('```')) {
    value = value.slice('```json'.length, -'```'.length).trim()
  } else if (value.startsWith('```') && value.endsWith('```')) {
    value = value.slice('```'.length, -'```'.length).trim()
  }

  return escapeControlCharactersInJsonStrings(value).replace(
    /,(\s*[}\]])/g,
    '$1'
  )
}

// Type definitions
interface PropertyInfo {
  id: string
  name: string
  address: string
  city: string
  state: string
  property_type: string
  amenities: string[]
  floorplans: unknown[]
}

interface BrandForgeData {
  property_id: string
  generation_status: string
  approval_status?: string
  contract?: import('@/utils/brandforge/contracts').BrandForgeContractV1
  section_1_introduction?: unknown
  section_2_positioning?: unknown
  section_3_target_audience?: unknown
  section_4_personas?: unknown
  section_5_name_story?: unknown
  section_6_logo?: unknown
  section_7_typography?: unknown
  section_8_colors?: unknown
  section_9_brand_voice?: unknown
  section_10_photo_style?: unknown
  conversation_summary?: unknown
}











