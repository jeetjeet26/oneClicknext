// SiteForge: Brand Intelligence Extraction
// Extracts brand data from BrandForge, Knowledge Base, or generates from scratch
// Created: December 11, 2025

import { createServiceClient } from '@/utils/supabase/admin'
import type { BrandIntelligence, PropertyContext, BrandSource } from '@/types/siteforge'

// Use service client since this runs in background context (no HTTP request)
const getSupabase = () => createServiceClient()

/**
 * Get brand intelligence with fallback priority:
 * 1. BrandForge (structured data)
 * 2. Knowledge Base (PDF/document analysis)
 * 3. Generated (from property data + competitors)
 */
export async function getBrandIntelligence(propertyId: string): Promise<BrandIntelligence> {
  // Try BrandForge first
  const brandForgeData = await extractFromBrandForge(propertyId)
  if (brandForgeData) {
    return brandForgeData
  }
  
  // Try Knowledge Base
  const kbData = await extractFromKnowledgeBase(propertyId)
  if (kbData) {
    return kbData
  }
  
  // Generate from scratch as last resort
  return await generateMinimalBrand(propertyId)
}

/**
 * Priority 1: Extract from BrandForge (highest confidence)
 */
async function extractFromBrandForge(propertyId: string): Promise<BrandIntelligence | null> {
  try {
    const supabase = getSupabase()
    
    const { data: brandforge, error } = await supabase
      .from('property_brand_assets')
      .select('*')
      .eq('property_id', propertyId)
      .single()
    
    if (error || !brandforge || brandforge.generation_status !== 'complete') {
      return null
    }
    
    // Extract structured brand data
    return {
      source: 'brandforge' as BrandSource,
      structured: true,
      confidence: 0.95,
      data: {
        brandName: brandforge.section_5_name_story?.name,
        tagline: brandforge.section_1_introduction?.tagline,
        positioning: brandforge.section_2_positioning?.statement,
        targetAudience: brandforge.section_3_target_audience?.primary,
        personas: brandforge.section_4_personas?.personas,
        colors: {
          primary: brandforge.section_8_colors?.primary || [],
          secondary: brandforge.section_8_colors?.secondary || [],
          palette: brandforge.section_8_colors?.palette
        },
        typography: {
          primaryFont: brandforge.section_7_typography?.primaryFont,
          secondaryFont: brandforge.section_7_typography?.secondaryFont
        },
        logo: brandforge.section_6_logo?.logoUrl ? {
          url: brandforge.section_6_logo.logoUrl,
          concept: brandforge.section_6_logo.concept,
          style: brandforge.section_6_logo.style
        } : undefined,
        photoStyle: brandforge.section_10_photo_yep,
        brandVoice: brandforge.conversation_summary?.brandPersonality,
        brandPersonality: brandforge.conversation_summary?.brandPersonality ? 
          [brandforge.conversation_summary.brandPersonality] : undefined,
        keyMessages: brandforge.section_1_introduction?.keyMessages,
        contentPillars: brandforge.section_1_introduction?.contentPillars
      }
    }
  } catch (error) {
    console.error('Error extracting from BrandForge:', error)
    return null
  }
}

/**
 * Priority 2: Extract from Knowledge Base documents (medium confidence)
 */
async function extractFromKnowledgeBase(propertyId: string): Promise<BrandIntelligence | null> {
  try {
    const supabase = getSupabase()
    
    // Find all brand-related documents
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, file_name, file_url, metadata, content')
      .eq('property_id', propertyId)
      .in('metadata->type', ['brand_guide', 'brochure', 'logo', 'marketing'])
    
    if (error || !docs || docs.length === 0) {
      return null
    }
    
    // Use semantic search to find brand-related content
    const brandContext = await semanticSearchBrand(propertyId)
    
    // Analyze PDFs with Gemini Vision (for documents with file URLs)
    const visualBrandData = await analyzeBrandDocuments(docs.filter(d => d.file_url))
    
    // Use Gemini 3 to synthesize all sources into structured brand data
    const synthesized = await synthesizeBrandData({
      documents: docs,
      semanticContext: brandContext,
      visualAnalysis: visualBrandData
    })
    
    return {
      source: 'knowledge_base' as BrandSource,
      structured: false,
      confidence: calculateConfidence(docs.length, brandContext?.length || 0),
      data: synthesized
    }
  } catch (error) {
    console.error('Error extracting from Knowledge Base:', error)
    return null
  }
}

