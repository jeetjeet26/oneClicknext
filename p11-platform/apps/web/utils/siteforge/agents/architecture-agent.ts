// SiteForge Architecture Agent
// Plans site structure based on brand context + WordPress capabilities
// Uses Claude Sonnet 4 with discovered WordPress constraints
// Created: December 16, 2025

import { BaseAgent, type VectorSearchResult } from './base-agent'
import { WordPressMcpClient, type WordPressCapabilities } from '@/utils/mcp/wordpress-client'
import type { BrandContext } from './brand-agent'

export interface ArchitectureProposal {
  navigation: {
    structure: 'primary' | 'mega' | 'minimal'
    items: Array<{ label: string; slug: string; priority: 'high' | 'medium' | 'low' }>
    reasoning: string
  }
  
  pages: Array<{
    slug: string
    title: string
    purpose: string
    priority: 'high' | 'medium' | 'low'
    sections: SectionSpec[]
  }>
  
  conversionStrategy: {
    primaryCTA: string
    ctaPlacement: string[]
    reasoning: string
  }
  
  capabilityGaps?: Array<{
    need: string
    workaround: string
    pluginSuggestion?: string
  }>
}

interface SectionSpec {
  id: string
  type: string
  purpose: string
  block: string
  variant?: string
  fields: Record<string, unknown>
  cssClasses?: string[]
  photoRequirement?: PhotoRequirement
  reasoning: string
  order: number
}

interface PhotoRequirement {
  category: 'hero' | 'amenity' | 'lifestyle' | 'gallery'
  scene: string
  priority: 'high' | 'medium' | 'low'
}

interface PropertyContext {
  pagePriorities: VectorSearchResult[]
  userJourney: VectorSearchResult[]
  contentHierarchy: VectorSearchResult[]
  ctaStrategy: VectorSearchResult[]
  navigationNeeds: VectorSearchResult[]
}

/**
 * Architecture Agent - Plans site structure within WordPress constraints
 * Queries WordPress MCP to discover capabilities, then plans using Claude
 */
export class ArchitectureAgent extends BaseAgent {
  private wpMcp: WordPressMcpClient
  
  constructor(
    propertyId: string,
    private instanceId?: string
  ) {
    super(propertyId)
    this.wpMcp = new WordPressMcpClient()
  }
  
  /**
   * Plan site architecture
   */
  async plan(
    brandContext: BrandContext,
    userPreferences?: Record<string, unknown>
  ): Promise<ArchitectureProposal> {
    
    await this.logAction('architecture_planning_start', { propertyId: this.propertyId })
    
    // 1. Discover WordPress capabilities
    const wpCapabilities = await this.discoverWordPress()
    
    // 2. Get property context via vector search
    const propertyContext = await this.getPropertyContext()
    
    // 3. Optionally analyze a user-provided reference site
    const referenceAnalysis = await this.analyzeReference(userPreferences)
    
    // 4. Claude plans using all context
    const proposal = await this.planWithConstraints({
      brandContext,
      propertyContext,
      wpCapabilities,
      referenceAnalysis,
      userPreferences
    })
    
    await this.logAction('architecture_planning_complete', {
      pagesPlanned: proposal.pages.length,
      sectionsTotal: proposal.pages.reduce((sum, p) => sum + p.sections.length, 0)
    })
    
    return proposal
  }
  
  /**
   * Discover WordPress capabilities
   */
  private async discoverWordPress(): Promise<WordPressCapabilities> {
    const instanceId = this.instanceId || 'template-collection-theme'
    return this.wpMcp.getCapabilities(instanceId)
  }
  
  /**
   * Get property context via vector search
   */
  private async getPropertyContext(): Promise<PropertyContext> {
    
    const [
      pagePriorities,
      userJourney,
      contentHierarchy,
      ctaStrategy,
      navigationNeeds
    ] = await Promise.all([
      this.vectorSearch("What information is most important for prospects to see when visiting the website? What pages are essential?"),
      this.vectorSearch("What is the typical prospect journey from awareness to tour booking or application?"),
      this.vectorSearch("What content should be prioritized and emphasized on the website?"),
      this.vectorSearch("What calls-to-action drive the most conversions? When should prospects be prompted to act?"),
      this.vectorSearch("How should the navigation be structured? What pages need quick access?")
    ])
    
    return {
      pagePriorities,
      userJourney,
      contentHierarchy,
      ctaStrategy,
      navigationNeeds
    }
  }
  
  /**
   * Analyze a user-provided reference site for patterns
   */
  private async analyzeReference(userPreferences?: Record<string, unknown>): Promise<any> {
    const referenceSiteUrl =
      typeof userPreferences?.referenceSiteUrl === 'string'
        ? userPreferences.referenceSiteUrl.trim()
        : ''

    if (!/^https?:\/\//.test(referenceSiteUrl)) {
      return null
    }

    try {
      return await this.wpMcp.analyzeExistingSite(referenceSiteUrl)
    } catch (e) {
      console.warn('Could not analyze reference site:', e)
      return null
    }
  }
  
