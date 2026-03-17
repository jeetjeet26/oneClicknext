// SiteForge Orchestrator
// Coordinates all agents to generate complete, intelligent websites
// Uses Claude Sonnet 4 via all agents
// Created: December 16, 2025

import { BrandAgent, type BrandContext } from './brand-agent'
import { ArchitectureAgent, type ArchitectureProposal } from './architecture-agent'
import { DesignAgent, type DesignSystem } from './design-agent'
import { PhotoAgent, type PhotoStrategy, type PhotoManifest } from './photo-agent'
import { ContentAgent, type GeneratedPage } from './content-agent'
import { QualityAgent, type QualityReport } from './quality-agent'
import { WordPressMcpClient } from '@/utils/mcp/wordpress-client'
import { createServiceClient } from '@/utils/supabase/admin'

export interface SiteBlueprint {
  version: number
  propertyId: string
  updatedAt: string
  
  // Agent outputs
  brandContext: BrandContext
  architecture: ArchitectureProposal
  designSystem: DesignSystem
  photoManifest: PhotoManifest
  pages: GeneratedPage[]
  
  // Metadata
  qualityReport: QualityReport
  generationTime: number
  agentLogs: Array<{ agent: string; action: string; timestamp: string }>
}

export interface GenerationProgress {
  status: 'queued' | 'analyzing_brand' | 'planning_architecture' | 'creating_design' | 
          'planning_photos' | 'generating_content' | 'executing_photos' | 
          'validating_quality' | 'ready_for_preview' | 'failed'
  progress: number
  currentStep: string
  details?: string
}

/**
 * SiteForge Orchestrator - Master coordinator of all agents
 * Manages agent collaboration and workflow
 */
export class SiteForgeOrchestrator {
  private supabase = createServiceClient()
  
  private agents: {
    brand: BrandAgent
    architecture: ArchitectureAgent
    design: DesignAgent
    photo: PhotoAgent
    content: ContentAgent
    quality: QualityAgent
  }
  
  private wpMcp: WordPressMcpClient
  private startTime: number = 0
  
  constructor(
    private propertyId: string,
    private websiteId: string,
    private wpInstanceId?: string
  ) {
    // Initialize all agents
    this.agents = {
      brand: new BrandAgent(propertyId),
      architecture: new ArchitectureAgent(propertyId, wpInstanceId),
      design: new DesignAgent(propertyId),
      photo: new PhotoAgent(propertyId),
      content: new ContentAgent(propertyId),
      quality: new QualityAgent(propertyId)
    }
    
    this.wpMcp = new WordPressMcpClient()
  }
  
