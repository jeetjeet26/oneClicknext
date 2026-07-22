// SiteForge Quality Agent
// Validates all outputs against brand context + WordPress constraints
// Uses Claude Sonnet 4 for intelligent quality assessment
// Created: December 16, 2025

import { BaseAgent } from './base-agent'
import type { BrandContext } from './brand-agent'
import type { DesignSystem } from './design-agent'
import type { PhotoManifest } from './photo-agent'
import type { GeneratedPage, GeneratedSection } from './content-agent'
import type { WordPressCapabilities } from '@/utils/mcp/wordpress-client'

export interface QualityReport {
  score: number
  passed: boolean
  checks: {
    brandConsistency: QualityCheck
    contentQuality: QualityCheck
    photoQuality: QualityCheck
    designCoherence: QualityCheck
    wordpressCompatibility: QualityCheck
  }
  improvements: string[]
  timestamp: string
}

interface QualityCheck {
  score: number
  passed: boolean
  issues: string[]
  suggestions: string[]
}

/**
 * Quality Agent - Validates everything before deployment
 * Ensures brand consistency, WordPress compatibility, and a polished quality bar
 */
export class QualityAgent extends BaseAgent {
  
  /**
   * Validate complete blueprint
   */
  async validate(data: {
    pages: GeneratedPage[]
    designSystem: DesignSystem
    photoManifest: PhotoManifest
    brandContext: BrandContext
    wpCapabilities: WordPressCapabilities
  }): Promise<QualityReport> {
    
    await this.logAction('quality_validation_start', { propertyId: this.propertyId })
    
    // Run all checks in parallel
    const [
      brandConsistency,
      contentQuality,
      photoQuality,
      designCoherence,
      wordpressCompatibility
    ] = await Promise.all([
      this.checkBrandConsistency(data.pages, data.brandContext),
      this.checkContentQuality(data.pages, data.brandContext),
      this.checkPhotoQuality(data.photoManifest, data.brandContext),
      this.checkDesignCoherence(data.designSystem, data.brandContext),
      this.checkWordPressCompatibility(data.pages, data.wpCapabilities)
    ])
    
    // Calculate weighted overall score
    const overallScore = (
      brandConsistency.score * 0.30 +
      contentQuality.score * 0.25 +
      photoQuality.score * 0.20 +
      designCoherence.score * 0.15 +
      wordpressCompatibility.score * 0.10
    )
    
    // Generate improvements if needed
    const improvements = this.generateImprovements({
      brandConsistency,
      contentQuality,
      photoQuality,
      designCoherence,
      wordpressCompatibility
    })
    
    const report = {
      score: overallScore,
      passed: overallScore >= 80,
      checks: {
        brandConsistency,
        contentQuality,
        photoQuality,
        designCoherence,
        wordpressCompatibility
      },
      improvements,
      timestamp: new Date().toISOString()
    }
    
    await this.logAction('quality_validation_complete', {
      score: overallScore,
      passed: report.passed
    })
    
    return report
  }
  
  /**
   * Check brand consistency using LLM evaluation
   * Uses Claude to intelligently assess if content matches brand voice
   */
  private async checkBrandConsistency(
    pages: GeneratedPage[],
    brandContext: BrandContext
  ): Promise<QualityCheck> {
    
    const issues: string[] = []
    const suggestions: string[] = []
    let totalScore = 0
    let sectionCount = 0
    
    // Evaluate each section with Claude
    for (const page of pages) {
      for (const section of page.sections) {
        const contentText = JSON.stringify(section.content)
        
        // LLM-based brand voice evaluation
        const evaluation = await this.evaluateBrandMatch(section, brandContext, page.slug)
        totalScore += evaluation.score
        sectionCount++
        
        if (evaluation.score < 75) {
          issues.push(`${page.slug}/${section.id}: ${evaluation.issue} (${evaluation.score}% match)`)
          suggestions.push(evaluation.suggestion)
        }
        
        // Fast check for forbidden words (no LLM needed)
        const forbiddenUsed = brandContext.contentStrategy.vocabularyAvoid.filter(word =>
          contentText.toLowerCase().includes(word.toLowerCase())
        )
        
        if (forbiddenUsed.length > 0) {
          issues.push(`${page.slug}/${section.id}: Uses forbidden words: ${forbiddenUsed.join(', ')}`)
          suggestions.push(`Remove: ${forbiddenUsed.join(', ')}`)
        }
      }
    }
    
    const avgScore = sectionCount > 0 ? totalScore / sectionCount : 0
    
    return {
      score: avgScore,
      passed: avgScore >= 75,
      issues,
      suggestions
    }
  }
  
