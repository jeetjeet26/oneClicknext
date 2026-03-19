// SiteForge Design Agent
// Creates design system based on brand context + WordPress theme capabilities
// Uses Claude Sonnet 4 with theme design tokens
// Created: December 16, 2025

import { BaseAgent } from './base-agent'
import { WordPressMcpClient, type ThemeDesignTokens } from '@/utils/mcp/wordpress-client'
import type { BrandContext } from './brand-agent'

export interface DesignSystem {
  colorSystem: {
    primary: string
    secondary: string
    accent: string
    background: string
    strategy: 'use-theme' | 'custom' | 'hybrid' | 'brandforge'
    reasoning: string
    // Full palette from BrandForge if available
    brandForgePalette?: {
      primary: Array<{ name: string; hex: string; usage?: string }>
      secondary: Array<{ name: string; hex: string; usage?: string }>
    }
  }
  
  typography: {
    headingFont: string
    headingWeight: number
    bodyFont: string
    scale: 'compact' | 'balanced' | 'luxury'
    strategy: 'use-theme' | 'custom' | 'brandforge'
    reasoning: string
  }
  
  spacing: {
    scale: 'tight' | 'balanced' | 'luxury'
    containerMaxWidth: string
    sectionPadding: string
    reasoning: string
  }
  
  componentStyles: {
    hero: ComponentStyle
    amenityShowcase: ComponentStyle
    ctaSections: ComponentStyle
  }
  
  animations: {
    level: 'none' | 'subtle' | 'prominent'
    types: string[]
    reasoning: string
  }
  
  customCSS?: {
    needed: boolean
    css: string
    reasoning: string
  }
}

interface ComponentStyle {
  layout: string
  variant: string
  treatment: string
  reasoning: string
}

/**
 * Design Agent - Creates design system from brand context
 * Aligns with WordPress theme capabilities when possible
 */
export class DesignAgent extends BaseAgent {
  private wpMcp: WordPressMcpClient
  
  constructor(propertyId: string) {
    super(propertyId)
    this.wpMcp = new WordPressMcpClient()
  }
  
  /**
   * Create design system
   */
  async createSystem(
    brandContext: BrandContext,
    instanceId?: string
  ): Promise<DesignSystem> {
    
    await this.logAction('design_system_start', { propertyId: this.propertyId })
    
    // 1. Get WordPress theme design tokens
    const wpCapabilities = await this.wpMcp.getCapabilities(instanceId || 'template-collection-theme')
    const themeTokens = wpCapabilities.designTokens
    
    // 2. Get design insights from vector search
    const designInsights = await this.getDesignInsights()
    
    // 3. Check if we have BrandForge structured values (use directly, don't synthesize)
    const hasBrandForgeColors = brandContext.colorPalette && 
      (brandContext.colorPalette.primary.length > 0 || brandContext.colorPalette.secondary.length > 0)
    const hasBrandForgeTypography = brandContext.typography?.primaryFont
    
    if (hasBrandForgeColors) {
      console.log('🎨 Design Agent: Using exact BrandForge color palette')
    }
    if (hasBrandForgeTypography) {
      console.log('🔤 Design Agent: Using exact BrandForge typography')
    }
    
    // 4. Claude creates design system (with BrandForge context if available)
    const designSystem = await this.synthesizeDesignSystem({
      brandContext,
      themeTokens,
      designInsights
    })
    
    // 5. OVERRIDE with BrandForge structured values (exact hex codes)
    if (hasBrandForgeColors && brandContext.colorPalette) {
      const primaryColor = brandContext.colorPalette.primary[0]
      const secondaryColor = brandContext.colorPalette.secondary[0] || brandContext.colorPalette.primary[1]
      const accentColor = brandContext.colorPalette.primary[1] || brandContext.colorPalette.secondary[0]
      
      designSystem.colorSystem = {
        primary: primaryColor?.hex || designSystem.colorSystem.primary,
        secondary: secondaryColor?.hex || designSystem.colorSystem.secondary,
        accent: accentColor?.hex || designSystem.colorSystem.accent,
        background: designSystem.colorSystem.background,
        strategy: 'brandforge',
        reasoning: `Using exact colors from BrandForge brand book: ${primaryColor?.name} (${primaryColor?.hex}), ${secondaryColor?.name} (${secondaryColor?.hex})`,
        brandForgePalette: brandContext.colorPalette
      }
      
      console.log('✅ Applied BrandForge colors:', designSystem.colorSystem)
    }
    
    // 6. OVERRIDE with BrandForge typography
    if (hasBrandForgeTypography && brandContext.typography) {
      designSystem.typography = {
        ...designSystem.typography,
        headingFont: brandContext.typography.primaryFont,
        bodyFont: brandContext.typography.secondaryFont,
        strategy: 'brandforge',
        reasoning: `Using exact fonts from BrandForge brand book: ${brandContext.typography.primaryFont} for headings, ${brandContext.typography.secondaryFont} for body`
      }
      
      console.log('✅ Applied BrandForge typography:', designSystem.typography)
    }
    
    await this.logAction('design_system_complete', {
      strategy: designSystem.colorSystem.strategy,
      customCSSNeeded: designSystem.customCSS?.needed || false,
      usedBrandForgeColors: hasBrandForgeColors,
      usedBrandForgeTypography: hasBrandForgeTypography
    })
    
    return designSystem
  }
  
