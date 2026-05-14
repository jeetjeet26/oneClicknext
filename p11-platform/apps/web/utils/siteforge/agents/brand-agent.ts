// SiteForge Brand Agent
// Synthesizes brand intelligence from all sources using Claude Sonnet 4
// Uses: BrandForge data, vector embeddings, KB documents, competitor analysis
// Created: December 16, 2025

import { BaseAgent, type VectorSearchResult } from './base-agent'

// Structured color from BrandForge
export interface BrandColor {
  name: string
  hex: string
  usage?: string
}

// Structured typography from BrandForge
export interface BrandTypography {
  primaryFont: string
  primaryUsage?: string
  secondaryFont: string
  secondaryUsage?: string
}

// Logo assets from BrandForge
export interface BrandLogoAssets {
  primaryUrl?: string
  variations?: string[]
  concept?: string
  style?: string
}

export interface BrandContext {
  source: 'brandforge' | 'knowledge_base' | 'generated' | 'hybrid'
  confidence: number
  
  brandPersonality: {
    primary: string
    traits: string[]
    avoid: string[]
  }
  
  visualIdentity: {
    moodKeywords: string[]
    colorMood: string
    photoStyle: {
      lighting: string
      composition: string
      subjects: string
      mood: string
    }
    designStyle: string
  }
  
  targetAudience: {
    demographics: string
    psychographics: string
    priorities: string[]
    painPoints: string[]
  }
  
  positioning: {
    category: string
    differentiators: string[]
    competitiveAdvantage: string
    messagingPillars: string[]
  }
  
  contentStrategy: {
    voiceTone: string
    vocabularyUse: string[]
    vocabularyAvoid: string[]
    headlineStyle: string
    storytellingFocus: string
  }
  
  designPrinciples: string[]
  
  // STRUCTURED VALUES FROM BRANDFORGE (preserved exactly, not synthesized)
  // These are optional - only present if BrandForge data exists
  
  /** Exact color palette from BrandForge section_8_colors */
  colorPalette?: {
    primary: BrandColor[]
    secondary: BrandColor[]
  }
  
  /** Exact typography from BrandForge section_7_typography */
  typography?: BrandTypography
  
  /** Logo assets from BrandForge section_6_logo */
  logoAssets?: BrandLogoAssets
}

interface BrandSources {
  brandForgeData: unknown
  vectorContext: {
    uniqueness: VectorSearchResult[]
    audience: VectorSearchResult[]
    personality: VectorSearchResult[]
    amenities: VectorSearchResult[]
    positioning: VectorSearchResult[]
    photoGuidelines: VectorSearchResult[]
  }
  propertyInfo: unknown
  competitors?: unknown
  dataScenario?: 'both' | 'brandbook_only' | 'kb_only' | 'neither'
}

type CompetitorSnapshotQuery = {
  select: (columns: string) => {
    eq: (column: 'property_id', value: string) => {
      order: (column: 'scraped_at', options: { ascending: boolean }) => {
        limit: (count: number) => PromiseLike<{ data: unknown[] | null }>
      }
    }
  }
}

/**
 * Brand Agent - Foundation agent that establishes brand context
 * All other agents depend on BrandContext output
 * 
 * Handles 4 scenarios:
 * 1. Both KB + Brand Book → Merge intelligently (highest confidence)
 * 2. Brand Book only → Use brand book as primary (high confidence)
 * 3. Knowledge Base only → Use KB vectors (medium confidence)
 * 4. Neither → Generate defaults from property info (low confidence)
 */
export class BrandAgent extends BaseAgent {
  