  /**
   * Evaluate if a section's content matches the brand voice using Claude
   */
  private async evaluateBrandMatch(
    section: GeneratedSection,
    brandContext: BrandContext,
    pageSlug: string
  ): Promise<{ score: number; issue: string; suggestion: string }> {
    
    const systemPrompt = `You are a brand consistency evaluator. Rate how well content matches a brand voice on a scale of 0-100.
Be fair but critical. Score 75+ means good match. Score below 75 needs improvement.
Return ONLY valid JSON, no other text.`
    
    const prompt = `Evaluate if this website content matches the brand voice guidelines.

BRAND VOICE GUIDELINES:
- Voice/Tone: ${brandContext.contentStrategy.voiceTone}
- Brand Personality: ${brandContext.brandPersonality.primary} (${brandContext.brandPersonality.traits.join(', ')})
- Preferred vocabulary: ${brandContext.contentStrategy.vocabularyUse.join(', ')}
- Words to avoid: ${brandContext.contentStrategy.vocabularyAvoid.join(', ')}
- Headline style: ${brandContext.contentStrategy.headlineStyle}
- Storytelling focus: ${brandContext.contentStrategy.storytellingFocus}
- Target audience: ${brandContext.targetAudience.demographics}

SECTION TYPE: ${section.type}
PAGE: ${pageSlug}

CONTENT TO EVALUATE:
${JSON.stringify(section.content, null, 2)}

Rate 0-100 how well this content matches the brand voice.
Consider: tone consistency, vocabulary usage, headline style, audience appropriateness.

Return JSON only:
{"score": <0-100>, "issue": "<brief issue if score<75, empty string if good>", "suggestion": "<how to improve if score<75, empty string if good>"}`
    
    try {
      const response = await this.callClaude(prompt, {
        systemPrompt,
        temperature: 1.0,
        maxTokens: 500,
        jsonMode: true
      })
      
      const result = this.parseJSON<{ score: number; issue: string; suggestion: string }>(
        response, 
        'QualityAgent.evaluateBrandMatch'
      )
      
      // Ensure score is in valid range
      return {
        score: Math.max(0, Math.min(100, result.score || 0)),
        issue: result.issue || '',
        suggestion: result.suggestion || ''
      }
    } catch (error) {
      console.error(`❌ [QualityAgent] Failed to evaluate brand match for ${pageSlug}/${section.id}:`, error)
      // Return neutral score on error to avoid blocking
      return {
        score: 75,
        issue: 'Could not evaluate (LLM error)',
        suggestion: 'Manual review recommended'
      }
    }
  }
  
  /**
   * Check content quality
   */
  private async checkContentQuality(
    pages: GeneratedPage[],
    brandContext: BrandContext
  ): Promise<QualityCheck> {
    
    const issues: string[] = []
    const suggestions: string[] = []
    
    for (const page of pages) {
      for (const section of page.sections) {
        const content = section.content
        
        // Check for placeholder text
        const contentStr = JSON.stringify(content)
        if (contentStr.match(/lorem ipsum|placeholder|example|TODO|XXX/i)) {
          issues.push(`${page.slug}/${section.id}: Contains placeholder text`)
        }
        
        // Check headline exists and is substantial
        if (content.headline && typeof content.headline === 'string') {
          if (content.headline.length < 10) {
            issues.push(`${page.slug}/${section.id}: Headline too short (${content.headline.length} chars)`)
          }
          if (content.headline.length > 100) {
            issues.push(`${page.slug}/${section.id}: Headline too long (${content.headline.length} chars)`)
          }
        }
        
        // Check for CTA if section needs it
        if (['hero', 'cta', 'form'].includes(section.type)) {
          if (!content.cta_text) {
            issues.push(`${page.slug}/${section.id}: Missing CTA`)
            suggestions.push('Add call-to-action button')
          }
        }
      }
    }
    
    const score = Math.max(0, 100 - (issues.length * 5))
    
    return {
      score,
      passed: score >= 80,
      issues,
      suggestions
    }
  }
  
