// SiteForge Content Agent
// Generates all copy based on brand voice + vector-grounded facts
// Uses Claude Sonnet 4 with semantic search for factual accuracy
// Created: December 16, 2025

import { BaseAgent, type VectorSearchResult } from './base-agent'
import type { BrandContext } from './brand-agent'
import type { ArchitectureProposal } from './architecture-agent'
import type { Photo } from './photo-agent'

export interface GeneratedPage {
  slug: string
  title: string
  purpose: string
  priority: string
  sections: GeneratedSection[]
}

export interface GeneratedSection {
  id: string
  type: string
  purpose: string
  block: string
  variant?: string
  fields: Record<string, unknown>
  cssClasses?: string[]
  photoRequirement?: any
  content: Record<string, unknown>
  reasoning: string
  order: number
}

/**
 * Content Agent - Generates all website copy
 * Uses vector search for factual grounding, brand voice for tone
 */
export class ContentAgent extends BaseAgent {
  
  /**
   * Generate content for all pages
   */
  async generateAll(
    architecture: ArchitectureProposal,
    brandContext: BrandContext
  ): Promise<GeneratedPage[]> {
    
    await this.logAction('content_generation_start', {
      pagesCount: architecture.pages.length
    })
    
    // Generate all pages in parallel
    const pages = await Promise.all(
      architecture.pages.map(page => 
        this.generatePage(page, brandContext, architecture.conversionStrategy)
      )
    )
    
    await this.logAction('content_generation_complete', {
      pagesGenerated: pages.length,
      sectionsGenerated: pages.reduce((sum, p) => sum + p.sections.length, 0)
    })
    
    return pages
  }
  
  /**
   * Generate content for one page
   */
  private async generatePage(
    page: any,
    brandContext: BrandContext,
    conversionStrategy: any
  ): Promise<GeneratedPage> {
    
    // Generate all sections in parallel
    const sections = await Promise.all(
      page.sections.map((section: any) => 
        this.generateSection(section, brandContext, page.purpose, conversionStrategy)
      )
    )
    
    return {
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      priority: page.priority,
      sections
    }
  }
  
  /**
   * Generate content for one section
   */
  private async generateSection(
    section: any,
    brandContext: BrandContext,
    pagePurpose: string,
    conversionStrategy: any
  ): Promise<GeneratedSection> {
    
    // Get relevant facts via vector search
    const relevantFacts = await this.vectorSearch(
      `Facts and details for ${section.type} section about ${section.purpose}. ${pagePurpose}`
    )
    
    // Claude generates content
    const systemPrompt = `You are a real estate copywriter. You write compelling, on-brand copy that:
1. Matches brand voice exactly
2. Uses ONLY facts from vector search (no hallucination)
3. Achieves section purpose
4. Drives conversion
5. Feels polished and distinctive without copying other properties`
    
    const prompt = `
Write content for this website section.

# SECTION DETAILS:
Type: ${section.type}
Purpose: ${section.purpose}
Block: ${section.block}
Page Purpose: ${pagePurpose}

# BRAND VOICE:
${JSON.stringify(brandContext.contentStrategy, null, 2)}

# BRAND PERSONALITY:
${JSON.stringify(brandContext.brandPersonality, null, 2)}

# RELEVANT FACTS (Vector search - use ONLY these facts):
${relevantFacts.map(f => `- ${f.content} (confidence: ${f.similarity.toFixed(2)})`).join('\n')}

# CONVERSION STRATEGY:
Primary CTA: ${conversionStrategy.primaryCTA}
${section.type === 'cta' || section.type === 'hero' ? 'This section has CTA - make it compelling' : ''}

# YOUR TASK:

Write content that:
1. Matches voiceTone: "${brandContext.contentStrategy.voiceTone}"
2. Uses vocabularyUse words: ${brandContext.contentStrategy.vocabularyUse.join(', ')}
3. AVOIDS vocabularyAvoid words: ${brandContext.contentStrategy.vocabularyAvoid.join(', ')}
4. Follows headlineStyle: "${brandContext.contentStrategy.headlineStyle}"
5. Uses ONLY facts from relevantFacts above
6. Achieves section purpose

# OUTPUT (JSON):

{
  "headline": "Based on headlineStyle - make it ${brandContext.contentStrategy.headlineStyle}",
  "subheadline": "Supporting message",
  "content": "Body copy using relevant facts",
  "cta_text": "${conversionStrategy.primaryCTA}" if section needs CTA,
  "cta_link": "/contact or /schedule-tour",
  "reasoning": "Why this copy achieves section purpose and matches brand voice"
}

# EXAMPLES OF GOOD COPY QUALITY:

Luxury Resort Brand:
- Headline: "Synced to the Rhythm of Your Life" (poetic, aspirational)
- Body: "Live carefree every day. Feel like you're on vacation." (benefit-focused)

Family Community:
- Headline: "Where Memories Are Made Daily" (emotional)
- Body: "Spacious homes, safe streets, top-rated schools nearby." (specific facts)

Urban Living:
- Headline: "Downtown Energy. Uptown Ease." (parallel structure)
- Body: "Walk to work. Walk to restaurants. Walk to everything." (repetition)

Match this level of clarity and polish without copying the example phrasing.

# CRITICAL RULES:

1. Headlines must be ${brandContext.contentStrategy.headlineStyle}
2. Use vocabularyUse words, NEVER vocabularyAvoid words
3. Every fact must come from relevantFacts (cite similarity score mentally)
4. If no relevant facts, keep content general but on-brand
5. CTAs must match primaryCTA unless section specifies otherwise
6. Reasoning must explain how copy achieves purpose
`
    
    const response = await this.callClaude(prompt, {
      systemPrompt,
      maxTokens: 30000,
      jsonMode: true  // Will use temp 0.3 and prefill automatically
    })
    
    // Use shared robust JSON parser
    const content = this.parseJSON<Record<string, unknown>>(response, 'ContentAgent')
    
    // Ensure minimum content exists - never return empty sections
    if (!content.headline && !content.content && !content.items && !content.slides) {
      console.warn(`⚠️ [ContentAgent] Empty content generated for ${section.type}, adding fallback`)
      content.headline = this.formatSectionType(section.type)
      content.content = `Content for the ${section.type.replace(/-/g, ' ')} section. Click to edit and customize.`
    }
    
    return {
      ...section,
      content,
      reasoning: content.reasoning || section.reasoning
    }
  }
  
  /**
   * Format section type for display
   */
  private formatSectionType(type: string): string {
    return type
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
  
  /**
   * Assign photos to sections based on manifest
   */
  private async assignPhotosToSections(
    allPhotos: Photo[],
    pages: any[]
  ): Promise<Map<string, string>> {
    
    const assignments = new Map<string, string>()
    
    for (const page of pages) {
      for (const section of page.sections || []) {
        if (section.photoRequirement) {
          const matches = allPhotos.filter(p => 
            p.category === section.photoRequirement.category
          )
          
          if (matches.length > 0) {
            const best = matches.sort((a, b) => b.quality - a.quality)[0]
            assignments.set(section.id, best.id)
          }
        }
      }
    }
    
    return assignments
  }
}











