// SiteForge Photo Agent
// Plans and executes photo strategy based on brand context
// Categorizes uploaded photos, generates missing photos using Google Imagen 3
// Uses Claude Sonnet 4 for photo analysis + Vertex AI Imagen for generation
// Created: December 16, 2025

import { BaseAgent, type VectorSearchResult } from './base-agent'
import { SITEFORGE_CLAUDE_MODEL } from '@/utils/siteforge/models'
import type { BrandContext } from './brand-agent'
import type { ArchitectureProposal } from './architecture-agent'
import type { GeneratedPage } from '@/types/siteforge'
import { createSiteForgePlaceholderPhotos } from './photo-placeholders'
import { 
  isImagenAvailable, 
  generateAndUploadImage, 
  buildLifestylePhotoPrompt 
} from '../imagen-client'

export interface PhotoStrategy {
  uploadedPhotoUsage: Array<{
    photoId: string
    url: string
    category:
      | 'hero'
      | 'amenity'
      | 'lifestyle'
      | 'gallery'
      | 'exterior'
      | 'interior'
      | 'neighborhood'
    quality: number
    useFor: string
    altText?: string
    brandAlignment: number
    reasoning: string
  }>
  
  photosToGenerate: Array<{
    category: 'hero' | 'amenity' | 'lifestyle' | 'gallery'
    scene: string
    prompt: string
    priority: 'high' | 'medium' | 'low'
    reasoning: string
  }>
  
  photoGuidelines: {
    lighting: string
    composition: string
    subjects: string
    mood: string
  }
}

export interface PhotoManifest {
  photos: Photo[]
  byCategory: {
    hero: Photo[]
    amenities: Photo[]
    lifestyle: Photo[]
    gallery: Photo[]
    logos: Photo[]
  }
  assignments: Record<string, string> // sectionId -> photoId
  stats: {
    uploaded: number
    generated: number
    fromBrandForge: number
    total: number
  }
  // Logo assets from BrandForge (if available)
  logoAssets?: {
    primaryUrl?: string
    primaryAssetId?: string
    variations?: string[]
    variantAssetIds?: string[]
  }
}

export interface Photo {
  id: string
  assetId?: string
  contentHash?: string
  altText?: string
  url: string
  type: 'uploaded' | 'generated' | 'brandforge'
  category: string
  quality: number
  scene?: string
  prompt?: string
  sourceAssetId?: string
  rightsStatus?: 'unknown' | 'owned' | 'licensed' | 'generated' | 'restricted'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
}

type UploadedPropertyPhoto = {
  id: string
  url: string
  filename: string
  operatorCategory?: PhotoStrategy['uploadedPhotoUsage'][number]['category']
  altText?: string
}

type UploadedPhotoCategory =
  PhotoStrategy['uploadedPhotoUsage'][number]['category']

type AnalyzedPhoto = {
  photoId: string
  url: string
  category: string
  quality: number
  brand_alignment: number
  mood: string
  scene: string
  has_people: boolean
  operatorCategory?: UploadedPhotoCategory
  operatorAltText?: string
}

type PhotoNeed = NonNullable<
  ArchitectureProposal['pages'][number]['sections'][number]['photoRequirement']
> & { sectionId: string }

type PhotoInsights = {
  amenityFocus: VectorSearchResult[]
  lifestyleMoments: VectorSearchResult[]
  visualDiff: VectorSearchResult[]
}

type PhotoStrategyInput = {
  brandContext: BrandContext
  analyzedPhotos: AnalyzedPhoto[]
  photoInsights: PhotoInsights
  photoNeeds: PhotoNeed[]
}

/**
 * Photo Agent - Handles all photography decisions
 * Categorizes uploaded photos, generates missing photos using Claude analysis
 */
export class PhotoAgent extends BaseAgent {
  
