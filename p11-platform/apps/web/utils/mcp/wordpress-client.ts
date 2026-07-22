// WordPress MCP Client
// TypeScript wrapper for WordPress MCP server
// Provides typed access to WordPress discovery and deployment tools
// Created: December 16, 2025

export interface WordPressCapabilities {
  availableBlocks: string[]
  blockSchemas: Record<string, ACFBlockSchema>
  designTokens: ThemeDesignTokens
  theme: {
    name: string
    version: string
    supports: Record<string, boolean>
  }
  plugins: string[]
  capabilities: {
    canCreatePages: boolean
    canUploadMedia: boolean
    canModifyTheme: boolean
    canInstallPlugins: boolean
    maxUploadSizeMb: number
  }
}

export interface ACFBlockSchema {
  label: string
  description: string
  fields: Record<string, FieldSchema>
  variants?: Record<string, BlockVariant>
  cssClasses?: string[]
  exampleUsage?: Record<string, unknown>
}

interface FieldSchema {
  type: string
  required?: boolean
  default?: unknown
  choices?: string[]
  min?: number
  max?: number
  description?: string
}

interface BlockVariant {
  cssClass: string
  description: string
  bestFor: string[]
  exampleScreenshot?: string
}

export interface ThemeDesignTokens {
  colors: {
    primary: string
    secondary: string
    availableVariants: string[]
  }
  typography: {
    availableFonts: string[]
    headingScales: string[]
  }
  spacing: {
    availableScales: string[]
    presets: Record<string, unknown>
  }
}

/**
 * WordPress MCP Client
 * Wraps MCP server calls in typed interface
 */
export class WordPressMcpClient {
  private cacheKey = 'wordpress-capabilities-cache'
  private cacheDuration = 24 * 60 * 60 * 1000 // 24 hours
  
  /**
   * Get WordPress capabilities (with caching)
   */
  async getCapabilities(
    instanceId: string = 'template-collection-theme',
    forceRefresh: boolean = false
  ): Promise<WordPressCapabilities> {
    
    // Check cache first
    if (!forceRefresh) {
      const cached = this.getFromCache(instanceId)
      if (cached) return cached
    }
    
    const capabilities = await this.callMcp('get_wordpress_capabilities', {
      instance_id: instanceId,
    }) as WordPressCapabilities
    
    // Cache result
    this.saveToCache(instanceId, capabilities)
    
    return capabilities
  }
  
  /**
   * Analyze an existing WordPress site for structure and design patterns.
   * Not currently backed by an implementation; callers treat failure as
   * "no reference analysis available" and proceed.
   */
  async analyzeExistingSite(url: string): Promise<SiteAnalysis> {
    throw new Error(
      `Reference site analysis is not available (requested for ${url})`
    )
  }
  
  /**
   * Call discovery (direct HTTP server-side, API bridge from the browser)
   */
  private async callMcp(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (typeof window === 'undefined') {
      if (tool !== 'get_wordpress_capabilities') {
        throw new Error(`Unsupported WordPress discovery tool: ${tool}`)
      }
      const { discoverWordPressCapabilities } = await import(
        '@/utils/siteforge/wordpress-discovery'
      )
      return discoverWordPressCapabilities()
    }
    
    try {
      const response = await fetch('/api/mcp/wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, arguments: args })
      })
      
      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`WordPress discovery call failed: ${response.status} ${response.statusText} ${errorBody}`.trim())
      }
      
      const data = await response.json()
      return data.result
    } catch (error) {
      throw new Error(
        `WordPress discovery fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
  
  /**
   * Cache management (localStorage in browser, Redis in production)
   */
  private getFromCache(instanceId: string): WordPressCapabilities | null {
    if (typeof window === 'undefined') return null
    
    const key = `${this.cacheKey}-${instanceId}`
    const cached = localStorage.getItem(key)
    
    if (!cached) return null
    
    try {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp > this.cacheDuration) {
        localStorage.removeItem(key)
        return null
      }
      return data
    } catch {
      return null
    }
  }
  
  private saveToCache(instanceId: string, data: WordPressCapabilities): void {
    if (typeof window === 'undefined') return
    
    const key = `${this.cacheKey}-${instanceId}`
    localStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now()
    }))
  }
}

// Type exports
export interface SiteAnalysis {
  url: string
  detectedTheme: string
  blocksUsed: Array<{ block: string; variant?: string; order: number }>
  designAnalysis: {
    colorPalette: Record<string, string>
    typography: Record<string, string>
    spacing: Record<string, string>
    photoStrategy: Record<string, unknown>
  }
  architecturalPatterns: Record<string, unknown>
  insightsForAgents: Record<string, string>
}











