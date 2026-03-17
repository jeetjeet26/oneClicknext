/**
 * MarketVision 360 - Brand Intelligence API
 * Extract and manage competitive brand insights from competitor websites
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

export interface BrandIntelligence {
  id: string
  competitorId: string
  competitorName?: string
  websiteUrl?: string
  
  // Brand Positioning
  brandVoice: string | null
  brandPersonality: string | null
  positioningStatement: string | null
  targetAudience: string | null
  uniqueSellingPoints: string[]
  
  // Offerings & Features
  highlightedAmenities: string[]
  serviceOfferings: string[]
  lifestyleFocus: string[]
  communityEvents: string[]
  
  // Promotions & Specials
  activeSpecials: string[]
  promotionalMessaging: string | null
  urgencyTactics: string[]
  
  // Website Analysis
  websiteTone: string | null
  keyMessagingThemes: string[]
  callToActionPatterns: string[]
  
  // Semantic Analysis
  sentimentScore: number | null
  confidenceScore: number | null
  
  // Metadata
  pagesAnalyzed: number
  lastAnalyzedAt: string | null
  analysisVersion: string | null
}

export interface BrandIntelligenceJob {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  totalCompetitors: number
  processedCount: number
  failedCount: number
  currentBatch: number
  totalBatches: number
  progressPercent: number
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

// GET: Fetch brand intelligence for a property's competitors
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const includeRaw = searchParams.get('includeRaw') === 'true'

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine to get brand intelligence
    const response = await fetch(
      `${DATA_ENGINE_URL}/scraper/brand-intelligence/property/${propertyId}?include_raw=${includeRaw}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Data engine error:', errorText)
      return NextResponse.json({ 
        error: 'Failed to fetch brand intelligence',
        details: errorText
      }, { status: 502 })
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      count: result.count || 0,
      competitors: (result.competitors || []).map(formatBrandIntelligence)
    })
  } catch (error) {
    console.error('Brand Intelligence GET Error:', error)
    
    // Check if data-engine is not running
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        error: 'Brand intelligence service unavailable',
        details: 'The data-engine service is not running'
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Trigger brand intelligence extraction
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, competitorIds, forceRefresh } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (propError || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Call data-engine to trigger extraction
    const response = await fetch(`${DATA_ENGINE_URL}/scraper/brand-intelligence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        competitor_ids: competitorIds || null,
        force_refresh: forceRefresh || false
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Data engine error:', errorText)
      return NextResponse.json({ 
        error: 'Failed to start brand intelligence extraction',
        details: errorText
      }, { status: 502 })
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      message: 'Brand intelligence extraction started',
      jobId: result.data?.job_id,
      status: 'processing'
    }, { status: 202 })
  } catch (error) {
    console.error('Brand Intelligence POST Error:', error)
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        error: 'Brand intelligence service unavailable',
        details: 'The data-engine service is not running'
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper to format brand intelligence from snake_case to camelCase
function formatBrandIntelligence(data: Record<string, unknown>): BrandIntelligence {
  return {
    id: data.id as string,
    competitorId: data.competitor_id as string,
    competitorName: data.competitor_name as string | undefined,
    websiteUrl: data.website_url as string | undefined,
    
    // Brand Positioning
    brandVoice: data.brand_voice as string | null,
    brandPersonality: data.brand_personality as string | null,
    positioningStatement: data.positioning_statement as string | null,
    targetAudience: data.target_audience as string | null,
    uniqueSellingPoints: (data.unique_selling_points as string[]) || [],
    
    // Offerings & Features
    highlightedAmenities: (data.highlighted_amenities as string[]) || [],
    serviceOfferings: (data.service_offerings as string[]) || [],
    lifestyleFocus: (data.lifestyle_focus as string[]) || [],
    communityEvents: (data.community_events as string[]) || [],
    
    // Promotions & Specials
    activeSpecials: (data.active_specials as string[]) || [],
    promotionalMessaging: data.promotional_messaging as string | null,
    urgencyTactics: (data.urgency_tactics as string[]) || [],
    
    // Website Analysis
    websiteTone: data.website_tone as string | null,
    keyMessagingThemes: (data.key_messaging_themes as string[]) || [],
    callToActionPatterns: (data.call_to_action_patterns as string[]) || [],
    
    // Semantic Analysis
    sentimentScore: data.sentiment_score as number | null,
    confidenceScore: data.confidence_score as number | null,
    
    // Metadata
    pagesAnalyzed: (data.pages_analyzed as number) || 0,
    lastAnalyzedAt: data.last_analyzed_at as string | null,
    analysisVersion: data.analysis_version as string | null
  }
}

