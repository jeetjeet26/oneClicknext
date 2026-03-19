import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { syncPropertyUnitsToKnowledgeBase } from '@/utils/property-units-kb-sync'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineUrl } from '@/utils/services/runtime-config'

const DATA_ENGINE_URL = getDataEngineUrl()

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { propertyId, websiteUrl } = await req.json()
    
    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID required' }, { status: 400 })
    }
    
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: property } = await supabase
      .from('properties')
      .select('id, website_url')
      .eq('id', propertyId)
      .single()
    
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }
    
    // Call data-engine to scrape
    const response = await fetch(`${DATA_ENGINE_URL}/scrape/property/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        url: websiteUrl || property.website_url
      })
    })
    
    const result = await response.json()
    
    // If scraping was successful, sync units to knowledge base
    if (result.success && result.units_found > 0) {
      const sourceUrl = websiteUrl || property.website_url
      
      // Check if a scraped pricing source already exists
      const { data: existingSource } = await supabase
        .from('knowledge_sources')
        .select('id')
        .eq('property_id', propertyId)
        .eq('source_type', 'website')
        .eq('source_name', 'Scraped Pricing Data')
        .single()

      if (existingSource) {
        // Update existing entry
        await supabase
          .from('knowledge_sources')
          .update({
            documents_created: result.units_found,
            extracted_data: {
              floor_plans: result.floor_plans_found,
              amenities: result.amenities_found,
              specials: result.specials_found,
              source_url: sourceUrl
            },
            last_synced_at: new Date().toISOString(),
            status: 'completed'
          })
          .eq('id', existingSource.id)
      } else {
        // Create new entry
        await supabase
          .from('knowledge_sources')
          .insert({
            property_id: propertyId,
            source_type: 'website',
            source_name: 'Scraped Pricing Data',
            source_url: sourceUrl,
            status: 'completed',
            documents_created: result.units_found,
            extracted_data: {
              floor_plans: result.floor_plans_found,
              amenities: result.amenities_found,
              specials: result.specials_found,
              source_url: sourceUrl
            },
            last_synced_at: new Date().toISOString()
          })
      }

      // Sync to documents table for RAG
      const syncResult = await syncPropertyUnitsToKnowledgeBase(propertyId)
      if (!syncResult.success) {
        console.warn('Failed to sync units to documents for RAG:', syncResult.error)
      }
    }
    
    return NextResponse.json(result)
    
  } catch (error: unknown) {
    console.error('Property scrape error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to scrape property' },
      { status: 500 }
    )
  }
}