  /**
   * Main entry point - Analyze all sources and synthesize brand context
   */
  async analyze(): Promise<BrandContext> {
    
    await this.logAction('brand_analysis_start', { propertyId: this.propertyId })
    
    console.log(`🎨 [BrandAgent] Starting brand analysis for property: ${this.propertyId}`)
    
    // 1. Gather all sources in parallel with individual error tracking
    let brandForgeData: any = null
    let propertyInfo: any = null
    let vectorContext: any = null
    let brandForgeError: Error | null = null
    let vectorError: Error | null = null
    
    try {
      [brandForgeData, propertyInfo, vectorContext] = await Promise.all([
        this.getBrandForgeData().catch(err => {
          brandForgeError = err
          console.error('❌ [BrandAgent] BrandForge data retrieval failed:', err.message)
          return null
        }),
        this.getPropertyInfo(),
        this.gatherVectorContext().catch(err => {
          vectorError = err
          console.error('❌ [BrandAgent] Vector context retrieval failed:', err.message)
          return {
            uniqueness: [],
            audience: [],
            personality: [],
            amenities: [],
            positioning: [],
            photoGuidelines: []
          }
        })
      ])
    } catch (error) {
      console.error('❌ [BrandAgent] Critical error gathering sources:', error)
    }
    
    // Log detailed retrieval results
    if (brandForgeData) {
      console.log('✅ [BrandAgent] BrandForge data retrieved successfully:', {
        hasIntro: !!brandForgeData.section_1_introduction,
        hasColors: !!brandForgeData.section_8_colors,
        hasTypography: !!brandForgeData.section_7_typography,
        hasLogo: !!brandForgeData.section_6_logo,
        status: brandForgeData.generation_status
      })
    } else {
      console.warn('⚠️ [BrandAgent] No BrandForge data available:', {
        error: (brandForgeError as any)?.message || 'null returned',
        propertyId: this.propertyId
      })
    }
    
    // 2. Get competitor analysis if available
    const competitors = await this.getCompetitorAnalysis()
    
    // 3. Determine which data sources we have
    const hasBrandBook = !!brandForgeData && Object.keys(brandForgeData).length > 0
    const hasKB = this.hasVectorContent(vectorContext)
    
    const dataScenario = hasBrandBook && hasKB ? 'both' :
                         hasBrandBook ? 'brandbook_only' :
                         hasKB ? 'kb_only' : 'neither'
    
    // Log detailed scenario reasoning
    console.log(`🎨 [BrandAgent] Data scenario determined: ${dataScenario}`, {
      hasBrandBook,
      hasKB,
      brandForgeError: (brandForgeError as any)?.message || null,
      vectorError: (vectorError as any)?.message || null,
      vectorCounts: {
        uniqueness: vectorContext?.uniqueness?.length || 0,
        audience: vectorContext?.audience?.length || 0,
        personality: vectorContext?.personality?.length || 0,
        amenities: vectorContext?.amenities?.length || 0,
        positioning: vectorContext?.positioning?.length || 0,
        photoGuidelines: vectorContext?.photoGuidelines?.length || 0
      },
      expectedConfidence: dataScenario === 'both' ? '95%' :
                          dataScenario === 'brandbook_only' ? '85%' :
                          dataScenario === 'kb_only' ? '75%' : '40-50%'
    })
    
    // 4. Synthesize using Claude Sonnet 4 with appropriate strategy
    const brandContext = await this.synthesizeBrandContext({
      brandForgeData,
      vectorContext,
      propertyInfo,
      competitors,
      dataScenario
    })
    
    // 5. IMPORTANT: Extract and preserve structured values from BrandForge
    // These bypass Claude synthesis to preserve exact hex codes, URLs, etc.
    if (hasBrandBook && brandForgeData) {
      const structuredValues = this.extractStructuredBrandForgeValues(brandForgeData)
      
      if (structuredValues.colorPalette) {
        brandContext.colorPalette = structuredValues.colorPalette
        console.log('🎨 Preserved color palette from BrandForge:', structuredValues.colorPalette)
      }
      
      if (structuredValues.typography) {
        brandContext.typography = structuredValues.typography
        console.log('🔤 Preserved typography from BrandForge:', structuredValues.typography)
      }
      
      if (structuredValues.logoAssets) {
        brandContext.logoAssets = structuredValues.logoAssets
        console.log('🖼️ Preserved logo assets from BrandForge:', structuredValues.logoAssets)
      }
    }
    
    await this.logAction('brand_analysis_complete', { 
      confidence: brandContext.confidence,
      source: brandContext.source,
      dataScenario,
      hasColorPalette: !!brandContext.colorPalette,
      hasTypography: !!brandContext.typography,
      hasLogoAssets: !!brandContext.logoAssets
    })
    
    return brandContext
  }
  
