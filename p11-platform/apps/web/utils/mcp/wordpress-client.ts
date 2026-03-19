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
    
    // Call MCP server for fresh data
    const [abilities, schemas, tokens] = await Promise.all([
      this.callMcp('get_wordpress_abilities', { instance_id: instanceId }),
      this.callMcp('get_acf_block_schemas', { instance_id: instanceId }),
      this.callMcp('get_theme_design_tokens', { instance_id: instanceId })
    ])
    
    const capabilities: WordPressCapabilities = {
      availableBlocks: abilities.available_blocks,
      blockSchemas: schemas,
      designTokens: tokens,
      theme: abilities.theme,
      plugins: abilities.plugins,
      capabilities: abilities.capabilities
    }
    
    // Cache result
    this.saveToCache(instanceId, capabilities)
    
    return capabilities
  }
  
  /**
   * Analyze an existing WordPress site for structure and design patterns
   */
  async analyzeExistingSite(url: string): Promise<SiteAnalysis> {
    return this.callMcp('analyze_existing_site', { url })
  }
  
  /**
   * Discover variants for specific block
   */
  async discoverBlockVariants(
    instanceId: string,
    blockName: string
  ): Promise<Record<string, BlockVariant>> {
    return this.callMcp('discover_block_variants', { instance_id: instanceId, block_name: blockName })
  }
  
  /**
   * Deploy blueprint to WordPress
   */
  async deployBlueprint(
    instanceId: string,
    blueprint: unknown
  ): Promise<DeploymentResult> {
    return this.callMcp('deploy_siteforge_blueprint', { instance_id: instanceId, blueprint })
  }
  
  /**
   * Create new WordPress instance
   */
  async createInstance(
    propertyName: string,
    propertyId: string
  ): Promise<WordPressInstance> {
    return this.callMcp('create_wordpress_instance', { property_name: propertyName, property_id: propertyId })
  }
  
  /**
   * Call MCP server (abstraction for future MCP protocol integration)
   */
  private async callMcp(tool: string, args: Record<string, unknown>): Promise<any> {
    if (typeof window === 'undefined') {
      return this.callMcpServer(tool, args)
    }
    
    try {
      const response = await fetch('/api/mcp/wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, arguments: args })
      })
      
      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`WordPress MCP call failed: ${response.status} ${response.statusText} ${errorBody}`.trim())
      }
      
      const data = await response.json()
      return data.result
    } catch (error) {
      throw new Error(
        `WordPress MCP fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async callMcpServer(tool: string, args: Record<string, unknown>): Promise<any> {
    const [{ exec }, { promisify }, pathModule] = await Promise.all([
      import('child_process'),
      import('util'),
      import('path'),
    ])
    const execAsync = promisify(exec)
    const mcpServerPath = pathModule.join(process.cwd(), '..', 'services', 'mcp-servers', 'wordpress')
    const input = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args,
      },
      id: 1,
    }
    const command = `cd "${mcpServerPath}" && python -m wordpress.server --call "${JSON.stringify(input).replace(/"/g, '\\"')}"`

    try {
      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          PYTHONPATH: pathModule.join(process.cwd(), '..', 'services', 'mcp-servers'),
        },
      })

      if (stderr) {
        console.error('WordPress MCP stderr:', stderr)
      }

      const response = JSON.parse(stdout)
      if (response.error) {
        throw new Error(response.error.message)
      }

      return response.result
    } catch (error) {
      throw new Error(
        `WordPress MCP server call failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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

export interface DeploymentResult {
  success: boolean
  instanceId: string
  url: string
  adminUrl: string
  pagesCreated: number
}

export interface WordPressInstance {
  instanceId: string
  url: string
  adminUrl: string
  credentials: {
    username: string
    password: string
  }
}