  /**
   * Plan architecture with WordPress constraints
   */
  private async planWithConstraints(data: {
    brandContext: BrandContext
    propertyContext: PropertyContext
    wpCapabilities: WordPressCapabilities
    referenceAnalysis: any
    userPreferences?: Record<string, unknown>
  }): Promise<ArchitectureProposal> {
    
    const systemPrompt = `You are a WordPress website architect specializing in real estate. You plan site structures using DISCOVERED WordPress capabilities, not assumptions.

Your plans must:
1. Use ONLY blocks that exist in WordPress
2. Select appropriate variants based on brand personality
3. Follow natural user journeys from property insights
4. Optimize for conversion based on strategy insights

You are creating high-trust multifamily websites that feel polished, distinctive, and conversion-focused without copying any single property.`
    
    const prompt = `
Plan a complete website architecture using discovered WordPress capabilities.

# BRAND CONTEXT:
${JSON.stringify(data.brandContext, null, 2)}

# PROPERTY INSIGHTS (Vector search of property knowledge):

## Page Priorities:
${data.propertyContext.pagePriorities.map(d => `- ${d.content} (relevance: ${d.similarity.toFixed(2)})`).join('\n')}

## User Journey:
${data.propertyContext.userJourney.map(d => `- ${d.content}`).join('\n')}

## Content Hierarchy:
${data.propertyContext.contentHierarchy.map(d => `- ${d.content}`).join('\n')}

## CTA Strategy:
${data.propertyContext.ctaStrategy.map(d => `- ${d.content}`).join('\n')}

## Navigation Needs:
${data.propertyContext.navigationNeeds.map(d => `- ${d.content}`).join('\n')}

# WORDPRESS CAPABILITIES (Discovered from template instance):

Theme: ${data.wpCapabilities.theme.name} v${data.wpCapabilities.theme.version}

Available Blocks:
${data.wpCapabilities.availableBlocks.map(b => `- ${b}`).join('\n')}

Block Schemas with Variants:
${JSON.stringify(data.wpCapabilities.blockSchemas, null, 2)}

Theme Design Tokens:
${JSON.stringify(data.wpCapabilities.designTokens, null, 2)}

${data.referenceAnalysis ? `
# REFERENCE SITE ANALYSIS:
${JSON.stringify(data.referenceAnalysis.insights_for_agents || data.referenceAnalysis.insightsForAgents, null, 2)}
` : ''}

# USER PREFERENCES:
${data.userPreferences ? JSON.stringify(data.userPreferences, null, 2) : 'None specified'}

# YOUR TASK:

Plan the optimal site architecture that:
1. Expresses brand personality through block/variant selection
2. Serves the user journey from property insights
3. Uses ONLY blocks from available_blocks
4. Configures blocks using discovered field schemas
5. Achieves polished multifamily marketing quality without copying reference content

# OUTPUT STRUCTURE (JSON):

{
  "navigation": {
    "structure": "primary|mega|minimal - based on navigationNeeds",
    "items": [
      {
        "label": "Home",
        "slug": "home",
        "priority": "high"
      }
    ],
    "reasoning": "Why this navigation structure serves the user journey"
  },
  
  "pages": [
    {
      "slug": "home",
      "title": "Home",
      "purpose": "From userJourney - what this page achieves",
      "priority": "high",
      
      "sections": [
        {
          "id": "hero-001",
          "type": "hero",
          "purpose": "First impression and value proposition",
          "block": "acf/top-slides",  // MUST be from available_blocks
          "variant": "fullwidth",     // From blockSchemas variants
          "fields": {
            "overlay_style": "gradient",  // From blockSchemas field options
            "autoplay": true
          },
          "cssClasses": ["hero-fullwidth", "hero-overlay"],
          "photoRequirement": {
            "category": "hero",
            "scene": "Based on brand differentiators - what to photograph",
            "priority": "high"
          },
          "reasoning": "Why fullwidth hero with gradient overlay expresses this brand",
          "order": 1
        }
      ]
    }
  ],
  
  "conversionStrategy": {
    "primaryCTA": "From ctaStrategy insights",
    "ctaPlacement": ["hero", "after-amenities", "footer"],
    "reasoning": "CTA strategy based on user urgency from insights"
  },
  
  "capabilityGaps": [
    {
      "need": "If brand needs something WordPress doesn't have",
      "workaround": "How to achieve it with available blocks",
      "pluginSuggestion": "Optional plugin that would enable it"
    }
  ]
}

# CRITICAL RULES:

1. ONLY use blocks from available_blocks array
2. ONLY use variants that exist in blockSchemas
3. ONLY use field values that match blockSchemas field types/choices
4. Base structure on propertyContext vector insights (high similarity = high priority)
5. Photo requirements should specify what scene/subject based on brand differentiators
6. Section order should follow natural user journey from insights
7. Reasoning must cite specific insights (e.g., "luxury whitespace from brand.designPrinciples")

# QUALITY BAR
- Clear above-the-fold value proposition
- Strong conversion CTA placement
- Cohesive visual hierarchy
- Lifestyle-forward content and imagery where brand-appropriate
- No copied competitor or reference-site phrasing

Use the available WordPress blocks to meet this quality bar.`
    
    const response = await this.callClaude(prompt, {
      systemPrompt,
      temperature: 1.0,
      maxTokens: 30000,
      jsonMode: true
    })
    
    // Use shared robust JSON parser
    const proposal = this.parseJSON<ArchitectureProposal>(response, 'ArchitectureAgent')
    
    // Ensure section IDs exist
    for (const page of proposal.pages || []) {
      for (let i = 0; i < (page.sections || []).length; i++) {
        if (!page.sections[i].id) {
          page.sections[i].id = `section-${page.slug}-${i + 1}`
        }
      }
    }
    
    return proposal
  }
}