  /**
   * Extract structured values directly from BrandForge data
   * These values are preserved exactly as stored, not synthesized by Claude
   */
  private extractStructuredBrandForgeValues(brandForgeData: any): {
    colorPalette?: BrandContext['colorPalette']
    typography?: BrandContext['typography']
    logoAssets?: BrandContext['logoAssets']
  } {
    const result: {
      colorPalette?: BrandContext['colorPalette']
      typography?: BrandContext['typography']
      logoAssets?: BrandContext['logoAssets']
    } = {}
    
    // Extract colors from section_8_colors
    const colorsSection = brandForgeData.section_8_colors
    if (colorsSection) {
      const primaryColors: BrandColor[] = []
      const secondaryColors: BrandColor[] = []
      
      // Handle primary colors (can be array or object)
      if (Array.isArray(colorsSection.primary)) {
        for (const color of colorsSection.primary) {
          if (color.hex) {
            primaryColors.push({
              name: color.name || 'Primary',
              hex: color.hex,
              usage: color.usage
            })
          }
        }
      } else if (colorsSection.primary?.hex) {
        primaryColors.push({
          name: colorsSection.primary.name || 'Primary',
          hex: colorsSection.primary.hex,
          usage: colorsSection.primary.usage
        })
      }
      
      // Handle secondary colors
      if (Array.isArray(colorsSection.secondary)) {
        for (const color of colorsSection.secondary) {
          if (color.hex) {
            secondaryColors.push({
              name: color.name || 'Secondary',
              hex: color.hex,
              usage: color.usage
            })
          }
        }
      } else if (colorsSection.secondary?.hex) {
        secondaryColors.push({
          name: colorsSection.secondary.name || 'Secondary',
          hex: colorsSection.secondary.hex,
          usage: colorsSection.secondary.usage
        })
      }
      
      if (primaryColors.length > 0 || secondaryColors.length > 0) {
        result.colorPalette = {
          primary: primaryColors,
          secondary: secondaryColors
        }
      }
    }
    
    // Extract typography from section_7_typography
    const typographySection = brandForgeData.section_7_typography
    if (typographySection) {
      const primaryFont = typographySection.primaryFont || 
                          typographySection.primary?.font ||
                          typographySection.headingFont
      const secondaryFont = typographySection.secondaryFont || 
                            typographySection.secondary?.font ||
                            typographySection.bodyFont
      
      if (primaryFont || secondaryFont) {
        result.typography = {
          primaryFont: primaryFont || 'Inter',
          primaryUsage: typographySection.primaryUsage || typographySection.primary?.usage || 'Headlines, logo, signage',
          secondaryFont: secondaryFont || 'Inter',
          secondaryUsage: typographySection.secondaryUsage || typographySection.secondary?.usage || 'Body copy, digital applications'
        }
      }
    }
    
    // Extract logo assets from section_6_logo
    const logoSection = brandForgeData.section_6_logo
    if (logoSection) {
      result.logoAssets = {
        primaryUrl: logoSection.logoUrl || logoSection.url || logoSection.primaryUrl,
        variations: logoSection.logoVariations || logoSection.variations || [],
        concept: logoSection.concept,
        style: logoSection.style
      }
    }
    
    return result
  }
  
  /**
   * Check if vector context has meaningful content
   */
  private hasVectorContent(vectorContext: BrandSources['vectorContext']): boolean {
    const totalResults = 
      vectorContext.uniqueness.length +
      vectorContext.audience.length +
      vectorContext.personality.length +
      vectorContext.amenities.length +
      vectorContext.positioning.length +
      vectorContext.photoGuidelines.length
    
    // Consider we have KB if we got at least 3 relevant results across categories
    return totalResults >= 3
  }
  
  /**
   * Gather insights from vector embeddings
   */
  private async gatherVectorContext(): Promise<BrandSources['vectorContext']> {
    
    // Run semantic searches in parallel
    const [
      uniqueness,
      audience,
      personality,
      amenities,
      positioning,
      photoGuidelines
    ] = await Promise.all([
      this.vectorSearch("What makes this property unique? What are the key differentiators and signature features?"),
      this.vectorSearch("Who is the target resident? Demographics, lifestyle, preferences, priorities?"),
      this.vectorSearch("What is the brand personality? Tone, voice, values, character traits?"),
      this.vectorSearch("What amenities and features are most important to highlight and showcase?"),
      this.vectorSearch("How is this property positioned in the market? What's the competitive advantage?"),
      this.vectorSearch("Photography guidelines, photo style, visual brand identity, image preferences?")
    ])
    
    return {
      uniqueness,
      audience,
      personality,
      amenities,
      positioning,
      photoGuidelines
    }
  }
  