  /**
   * Check photo quality
   */
  private async checkPhotoQuality(
    photoManifest: PhotoManifest,
    brandContext: BrandContext
  ): Promise<QualityCheck> {
    
    const issues: string[] = []
    const suggestions: string[] = []
    
    // Check hero photos
    if (photoManifest.byCategory.hero.length === 0) {
      issues.push('No hero photos available')
      suggestions.push('Generate hero lifestyle photo')
    } else {
      const heroQuality = photoManifest.byCategory.hero[0].quality
      if (heroQuality < 7) {
        issues.push(`Hero photo quality too low (${heroQuality}/10)`)
        suggestions.push('Generate higher quality hero photo')
      }
    }
    
    // Check lifestyle ratio for a healthy balance of people-driven imagery.
    const totalPhotos = photoManifest.photos.length
    const lifestylePhotos = photoManifest.byCategory.lifestyle.length
    const lifestyleRatio = totalPhotos > 0 ? lifestylePhotos / totalPhotos : 0
    
    if (lifestyleRatio < 0.4) {
      issues.push(`Low lifestyle ratio (${(lifestyleRatio * 100).toFixed(0)}% - target 40%+)`)
      suggestions.push('Generate more lifestyle photos showing people enjoying amenities')
    }
    
    // Check overall quality
    const avgQuality = photoManifest.photos.reduce((sum, p) => sum + p.quality, 0) / photoManifest.photos.length || 0
    
    const score = Math.min(100, avgQuality * 10 + lifestyleRatio * 20)
    
    return {
      score,
      passed: score >= 75,
      issues,
      suggestions
    }
  }
  
  /**
   * Check design coherence
   */
  private async checkDesignCoherence(
    designSystem: DesignSystem,
    brandContext: BrandContext
  ): Promise<QualityCheck> {
    
    const issues: string[] = []
    const suggestions: string[] = []
    
    // Check spacing matches positioning
    const isLuxury = brandContext.positioning.category.toLowerCase().includes('luxury')
    if (isLuxury && designSystem.spacing.scale !== 'luxury') {
      issues.push('Luxury brand should use luxury spacing')
      suggestions.push('Change spacing.scale to "luxury"')
    }
    
    // Check animations match brand energy
    const isEnergetic = brandContext.brandPersonality.traits.some(t => 
      ['vibrant', 'energetic', 'dynamic', 'urban'].includes(t.toLowerCase())
    )
    if (isEnergetic && designSystem.animations.level === 'none') {
      suggestions.push('Consider subtle animations for energetic brand')
    }
    
    const score = 100 - (issues.length * 10)
    
    return {
      score: Math.max(0, score),
      passed: score >= 80,
      issues,
      suggestions
    }
  }
  
  /**
   * Check WordPress compatibility
   */
  private async checkWordPressCompatibility(
    pages: GeneratedPage[],
    wpCapabilities: WordPressCapabilities
  ): Promise<QualityCheck> {
    
    const issues: string[] = []
    const suggestions: string[] = []
    
    // Check all blocks are available
    for (const page of pages) {
      for (const section of page.sections) {
        if (!wpCapabilities.availableBlocks.includes(section.acfBlock)) {
          issues.push(`${page.slug}/${section.id}: Block not available: ${section.acfBlock}`)
          suggestions.push(`Use alternative block or install required plugin`)
        }
      }
    }
    
    const score = issues.length === 0 ? 100 : Math.max(0, 100 - (issues.length * 20))
    
    return {
      score,
      passed: issues.length === 0,
      issues,
      suggestions
    }
  }
  
  /**
   * Generate improvement suggestions
   */
  private generateImprovements(checks: Record<string, QualityCheck>): string[] {
    const improvements: string[] = []
    
    for (const [checkName, check] of Object.entries(checks)) {
      if (!check.passed) {
        improvements.push(`${checkName}: ${check.suggestions.join('; ')}`)
      }
    }
    
    return improvements
  }
  
  /**
   * Helper: Calculate cosine similarity between embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    
    let dotProduct = 0
    let normA = 0
    let normB = 0
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }
}