  /**
   * Plan photo strategy
   */
  async planStrategy(
    brandContext: BrandContext,
    architecture: ArchitectureProposal
  ): Promise<PhotoStrategy> {

    await this.logAction('photo_strategy_start', { propertyId: this.propertyId })
    
    // 1. Get uploaded photos
    const uploadedPhotos = await this.getUploadedPhotos()
    
    // 2. Analyze uploaded photos with Claude vision
    const analyzedPhotos = await this.analyzePhotos(uploadedPhotos, brandContext)
    
    // 3. Get photo insights from vector search
    const photoInsights = await this.getPhotoInsights()
    
    // 4. Determine what photos are needed based on architecture
    const photoNeeds = this.extractPhotoNeeds(architecture)
    
    // 5. Claude creates strategy
    const strategy = await this.createStrategy({
      brandContext,
      analyzedPhotos,
      photoInsights,
      photoNeeds
    })
    const operatorCategorized = analyzedPhotos
      .filter(
        (photo): photo is AnalyzedPhoto & { operatorCategory: UploadedPhotoCategory } =>
          photo.operatorCategory !== undefined
      )
      .map(photo => ({
        photoId: photo.photoId,
        url: photo.url,
        category: photo.operatorCategory,
        quality: Math.max(Number(photo.quality) || 0, 8),
        brandAlignment: Math.max(Number(photo.brand_alignment) || 0, 8),
        useFor: `Operator-selected ${photo.operatorCategory} photography`,
        altText: photo.operatorAltText,
        reasoning: 'The operator explicitly categorized and approved this photo.',
      }))
    const operatorPhotoIds = new Set(
      operatorCategorized.map(photo => photo.photoId)
    )
    strategy.uploadedPhotoUsage = [
      ...operatorCategorized,
      ...strategy.uploadedPhotoUsage.filter(
        photo => !operatorPhotoIds.has(photo.photoId)
      ),
    ]
    
    await this.logAction('photo_strategy_complete', {
      uploadedCount: strategy.uploadedPhotoUsage.length,
      toGenerateCount: strategy.photosToGenerate.length
    })
    
    return strategy
  }
  
