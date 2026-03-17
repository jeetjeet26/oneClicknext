/**
 * MarketVision 360 - Single Competitor Brand Intelligence API
 * Get brand intelligence for a specific competitor
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

// GET: Get brand intelligence for a specific competitor
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ competitorId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { competitorId } = await params

    if (!competitorId) {
      return NextResponse.json({ error: 'competitorId required' }, { status: 400 })
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', competitorId)
      .single()

    if (!competitor || typeof competitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, competitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine to get competitor intelligence
    const response = await fetch(
      `${DATA_ENGINE_URL}/scraper/brand-intelligence/competitor/${competitorId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Data engine error:', errorText)
      return NextResponse.json({ 
        error: 'Failed to get competitor brand intelligence',
        details: errorText
      }, { status: 502 })
    }

    const result = await response.json()

    if (!result.success || !result.data) {
      return NextResponse.json({ 
        error: 'No brand intelligence found for this competitor'
      }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: formatBrandIntelligence(result.data)
    })
  } catch (error) {
    console.error('Competitor Brand Intelligence Error:', error)
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        error: 'Brand intelligence service unavailable',
        details: 'The data-engine service is not running'
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Clear brand intelligence for a competitor
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ competitorId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { competitorId } = await params

    if (!competitorId) {
      return NextResponse.json({ error: 'competitorId required' }, { status: 400 })
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('property_id')
      .eq('id', competitorId)
      .single()

    if (!competitor || typeof competitor.property_id !== 'string') {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, competitor.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete brand intelligence directly from Supabase
    const { error: deleteError } = await supabase
      .from('competitor_brand_intelligence')
      .delete()
      .eq('competitor_id', competitorId)

    if (deleteError) {
      console.error('Delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete brand intelligence' }, { status: 500 })
    }

    // Also delete content chunks
    await supabase
      .from('competitor_content_chunks')
      .delete()
      .eq('competitor_id', competitorId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete Brand Intelligence Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper to format brand intelligence from snake_case to camelCase
function formatBrandIntelligence(data: Record<string, unknown>) {
  return {
    id: data.id,
    competitorId: data.competitor_id,
    
    // Brand Positioning
    brandVoice: data.brand_voice,
    brandPersonality: data.brand_personality,
    positioningStatement: data.positioning_statement,
    targetAudience: data.target_audience,
    uniqueSellingPoints: data.unique_selling_points || [],
    
    // Offerings & Features
    highlightedAmenities: data.highlighted_amenities || [],
    serviceOfferings: data.service_offerings || [],
    lifestyleFocus: data.lifestyle_focus || [],
    communityEvents: data.community_events || [],
    
    // Promotions & Specials
    activeSpecials: data.active_specials || [],
    promotionalMessaging: data.promotional_messaging,
    urgencyTactics: data.urgency_tactics || [],
    
    // Website Analysis
    websiteTone: data.website_tone,
    keyMessagingThemes: data.key_messaging_themes || [],
    callToActionPatterns: data.call_to_action_patterns || [],
    
    // Semantic Analysis
    sentimentScore: data.sentiment_score,
    confidenceScore: data.confidence_score,
    
    // Metadata
    pagesAnalyzed: data.pages_analyzed || 0,
    lastAnalyzedAt: data.last_analyzed_at,
    analysisVersion: data.analysis_version,
    rawExtraction: data.raw_extraction
  }
}

