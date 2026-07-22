// SiteForge Base Agent
// Foundation for all agentic capabilities
// Provides vector search, LLM access, property context
// Created: December 16, 2025

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/utils/supabase/admin'
import { SITEFORGE_CLAUDE_MODEL, SITEFORGE_EMBEDDING_MODEL } from '@/utils/siteforge/models'
import type { Json } from '@/types/supabase'

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
   * Call Claude Sonnet 4 (latest model)
   * For JSON mode: Uses low temperature (0.3) and prefill for reliable output
   */
  protected async callClaude(
    prompt: string,
    options: {
      systemPrompt?: string
      temperature?: number
      maxTokens?: number
      jsonMode?: boolean
    } = {}
  ): Promise<string> {
    
    // For JSON mode, use low temperature for reliable structure
    // Creativity is driven by prompts, not temperature randomness
    const effectiveTemp = options.jsonMode ? 0.3 : (options.temperature ?? 0.7)
    
    // Build messages array - add prefill for JSON mode to enforce structure
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt }
    ]
    
    // Prefill with '{' to force JSON start and bypass any preamble
    if (options.jsonMode) {
      messages.push({ role: 'assistant', content: '{' })
    }
    
    const message = await this.anthropic.messages.create({
      model: SITEFORGE_CLAUDE_MODEL,
      max_tokens: options.maxTokens || 30000,
      temperature: effectiveTemp,
      system: options.systemPrompt || '',
      messages
    })
    
    const textContent = message.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude response has no text content')
    }
    
    let responseText = textContent.text
    
    // For JSON mode with prefill, prepend the '{' since Claude continues from there
    if (options.jsonMode) {
      responseText = '{' + responseText
    }
    
    // Extract JSON from XML wrapper if present (e.g., <json>...</json>)
    if (options.jsonMode) {
      const xmlMatch = responseText.match(/<json>([\s\S]*?)<\/json>/)
      if (xmlMatch) {
        responseText = xmlMatch[1].trim()
      }
    }
    
    // Extract JSON if in code blocks
    if (options.jsonMode) {
      if (responseText.includes('```json')) {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/)
        if (jsonMatch) {
          responseText = jsonMatch[1]
        }
      } else if (responseText.includes('```')) {
        const jsonMatch = responseText.match(/```\n([\s\S]*?)\n```/)
        if (jsonMatch) {
          responseText = jsonMatch[1]
        }
      }
      
      // Clean up common JSON issues from Claude
      // Remove trailing commas before closing brackets/braces (multiple passes)
      for (let i = 0; i < 5; i++) {
        responseText = responseText.replace(/,(\s*[}\]])/g, '$1')
      }
      // Remove comments (Claude sometimes adds them)
      responseText = responseText.replace(/\/\/.*$/gm, '')
      responseText = responseText.replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove any remaining problematic trailing commas in arrays
      responseText = responseText.replace(/,(\s*\])/g, '$1')
      responseText = responseText.replace(/,(\s*\})/g, '$1')
    }
    
    return responseText
  }
  
  /**
   * Robust JSON parser with multiple fallback strategies
   * Returns parsed object or throws with helpful error
   */
  protected parseJSON<T>(response: string, agentName: string): T {
    // Pre-clean common Claude issues BEFORE any parsing
    let cleaned = response
    
    // Remove unquoted annotations after strings like: "value" (annotation)
    // This is a common Claude habit - it adds comments in parentheses
    cleaned = cleaned.replace(/"([^"]*?)"\s*\(([^)]+)\)/g, '"$1 ($2)"')
    
    // Remove trailing commas everywhere (multiple passes for nested)
    for (let i = 0; i < 3; i++) {
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1')
    }
    
    // Strategy 1: Direct parse (fastest path)
    try {
      return JSON.parse(cleaned) as T
    } catch (e) {
      console.warn(`[${agentName}] Direct parse failed:`, (e as Error).message)
    }
    
    // Strategy 2: Extract JSON from response and clean more aggressively
    try {
      // Find JSON object/array in response
      const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
      if (jsonMatch) {
        let extracted = jsonMatch[1]
        
        // Aggressive cleanup
        // Remove trailing commas (multiple patterns)
        extracted = extracted.replace(/,(\s*[}\]])/g, '$1')
        extracted = extracted.replace(/,\s*,/g, ',')  // Double commas
        extracted = extracted.replace(/\[\s*,/g, '[')  // Leading comma in array
        extracted = extracted.replace(/{\s*,/g, '{')   // Leading comma in object
        
        // Remove unquoted annotations again (in case they're nested)
        extracted = extracted.replace(/"([^"]*?)"\s*\(([^)]+)\)/g, '"$1 ($2)"')
        
        // Remove JavaScript comments
        extracted = extracted.replace(/\/\/[^\n]*\n/g, '\n')
        extracted = extracted.replace(/\/\*[\s\S]*?\*\//g, '')
        
        // Fix unquoted keys (common Claude issue)
        extracted = extracted.replace(/(\s*)(\w+)(\s*):/g, '$1"$2"$3:')
        // But don't double-quote already quoted keys
        extracted = extracted.replace(/""/g, '"')
        
        const result = JSON.parse(extracted) as T
        console.log(`✅ [${agentName}] Recovered JSON with cleanup (strategy 2)`)
        return result
      }
    } catch (e) {
      console.warn(`[${agentName}] Strategy 2 failed:`, (e as Error).message)
    }
    
    // Strategy 3: Line-by-line cleanup for stubborn cases
    try {
      let lines = response.split('\n')
      
      // Find start and end of JSON
      const startIdx = lines.findIndex(l => l.trim().startsWith('{') || l.trim().startsWith('['))
      let endIdx = lines.length - 1
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().endsWith('}') || lines[i].trim().endsWith(']')) {
          endIdx = i
          break
        }
      }
      
      if (startIdx >= 0) {
        lines = lines.slice(startIdx, endIdx + 1)
        let cleaned = lines
          .map(l => l.replace(/\/\/.*$/, ''))  // Remove line comments
          .join('\n')
        
        // Final cleanup pass
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1')
        cleaned = cleaned.replace(/,\s*\n\s*}/g, '\n}')
        cleaned = cleaned.replace(/,\s*\n\s*\]/g, '\n]')
        
        const result = JSON.parse(cleaned) as T
        console.log(`✅ [${agentName}] Recovered JSON with line-by-line cleanup (strategy 3)`)
        return result
      }
    } catch (e) {
      console.warn(`[${agentName}] Strategy 3 failed:`, (e as Error).message)
    }
    
    // All strategies failed - log useful debug info
    console.error(`❌ [${agentName}] All JSON parse strategies failed`)
    console.error(`Response length: ${response.length}`)
    console.error(`First 500 chars:`, response.substring(0, 500))
    console.error(`Last 500 chars:`, response.substring(response.length - 500))
    
    throw new Error(`${agentName} returned invalid JSON - see logs for details`)
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
          
          if (data.generation_status !== 'complete') {
            console.warn('⚠️ [getBrandForgeData] Brand book not complete:', {
              propertyId: this.propertyId,
              status: data.generation_status,
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
          
          console.log('✅ [getBrandForgeData] Found complete brand book for property:', this.propertyId)
          return data as BrandForgeData
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