  /**
   * Execute photo strategy - generate missing photos
   * Pulls logos from BrandForge and uses Imagen for photo generation
   */
  async execute(
    strategy: PhotoStrategy,
    pages: GeneratedPage[],
    brandContext?: BrandContext
  ): Promise<PhotoManifest> {
    
    await this.logAction('photo_execution_start', {
      toGenerate: strategy.photosToGenerate.length,
      hasImagenAvailable: isImagenAvailable(),
      hasBrandForgeLogo: !!brandContext?.logoAssets?.primaryUrl
    })
    
    const hasApprovedUploads = strategy.uploadedPhotoUsage.length > 0
    const canGenerateMissingPhotos = hasApprovedUploads && isImagenAvailable()

    // Never invent property imagery when no approved source photos exist. Use
    // explicit, replaceable placeholders so the site can still be generated.
    // A partial manual upload also keeps placeholders for uncovered categories
    // when Imagen is unavailable instead of failing the whole website.
    const generatedPhotos: Photo[] =
      !hasApprovedUploads ||
      (!isImagenAvailable() && strategy.photosToGenerate.length > 0)
        ? createSiteForgePlaceholderPhotos(strategy)
        : []

    if (canGenerateMissingPhotos) {
      for (const spec of strategy.photosToGenerate) {
        const photo = await this.generatePhoto(spec, brandContext)
        generatedPhotos.push(photo)

        // Add delay between generations to avoid rate limiting
        if (isImagenAvailable() && strategy.photosToGenerate.indexOf(spec) < strategy.photosToGenerate.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    }

    // Combine with uploaded
    const allPhotos: Photo[] = [
      ...strategy.uploadedPhotoUsage.map(u => ({
        id: u.photoId,
        sourceAssetId: u.photoId,
        url: u.url,
        type: 'uploaded' as const,
        category: u.category,
        quality: u.quality,
        altText: u.altText,
      })),
      ...generatedPhotos
    ]
    
    // Add BrandForge logos if available
    const logoPhotos: Photo[] = []
    let logoAssets: PhotoManifest['logoAssets'] = undefined
    
    if (brandContext?.logoAssets?.primaryUrl) {
      console.log('🖼️ Adding BrandForge logos to photo manifest')
      
      logoAssets = {
        primaryUrl: brandContext.logoAssets.primaryUrl,
        primaryAssetId: brandContext.logoAssets.primaryAssetId,
        variations: brandContext.logoAssets.variations || [],
        variantAssetIds: brandContext.logoAssets.variantAssetIds || [],
      }
      
      // Add primary logo
      logoPhotos.push({
        id: brandContext.logoAssets.primaryAssetId || `logo-primary-${Date.now()}`,
        sourceAssetId: brandContext.logoAssets.primaryAssetId,
        url: brandContext.logoAssets.primaryUrl,
        type: 'brandforge',
        category: 'logo',
        quality: 10
      })
      
      // Add logo variations
      for (const [index, variationUrl] of (brandContext.logoAssets.variations || []).entries()) {
        const sourceAssetId = brandContext.logoAssets.variantAssetIds?.[index]
        logoPhotos.push({
          id: sourceAssetId || `logo-variation-${Date.now()}-${index}`,
          sourceAssetId,
          url: variationUrl,
          type: 'brandforge',
          category: 'logo',
          quality: 10
        })
      }
      
      allPhotos.push(...logoPhotos)
    }
    
    // Organize by category
    const byCategory = {
      hero: allPhotos.filter(p => p.category === 'hero'),
      amenities: allPhotos.filter(p => p.category === 'amenity'),
      lifestyle: allPhotos.filter(p => p.category === 'lifestyle'),
      gallery: allPhotos.filter(p => p.category === 'gallery'),
      logos: logoPhotos
    }
    
    // Assign photos to sections
    const assignments = await this.assignPhotosToSections(allPhotos, pages)
    
    await this.logAction('photo_execution_complete', {
      totalPhotos: allPhotos.length,
      generated: generatedPhotos.length,
      fromBrandForge: logoPhotos.length
    })
    
    return {
      photos: allPhotos,
      byCategory,
      assignments,
      stats: {
        uploaded: strategy.uploadedPhotoUsage.length,
        generated: generatedPhotos.length,
        fromBrandForge: logoPhotos.length,
        total: allPhotos.length
      },
      logoAssets
    }
  }
  
  /**
   * Get approved, rights-cleared property assets. The content asset library is
   * authoritative; legacy document images are intentionally not promoted.
   */
  private async getUploadedPhotos(): Promise<UploadedPropertyPhoto[]> {
    const { data } = await this.supabase
      .from('content_assets')
      .select('id, file_url, name, asset_role, alt_text')
      .eq('property_id', this.propertyId)
      .eq('approval_status', 'approved')
      .in('rights_status', ['owned', 'licensed', 'generated'])
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .in('asset_role', [
        'hero',
        'amenity',
        'gallery',
        'interior',
        'exterior',
        'lifestyle',
        'neighborhood',
      ])
    
    return (data || [])
      .filter((asset) => Boolean(asset.file_url))
      .map(d => ({
        id: d.id,
        url: d.file_url,
        filename: d.name,
        operatorCategory: d.asset_role as UploadedPropertyPhoto['operatorCategory'],
        altText: d.alt_text || undefined,
      }))
  }
  
  /**
   * Analyze photos using Claude vision
   */
  private async analyzePhotos(
    photos: UploadedPropertyPhoto[],
    brandContext: BrandContext
  ): Promise<AnalyzedPhoto[]> {
    
    // Analyze each photo in parallel (limit concurrency)
    const batchSize = 5
    const analyzed: AnalyzedPhoto[] = []
    
    for (let i = 0; i < photos.length; i += batchSize) {
      const batch = photos.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(photo => this.analyzePhoto(photo, brandContext))
      )
      analyzed.push(...batchResults)
    }
    
    return analyzed
  }
  
  /**
   * Analyze single photo with Claude vision
   */
  private async analyzePhoto(
    photo: UploadedPropertyPhoto,
    brandContext: BrandContext
  ): Promise<AnalyzedPhoto> {
    
    try {
      const message = await this.anthropic.messages.create({
        model: SITEFORGE_CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this property photo (URL: ${photo.url}).

Brand Context: ${JSON.stringify(brandContext.visualIdentity.photoStyle)}

Categorize as:
- hero (wide, impressive, could be main image)
- amenity (specific amenity feature)
- lifestyle (people enjoying amenities)
- exterior (building, landscaping)
- interior (unit interiors)
- gallery (other quality photos)

Also rate:
- quality (1-10)
- brand_alignment (1-10, how well it matches brand photo style)
- mood (luxury, family-friendly, urban, etc.)
- scene (describe what's happening)
- has_people (true/false)

Output JSON only.`
              }
            ]
          }
        ]
      })
      
      const textContent = message.content.find(c => c.type === 'text')
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response')
      }
      
      // Use shared robust JSON parser
      const analysis = this.parseJSON<Partial<AnalyzedPhoto>>(
        textContent.text,
        'PhotoAgent.analyzePhoto'
      )
      
      return {
        photoId: photo.id,
        url: photo.url,
        quality: typeof analysis.quality === 'number' ? analysis.quality : 5,
        brand_alignment:
          typeof analysis.brand_alignment === 'number' ? analysis.brand_alignment : 5,
        mood: typeof analysis.mood === 'string' ? analysis.mood : 'unknown',
        scene: typeof analysis.scene === 'string' ? analysis.scene : 'unknown',
        has_people: analysis.has_people === true,
        operatorCategory: photo.operatorCategory,
        operatorAltText: photo.altText,
        category:
          photo.operatorCategory ||
          (typeof analysis.category === 'string' ? analysis.category : 'gallery'),
      }
    } catch (e) {
      console.error('Failed to analyze photo:', photo.id, e)
      return {
        photoId: photo.id,
        url: photo.url,
        category: photo.operatorCategory || 'gallery',
        operatorCategory: photo.operatorCategory,
        operatorAltText: photo.altText,
        quality: 5,
        brand_alignment: 5,
        mood: 'unknown',
        scene: 'unknown',
        has_people: false
      }
    }
  }
  
  /**
   * Get photo insights from vector search
   */
  private async getPhotoInsights(): Promise<PhotoInsights> {
    const [amenityFocus, lifestyleMoments, visualDiff] = await Promise.all([
      this.vectorSearch("What amenities should be photographed and showcased prominently?"),
      this.vectorSearch("What lifestyle activities and moments are important to residents?"),
      this.vectorSearch("What visual features make this property stand out?")
    ])
    
    return { amenityFocus, lifestyleMoments, visualDiff }
  }
  
  /**
   * Extract photo needs from architecture
   */
  private extractPhotoNeeds(architecture: ArchitectureProposal): PhotoNeed[] {
    const needs: PhotoNeed[] = []
    
    for (const page of architecture.pages) {
      for (const section of page.sections) {
        if (section.photoRequirement) {
          needs.push({
            sectionId: section.id,
            ...section.photoRequirement
          })
        }
      }
    }
    
    return needs
  }
  
  /**
   * Create photo strategy using Claude
   */
  private async createStrategy(data: PhotoStrategyInput): Promise<PhotoStrategy> {
    
    const systemPrompt = `You are a real estate photography director. You plan photo strategies that:
1. Use uploaded photos when they match brand quality
2. Generate missing photos following brand guidelines
3. Ensure lifestyle focus (people enjoying amenities)
4. Maintain a polished, authentic, lifestyle-forward real-estate photography standard`
    
    const prompt = `
Plan the photo strategy for this website.

# BRAND CONTEXT:
${JSON.stringify(data.brandContext.visualIdentity, null, 2)}

# ANALYZED UPLOADED PHOTOS:
${JSON.stringify(data.analyzedPhotos, null, 2)}

# PHOTO INSIGHTS (Vector search):
Amenity Focus: ${data.photoInsights.amenityFocus.map(d => d.content).join('\n')}
Lifestyle Moments: ${data.photoInsights.lifestyleMoments.map(d => d.content).join('\n')}
Visual Differentiators: ${data.photoInsights.visualDiff.map(d => d.content).join('\n')}

# PHOTO NEEDS (From architecture):
${JSON.stringify(data.photoNeeds, null, 2)}

# YOUR TASK:

1. Assign uploaded photos to categories (use if quality ≥7 and brand_alignment ≥7)
2. Identify gaps (needed photos that uploaded don't cover)
3. Create generation prompts that follow brand.photoStyle exactly

# OUTPUT (JSON):

{
  "uploadedPhotoUsage": [
    {
      "photoId": "uuid",
      "url": "url",
      "category": "hero|amenity|lifestyle|gallery",
      "quality": 8,
      "useFor": "hero section - rooftop pool at sunset",
      "brandAlignment": 9,
      "reasoning": "High quality, matches brand sophisticated-relaxed mood"
    }
  ],
  
  "photosToGenerate": [
    {
      "category": "lifestyle",
      "scene": "residents enjoying rooftop pool at golden hour",
      "prompt": "Professional lifestyle photography for luxury apartment community, diverse active adult residents (55+) naturally enjoying resort-style rooftop pool, candid authentic moments, warm golden hour lighting, sophisticated-relaxed atmosphere, magazine-quality real estate photography, 4K resolution, natural interactions, professional color grading",
      "priority": "high",
      "reasoning": "Hero needs lifestyle shot, no uploaded photos match quality/brand"
    }
  ],
  
  "photoGuidelines": {
    "lighting": "From brand.photoStyle.lighting",
    "composition": "From brand.photoStyle.composition",
    "subjects": "From brand.photoStyle.subjects",
    "mood": "From brand.photoStyle.mood"
  }
}

# CRITICAL RULES:

1. Use uploaded if quality ≥7 AND brand_alignment ≥7
2. Generate prompts MUST include: subject, mood, lighting, composition from brand.photoStyle
3. For lifestyle shots: specify demographics from targetAudience
4. For amenity shots: specify which amenity from amenityFocus insights
5. Priority: high for hero/above-fold, medium for amenities, low for gallery
6. Prefer authentic lifestyle coverage, warm lighting, and people where the brand/audience fit
`
    
    const response = await this.callClaude(prompt, {
      systemPrompt,
      maxTokens: 30000,
      jsonMode: true
    })
    
    // Use shared robust JSON parser
    return this.parseJSON<PhotoStrategy>(response, 'PhotoAgent')
  }
  
  /**
   * Generate photo using Google Imagen 3
   */
  private async generatePhoto(
    spec: PhotoStrategy['photosToGenerate'][number],
    brandContext?: BrandContext
  ): Promise<Photo> {
    
    await this.logAction('photo_generation', {
      category: spec.category,
      scene: spec.scene,
      imagenAvailable: isImagenAvailable()
    })
    
    if (!isImagenAvailable()) {
      throw new Error(`Imagen is not available for required photo generation: ${spec.scene || spec.category}`)
    }

    try {
      console.log(`🎨 Generating photo with Imagen: ${spec.scene}`)

      const prompt = spec.prompt || buildLifestylePhotoPrompt(spec.scene, {
        photoStyle: brandContext?.visualIdentity?.photoStyle,
        targetAudience: brandContext?.targetAudience
      })

      const aspectRatio = spec.category === 'hero' ? '16:9' :
        spec.category === 'gallery' ? '4:3' : '16:9'

      const url = await generateAndUploadImage(prompt, {
        aspectRatio,
        negativePrompt: 'text, words, letters, watermark, signature, low quality, blurry, artificial, stock photo look, cartoon, anime, illustration',
        filename: `siteforge-${spec.category}-${Date.now()}`,
        folder: `${this.propertyId}/siteforge`
      })

      if (!url) {
        throw new Error(`Imagen returned no uploaded asset for ${spec.scene || spec.category}`)
      }

      console.log(`✅ Generated photo: ${url}`)
      return {
        id: crypto.randomUUID(),
        url,
        type: 'generated',
        category: spec.category,
        quality: 9,
        scene: spec.scene,
        prompt
      }
    } catch (error) {
      console.error('❌ Imagen generation failed:', error)
      throw new Error(
        `Failed to generate required SiteForge photo "${spec.scene || spec.category}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }
  
  /**
   * Assign photos to sections
   */
  private async assignPhotosToSections(
    photos: Photo[],
    pages: GeneratedPage[]
  ): Promise<Record<string, string>> {
    
    const assignments: Record<string, string> = {}
    
    // For each section that needs photos
    for (const page of pages) {
      for (const section of page.sections || []) {
        const photoRequirement =
          section.photoRequirement &&
          typeof section.photoRequirement === 'object' &&
          'category' in section.photoRequirement &&
          typeof section.photoRequirement.category === 'string'
            ? section.photoRequirement
            : null
        if (photoRequirement) {
          // Find best matching photo
          const matches = photos.filter(p => 
            p.category === photoRequirement.category
          )
          
          if (matches.length > 0) {
            // Pick highest quality
            const best = matches.sort((a, b) => b.quality - a.quality)[0]
            if (section.id) {
              assignments[section.id] = best.id
            }
          }
        }
      }
    }
    
    return assignments
  }
}