  /**
   * Get competitor analysis from MarketVision
   */
  private async getCompetitorAnalysis(): Promise<unknown> {
    const supabase = this.supabase as unknown as {
      from: (table: 'competitor_snapshots') => CompetitorSnapshotQuery
    }

    const { data } = await supabase
      .from('competitor_snapshots')
      .select('*')
      .eq('property_id', this.propertyId)
      .order('scraped_at', { ascending: false })
      .limit(5)
    
    return data || []
  }
  
  /**
   * Synthesize all sources into unified brand context using Claude
   * Adapts prompt based on available data sources
   */
  private async synthesizeBrandContext(sources: BrandSources): Promise<BrandContext> {
    const scenario = sources.dataScenario || 'neither'
    
    // Build scenario-specific prompt sections
    const { dataSection, instructions, expectedConfidence, expectedSource } = 
      this.buildPromptForScenario(sources, scenario)
    
    const systemPrompt = `You are a brand intelligence expert specializing in real estate. Your role is to synthesize available data sources into a unified brand context that will guide all website design decisions.

You must be precise, insightful, and actionable. Base recommendations on provided data. When data is limited, make reasonable inferences based on property type and market positioning, but be explicit about what is inferred vs data-driven.

CRITICAL JSON RULES - FOLLOW EXACTLY:
1. Return ONLY valid JSON - no markdown, no code blocks
2. NO trailing commas after the last item in arrays/objects
3. NO annotations or comments like (overuse) or (note) after values
4. Every string value must be complete and properly quoted
5. If you want to add a note about a value, include it INSIDE the quotes: "sophisticated" NOT "sophisticated" (overuse)`
    
    const prompt = `
Create a unified brand context for website generation.

# DATA AVAILABILITY: ${scenario.toUpperCase()}
${instructions}

${dataSection}

# PROPERTY INFORMATION:
${JSON.stringify(sources.propertyInfo, null, 2)}

${sources.competitors && Array.isArray(sources.competitors) && sources.competitors.length > 0 ? `
# COMPETITOR ANALYSIS:
${JSON.stringify(sources.competitors, null, 2)}
` : ''}

# YOUR TASK:

Create a brand context with confidence: ${expectedConfidence} and source: "${expectedSource}"

Return this exact JSON structure (NO trailing commas, NO comments):

{
  "source": "${expectedSource}",
  "confidence": ${expectedConfidence},
  
  "brandPersonality": {
    "primary": "e.g., sophisticated-relaxed, vibrant-urban, family-welcoming",
    "traits": ["trait1", "trait2", "trait3"],
    "avoid": ["what doesn't fit"]
  },
  
  "visualIdentity": {
    "moodKeywords": ["mood1", "mood2", "mood3"],
    "colorMood": "color palette description",
    "photoStyle": {
      "lighting": "lighting style",
      "composition": "composition approach",
      "subjects": "who/what to photograph",
      "mood": "emotional tone"
    },
    "designStyle": "overall design approach"
  },
  
  "targetAudience": {
    "demographics": "target demographics",
    "psychographics": "values and lifestyle",
    "priorities": ["priority1", "priority2"],
    "painPoints": ["painpoint1", "painpoint2"]
  },
  
  "positioning": {
    "category": "market category",
    "differentiators": ["diff1", "diff2"],
    "competitiveAdvantage": "main advantage",
    "messagingPillars": ["pillar1", "pillar2", "pillar3"]
  },
  
  "contentStrategy": {
    "voiceTone": "voice and tone description",
    "vocabularyUse": ["word1", "word2", "word3"],
    "vocabularyAvoid": ["avoid1", "avoid2"],
    "headlineStyle": "headline approach",
    "storytellingFocus": "focus area"
  },
  
  "designPrinciples": [
    "principle1",
    "principle2",
    "principle3"
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object - the response will be parsed directly
- NO annotations after values like "word" (note) - put notes INSIDE quotes: "word (note)"  
- NO trailing commas after the last array/object item
- Every value must be a valid JSON type (string, number, boolean, array, object, null)
- Start your response with the opening brace { immediately`
    
    try {
      const response = await this.callClaude(prompt, {
        systemPrompt,
        maxTokens: 30000,
        jsonMode: true  // Will use temp 0.3 and prefill automatically
      })
      
      // Use shared robust parser
      const brandContext = this.parseJSON<BrandContext>(response, 'BrandAgent')
      
      // Validate required fields exist
      this.validateBrandContext(brandContext)
      
      return brandContext
      
    } catch (error) {
      console.error('❌ Brand synthesis failed:', error)
      console.log('⚠️ Returning fallback brand context')
      
      // Return sensible fallback based on property info
      return this.createFallbackBrandContext(sources.propertyInfo, scenario)
    }
  }
  