  /**
   * Generate complete website blueprint
   * Agents work in optimal order with parallel execution where possible
   * 
   * @param userPreferences - User preferences from conversation
   * @param preAnalyzedBrandContext - Pre-analyzed brand context from /api/siteforge/analyze
   *                                   If provided, skips running Brand Agent again
   */
  async generate(
    userPreferences?: Record<string, unknown>,
    preAnalyzedBrandContext?: BrandContext
  ): Promise<SiteBlueprint> {
    
    this.startTime = Date.now()
    const agentLogs: Array<{ agent: string; action: string; timestamp: string }> = []
    
    try {
      // Phase 1: Brand Agent (foundation - must be first)
      // SKIP if we already have pre-analyzed brand context from the analyze endpoint
      await this.updateProgress('analyzing_brand', 10, 'Analyzing brand intelligence...')
      
      let brandContext: BrandContext
      
      // More robust check for valid pre-analyzed brand context
      // Must have brandPersonality.primary to be considered valid
      const hasValidPreAnalyzedContext = preAnalyzedBrandContext && 
        preAnalyzedBrandContext.source &&
        preAnalyzedBrandContext.brandPersonality?.primary
      
      if (hasValidPreAnalyzedContext) {
        // Use pre-analyzed brand context - don't re-run Brand Agent
        console.log('✅ Using pre-analyzed brand context:', {
          source: preAnalyzedBrandContext.source,
          confidence: preAnalyzedBrandContext.confidence,
          personality: preAnalyzedBrandContext.brandPersonality?.primary,
          hasColorPalette: !!preAnalyzedBrandContext.colorPalette,
          hasLogoAssets: !!preAnalyzedBrandContext.logoAssets
        })
        brandContext = preAnalyzedBrandContext
        agentLogs.push({ agent: 'brand', action: 'reused_preanalyzed', timestamp: new Date().toISOString() })
      } else {
        // No valid pre-analyzed context - run Brand Agent
        console.log('🔍 Running Brand Agent (pre-analyzed context missing or invalid)', {
          hasPreAnalyzed: !!preAnalyzedBrandContext,
          hasSource: !!preAnalyzedBrandContext?.source,
          hasPersonality: !!preAnalyzedBrandContext?.brandPersonality?.primary
        })
        brandContext = await this.agents.brand.analyze()
        agentLogs.push({ agent: 'brand', action: 'analyze', timestamp: new Date().toISOString() })
      }
      
      // Phase 2: Parallel planning (architecture + design can work simultaneously)
      await this.updateProgress('planning_architecture', 30, 'Planning site architecture...')
      
      const [architecture, designSystem] = await Promise.all([
        this.agents.architecture.plan(brandContext, userPreferences),
        this.agents.design.createSystem(brandContext, this.wpInstanceId)
      ])
      
      agentLogs.push(
        { agent: 'architecture', action: 'plan', timestamp: new Date().toISOString() },
        { agent: 'design', action: 'createSystem', timestamp: new Date().toISOString() }
      )
      
      // Phase 3: Photo strategy planning
      await this.updateProgress('planning_photos', 50, 'Planning photo strategy...')
      
      const photoStrategy = await this.agents.photo.planStrategy(brandContext, architecture)
      agentLogs.push({ agent: 'photo', action: 'planStrategy', timestamp: new Date().toISOString() })
      
      // Phase 4: Content generation (needs architecture)
      await this.updateProgress('generating_content', 60, 'Generating content...')
      
      const pagesWithContent = await this.agents.content.generateAll(architecture, brandContext)
      agentLogs.push({ agent: 'content', action: 'generateAll', timestamp: new Date().toISOString() })
      
      // Phase 5: Photo execution (pass brandContext for logo assets and Imagen prompts)
      await this.updateProgress('executing_photos', 75, 'Processing photos...')
      
      const photoManifest = await this.agents.photo.execute(photoStrategy, pagesWithContent, brandContext)
      agentLogs.push({ agent: 'photo', action: 'execute', timestamp: new Date().toISOString() })
      
      // Phase 6: Quality validation
      await this.updateProgress('validating_quality', 90, 'Validating quality...')
      
      const wpCapabilities = await this.wpMcp.getCapabilities(this.wpInstanceId || 'template-collection-theme')
      
      const qualityReport = await this.agents.quality.validate({
        pages: pagesWithContent,
        designSystem,
        photoManifest,
        brandContext,
        wpCapabilities
      })
      agentLogs.push({ agent: 'quality', action: 'validate', timestamp: new Date().toISOString() })
      
      // Phase 7: If quality too low, iterate
      if (!qualityReport.passed) {
        console.warn('Quality check failed, score:', qualityReport.score)
        console.warn('Issues:', qualityReport.checks)
        
        // Could implement auto-refinement here
        // For now, continue but mark for human review
      }
      
      // Complete!
      await this.updateProgress('ready_for_preview', 100, 'Generation complete!')
      
      const generationTime = Date.now() - this.startTime
      
      const blueprint: SiteBlueprint = {
        version: 1,
        propertyId: this.propertyId,
        updatedAt: new Date().toISOString(),
        brandContext,
        architecture,
        designSystem,
        photoManifest,
        pages: pagesWithContent,
        qualityReport,
        generationTime,
        agentLogs
      }
      
      // Save to database
      await this.saveBlueprint(blueprint)
      
      return blueprint
      
    } catch (error) {
      await this.updateProgress('failed', 0, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  }
  
  /**
   * Update generation progress in database
   */
  private async updateProgress(
    status: GenerationProgress['status'],
    progress: number,
    currentStep: string
  ): Promise<void> {
    
    await this.supabase
      .from('property_websites')
      .update({
        generation_status: status,
        generation_progress: progress,
        current_step: currentStep,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.websiteId)
  }
  
  /**
   * Save blueprint to database
   */
  private async saveBlueprint(blueprint: SiteBlueprint): Promise<void> {
    
    await this.supabase
      .from('property_websites')
      .update({
        blueprint: blueprint,
        site_architecture: blueprint.architecture,
        pages_generated: blueprint.pages,
        assets_manifest: blueprint.photoManifest,
        brand_source: blueprint.brandContext.source,
        brand_confidence: blueprint.brandContext.confidence,
        generation_completed_at: new Date().toISOString(),
        generation_duration_seconds: Math.floor(blueprint.generationTime / 1000)
      })
      .eq('id', this.websiteId)
  }
}