/**
 * Use semantic search to find brand-related content in documents
 */
async function semanticSearchBrand(propertyId: string): Promise<string | null> {
  try {
    const supabase = getSupabase()
    
    // Search for brand-related content
    const brandQueries = [
      'brand personality and voice',
      'target audience and demographics',
      'brand colors and visual identity',
      'logo and typography',
      'brand positioning and value proposition'
    ]
    
    const results = []
    
    for (const query of brandQueries) {
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: await generateEmbedding(query),
        filter_property: propertyId,
        match_count: 3
      })
      
      if (!error && data) {
        results.push(...data.map((d: any) => d.content))
      }
    }
    
    return results.join('\n\n')
  } catch (error) {
    console.error('Error in semantic search:', error)
    return null
  }
}

/**
 * Analyze brand documents (PDFs, images) with Gemini Vision
 */
async function analyzeBrandDocuments(docs: any[]): Promise<any> {
  throw new Error(
    `Knowledge-base brand document analysis is not implemented yet. Cannot analyze ${docs.length} brand documents.`
  )
}

/**
 * Synthesize brand data from multiple sources using Gemini 3
 */
async function synthesizeBrandData(sources: any): Promise<any> {
  void sources
  throw new Error('Knowledge-base brand synthesis is not implemented yet.')
}

/**
 * Priority 3: Generate minimal brand from property data (low confidence)
 */
async function generateMinimalBrand(propertyId: string): Promise<BrandIntelligence> {
  void propertyId
  throw new Error(
    'Fallback SiteForge brand generation is not implemented. Complete BrandForge or provide knowledge-base brand context before generating a site.'
  )
}

/**
 * Calculate confidence score based on data availability
 */
function calculateConfidence(docCount: number, contextLength: number): number {
  const docScore = Math.min(docCount / 5, 1) * 0.5 // Up to 0.5 for having 5+ docs
  const contextScore = Math.min(contextLength / 1000, 1) * 0.3 // Up to 0.3 for 1000+ chars
  const baseScore = 0.2 // Base score for having any KB data
  
  return Math.min(docScore + contextScore + baseScore, 1.0)
}

/**
 * Generate embedding for semantic search
 * TODO: Implement with actual embedding service
 */
async function generateEmbedding(text: string): Promise<number[]> {
  void text
  throw new Error('Brand-intelligence semantic search embeddings are not implemented yet.')
}

/**
 * Get property context for site generation
 */
export async function getPropertyContext(propertyId: string): Promise<PropertyContext> {
  const supabase = getSupabase()
  
  const { data: property, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single()
  
  if (error || !property) {
    console.error('Property not found:', propertyId, error)
    throw new Error(`Property not found: ${propertyId}`)
  }
  
  // Get property photos separately (if table exists)
  const { data: photos } = await supabase
    .from('property_photos')
    .select('url, alt_text, category')
    .eq('property_id', propertyId)
    .limit(50)
  
  return {
    id: property.id,
    name: property.name,
    address: property.address || { 
      city: property.settings?.city || '', 
      state: '', 
      country: 'USA' 
    },
    amenities: property.amenities || [],
    floorplans: [], // TODO: Get from floorplans table if needed
    photos: (photos || []).map((p: any) => ({
      url: p.url,
      alt: p.alt_text || property.name,
      category: p.category
    })),
    policies: {
      pets: property.pet_policy,
      parking: property.parking_info
    },
    specialFeatures: property.special_features || [],
    unitCount: property.unit_count,
    yearBuilt: property.year_built
  }
}


