  /**
   * Build prompt sections based on data scenario
   */
  private buildPromptForScenario(sources: BrandSources, scenario: string): {
    dataSection: string
    instructions: string
    expectedConfidence: number
    expectedSource: string
  } {
    let dataSection = ''
    let instructions = ''
    let expectedConfidence = 0.5
    let expectedSource = 'generated'
    
    switch (scenario) {
      case 'both':
        expectedConfidence = 0.95
        expectedSource = 'hybrid'
        instructions = `You have BOTH a structured brand book AND knowledge base insights. 
MERGE these sources intelligently:
- Brand book provides strategic direction and visual identity
- Knowledge base provides specific details, facts, and nuances
- When they align, confidence is highest
- When they differ, favor brand book for strategy, KB for specifics`
        
        dataSection = `
# BRANDFORGE BRAND BOOK (Primary strategic source):
${JSON.stringify(sources.brandForgeData, null, 2)}

# KNOWLEDGE BASE INSIGHTS (Semantic search results):

## Uniqueness & Differentiators:
${this.formatVectorResults(sources.vectorContext.uniqueness)}

## Target Audience:
${this.formatVectorResults(sources.vectorContext.audience)}

## Brand Personality:
${this.formatVectorResults(sources.vectorContext.personality)}

## Key Amenities:
${this.formatVectorResults(sources.vectorContext.amenities)}

## Market Positioning:
${this.formatVectorResults(sources.vectorContext.positioning)}

## Photography Guidelines:
${this.formatVectorResults(sources.vectorContext.photoGuidelines)}`
        break
        
      case 'brandbook_only':
        expectedConfidence = 0.85
        expectedSource = 'brandforge'
        instructions = `You have a structured BRAND BOOK but NO knowledge base.
Use the brand book as your primary source for ALL decisions.
The brand book contains strategic positioning, visual identity, and voice guidelines.
Be confident in brand book data but note that specific property details may be limited.`
        
        dataSection = `
# BRANDFORGE BRAND BOOK (Your primary source):
${JSON.stringify(sources.brandForgeData, null, 2)}

(No knowledge base available - rely on brand book and property info)`
        break
        
      case 'kb_only':
        expectedConfidence = 0.75
        expectedSource = 'knowledge_base'
        instructions = `You have KNOWLEDGE BASE insights but NO formal brand book.
Use vector search results as your primary source.
Higher similarity scores = more reliable information.
Infer brand personality from the content and tone of KB documents.
Be explicit that this is inferred from content, not a formal brand strategy.`
        
        dataSection = `
# KNOWLEDGE BASE INSIGHTS (Your primary source - semantic search):

## Uniqueness & Differentiators:
${this.formatVectorResults(sources.vectorContext.uniqueness)}

## Target Audience:
${this.formatVectorResults(sources.vectorContext.audience)}

## Brand Personality:
${this.formatVectorResults(sources.vectorContext.personality)}

## Key Amenities:
${this.formatVectorResults(sources.vectorContext.amenities)}

## Market Positioning:
${this.formatVectorResults(sources.vectorContext.positioning)}

## Photography Guidelines:
${this.formatVectorResults(sources.vectorContext.photoGuidelines)}

(No formal brand book - infer brand strategy from KB content)`
        break
        
      case 'neither':
      default:
        expectedConfidence = 0.5
        expectedSource = 'generated'
        instructions = `You have LIMITED DATA - only basic property information.
Generate a reasonable brand context based on:
- Property type (apartments, luxury, student housing, etc.)
- Location and market context
- Standard best practices for this property category
BE EXPLICIT that this is generated/inferred, not data-driven.
Use conservative, professional defaults that work for most properties.`
        
        dataSection = `
(No brand book or knowledge base available)
(Generate reasonable defaults based on property type and info below)`
        break
    }
    
    return { dataSection, instructions, expectedConfidence, expectedSource }
  }
  