  /**
   * Get design insights from vector search
   */
  private async getDesignInsights() {
    
    const [
      visualPreferences,
      designGuidelines,
      spacingPreferences,
      colorPreferences
    ] = await Promise.all([
      this.vectorSearch("Visual design preferences, style guidelines, aesthetic direction"),
      this.vectorSearch("Design guidelines, brand design rules, visual identity standards"),
      this.vectorSearch("Spacing preferences, luxury positioning, whitespace usage, content density"),
      this.vectorSearch("Color palette, color usage, color psychology, brand colors")
    ])
    
    return {
      visualPreferences,
      designGuidelines,
      spacingPreferences,
      colorPreferences
    }
  }
  
  /**
   * Synthesize design system using Claude
   */
  private async synthesizeDesignSystem(data: {
    brandContext: BrandContext
    themeTokens: ThemeDesignTokens
    designInsights: any
  }): Promise<DesignSystem> {
    
    const systemPrompt = `You are a design system architect specializing in real estate web design. You create design systems that:
1. Express brand personality visually
2. Work within WordPress theme constraints
3. Meet a polished multifamily marketing quality bar

Prefer theme defaults when they work. Use custom CSS only when brand requires unique expression.`
    
    const prompt = `
Create a design system for this property's website.

# BRAND CONTEXT:
${JSON.stringify(data.brandContext, null, 2)}

# DESIGN INSIGHTS (Vector search):

Visual Preferences:
${data.designInsights.visualPreferences.map((d: any) => `- ${d.content}`).join('\n')}

Design Guidelines:
${data.designInsights.designGuidelines.map((d: any) => `- ${d.content}`).join('\n')}

Spacing Preferences:
${data.designInsights.spacingPreferences.map((d: any) => `- ${d.content}`).join('\n')}

Color Preferences:
${data.designInsights.colorPreferences.map((d: any) => `- ${d.content}`).join('\n')}

# WORDPRESS THEME CAPABILITIES:

Available Colors: ${data.themeTokens.colors.availableVariants.join(', ')}
Theme Primary: ${data.themeTokens.colors.primary}
Theme Secondary: ${data.themeTokens.colors.secondary}

Available Fonts: ${data.themeTokens.typography.availableFonts.join(', ')}
Heading Scales: ${data.themeTokens.typography.headingScales.join(', ')}

Spacing Scales: ${data.themeTokens.spacing.availableScales.join(', ')}
Spacing Presets: ${JSON.stringify(data.themeTokens.spacing.presets)}

# YOUR TASK:

Create a design system that expresses brand personality using theme capabilities.

# OUTPUT (JSON):

{
  "colorSystem": {
    "primary": "Use theme color if matches brand, otherwise custom hex",
    "secondary": "...",
    "accent": "...",
    "background": "#FFFFFF or custom",
    "strategy": "use-theme|custom|hybrid",
    "reasoning": "Why these color choices express brand personality"
  },
  
  "typography": {
    "headingFont": "Choose from availableFonts or specify custom",
    "headingWeight": 300-700,
    "bodyFont": "...",
    "scale": "From headingScales based on brand (luxury=luxury, modern=balanced)",
    "strategy": "use-theme|custom",
    "reasoning": "How typography expresses brand voice"
  },
  
  "spacing": {
    "scale": "From spacingScales - luxury brands use 'luxury'",
    "containerMaxWidth": "From presets",
    "sectionPadding": "From presets",
    "reasoning": "How spacing conveys market positioning"
  },
  
  "componentStyles": {
    "hero": {
      "layout": "fullwidth|split|centered",
      "variant": "Based on brand energy and personality",
      "treatment": "overlay|minimal|split",
      "reasoning": "Hero approach that matches brand"
    },
    "amenityShowcase": {
      "layout": "grid|masonry|carousel",
      "variant": "elevated-cards|minimal|bordered",
      "treatment": "photo-heavy|icon-based|mixed",
      "reasoning": "Amenity presentation matching sophistication"
    },
    "ctaSections": {
      "layout": "inline|sticky|floating",
      "variant": "prominent|balanced|subtle",
      "treatment": "button|form|banner",
      "reasoning": "CTA prominence based on audience urgency"
    }
  },
  
  "animations": {
    "level": "none|subtle|prominent - based on brand energy",
    "types": ["fadeIn", "slideUp", "parallax"] if level > none,
    "reasoning": "Animation approach matching brand personality"
  },
  
  "customCSS": {
    "needed": true if theme can't express brand,
    "css": "/* Custom CSS for brand-specific styling */",
    "reasoning": "Why custom CSS needed beyond theme"
  }
}

# CRITICAL RULES:

1. If theme colors match brand mood, use theme defaults (easier maintenance)
2. If brand requires luxury spacing, select 'luxury' from spacingScales
3. Component variants must match brand personality (luxury→fullwidth, family→split)
4. Favor strong hierarchy, thoughtful spacing, and clear CTA prominence when the brand context supports it
5. Custom CSS only when theme limitations prevent brand expression
6. Every choice must be justified by brand context or design insights

# EXAMPLE (for sophisticated-relaxed resort brand):

colorSystem.strategy: "hybrid" - use theme primary, customize secondary for warmth
typography.scale: "luxury" - matches resort positioning
spacing.scale: "luxury" - conveys high-end market position
componentStyles.hero.variant: "fullwidth" - impact and sophistication
animations.level: "subtle" - sophisticated, not flashy
`
    
    const response = await this.callClaude(prompt, {
      systemPrompt,
      temperature: 1.0,
      maxTokens: 30000,
      jsonMode: true
    })
    
    // Use shared robust JSON parser
    return this.parseJSON<DesignSystem>(response, 'DesignAgent')
  }
}










