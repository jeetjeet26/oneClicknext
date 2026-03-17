// SiteForge: Pre-Generation Analysis API
// GET /api/siteforge/analyze?propertyId=xxx
// Runs Brand Agent analysis BEFORE generation
// Shows findings to user for conversational planning
// Created: December 16, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { BrandAgent } from '@/utils/siteforge/agents'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    // Verify access
    const { data: property } = await supabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Run Brand Agent analysis
    let brandContext
    try {
      const brandAgent = new BrandAgent(propertyId)
      brandContext = await brandAgent.analyze()
      console.log('✅ Brand Agent succeeded:', {
        source: brandContext.source,
        confidence: brandContext.confidence
      })
    } catch (agentError) {
      console.error('❌ Brand Agent FAILED:', agentError)
      console.error('Error stack:', agentError instanceof Error ? agentError.stack : 'No stack')
      console.error('Error details:', JSON.stringify(agentError, null, 2))
      // Return a basic fallback context if agent fails
      brandContext = {
        source: 'generated',
        confidence: 0.5,
        brandPersonality: { primary: 'modern', traits: ['professional'], avoid: [] },
        visualIdentity: { moodKeywords: ['clean'], colorMood: 'neutral', photoStyle: {}, designStyle: 'modern' },
        targetAudience: { demographics: 'general', psychographics: '', priorities: [], painPoints: [] },
        positioning: { category: 'apartment community', differentiators: [], competitiveAdvantage: '', messagingPillars: [] },
        contentStrategy: { voiceTone: 'professional', vocabularyUse: [], vocabularyAvoid: [], headlineStyle: 'direct', storytellingFocus: 'features' },
        designPrinciples: []
      }
    }
    
    // Get photo count
    const { data: photos } = await supabase
      .from('documents')
      .select('id')
      .eq('property_id', propertyId)
      .in('metadata->type', ['photo', 'image'])
    
    // Get document count
    const { data: documents } = await supabase
      .from('documents')
      .select('id')
      .eq('property_id', propertyId)
    
    // Get BrandForge status
    const { data: brandForge } = await supabase
      .from('property_brand_assets')
      .select('generation_status')
      .eq('property_id', propertyId)
      .single()
    
    return NextResponse.json({
      propertyId,
      propertyName: property.name,
      brandContext,
      stats: {
        photos: photos?.length || 0,
        documents: documents?.length || 0,
        hasBrandForge: brandForge?.generation_status === 'complete'
      }
    })

  } catch (error) {
    console.error('Pre-analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}