  /**
   * Format vector results for prompt
   */
  private formatVectorResults(results: VectorSearchResult[]): string {
    if (!results || results.length === 0) {
      return '(No results found)'
    }
    return results
      .map(d => `- ${d.content} (relevance: ${d.similarity.toFixed(2)})`)
      .join('\n')
  }
  
  /**
   * Validate brand context has required fields
   */
  private validateBrandContext(context: BrandContext): void {
    const required = ['brandPersonality', 'visualIdentity', 'targetAudience', 'positioning', 'contentStrategy']
    for (const field of required) {
      if (!context[field as keyof BrandContext]) {
        throw new Error(`Missing required field: ${field}`)
      }
    }
  }
  
  /**
   * Create fallback brand context when synthesis fails
   */
  private createFallbackBrandContext(propertyInfo: unknown, scenario: string): BrandContext {
    const info = propertyInfo as any || {}
    const propertyName = info.name || 'Property'
    const propertyType = info.property_type || 'multifamily'
    
    // Infer basic personality from property type
    const isLuxury = propertyType.toLowerCase().includes('luxury') || 
                     propertyName.toLowerCase().includes('luxury')
    const isStudent = propertyType.toLowerCase().includes('student')
    const isSenior = propertyType.toLowerCase().includes('senior') ||
                     propertyType.toLowerCase().includes('55+')
    const isForSaleResidential = ['townhome', 'condo', 'single_family', 'master_planned']
      .some(type => propertyType.toLowerCase().includes(type))
    
    let personality = 'professional-welcoming'
    let voiceTone = 'Friendly and professional'
    let designStyle = 'Clean and modern'
    
    if (isLuxury) {
      personality = 'sophisticated-refined'
      voiceTone = 'Elegant and aspirational'
      designStyle = 'Luxury with generous whitespace'
    } else if (isStudent) {
      personality = 'vibrant-energetic'
      voiceTone = 'Fun, casual, and relatable'
      designStyle = 'Bold and colorful'
    } else if (isSenior) {
      personality = 'warm-trustworthy'
      voiceTone = 'Warm, reassuring, and clear'
      designStyle = 'Clean with excellent readability'
    } else if (isForSaleResidential) {
      personality = 'aspirational-trustworthy'
      voiceTone = 'Confident, helpful, and buyer-focused'
      designStyle = 'Polished residential with strong lifestyle imagery'
    }
    
    return {
      source: 'generated',
      confidence: 0.4,
      
      brandPersonality: {
        primary: personality,
        traits: ['welcoming', 'professional', 'community-focused'],
        avoid: ['pushy', 'generic', 'impersonal']
      },
      
      visualIdentity: {
        moodKeywords: ['modern', 'clean', 'inviting'],
        colorMood: 'Professional with warm accents',
        photoStyle: {
          lighting: 'Natural, well-lit',
          composition: 'Clean and uncluttered',
          subjects: 'Amenities, spaces, lifestyle moments',
          mood: 'Welcoming and aspirational'
        },
        designStyle
      },
      
      targetAudience: {
        demographics: isForSaleResidential ? 'Home shoppers and buyers in the local market' : 'Apartment seekers in the local market',
        psychographics: 'Value quality living and convenience',
        priorities: isForSaleResidential ? ['Location', 'Home design', 'Long-term value'] : ['Location', 'Amenities', 'Value'],
        painPoints: isForSaleResidential ? ['Finding the right home', 'Purchase complexity'] : ['Finding the right home', 'Lease complexity']
      },
      
      positioning: {
        category: propertyType,
        differentiators: ['Quality', 'Location', 'Community'],
        competitiveAdvantage: 'Exceptional living experience',
        messagingPillars: ['Quality living', 'Great location', 'Responsive service']
      },
      
      contentStrategy: {
        voiceTone,
        vocabularyUse: ['home', 'community', 'lifestyle', 'comfort'],
        vocabularyAvoid: ['unit', 'tenant', 'cheap', 'basic'],
        headlineStyle: 'Clear and benefit-focused',
        storytellingFocus: 'Benefits and lifestyle over features'
      },
      
      designPrinciples: [
        'Prioritize clarity and ease of navigation',
        'Use high-quality photography',
        'Make CTAs clear and accessible',
        'Ensure mobile-first responsive design'
      ]
    }
  }
}











