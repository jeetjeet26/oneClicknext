// SiteForge: List Websites API
// GET /api/siteforge/list?propertyId=xxx
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Transform snake_case database fields to camelCase for frontend
function transformWebsite(website: Record<string, unknown>) {
  return {
    id: website.id,
    propertyId: website.property_id,
    wpUrl: website.wp_url,
    wpAdminUrl: website.wp_admin_url,
    wpInstanceId: website.wp_instance_id,
    wpCredentials: website.wp_credentials,
    generationStatus: website.generation_status,
    generationProgress: website.generation_progress,
    currentStep: website.current_step,
    errorMessage: website.error_message,
    brandSource: website.brand_source,
    brandConfidence: website.brand_confidence ? Number(website.brand_confidence) : null,
    siteArchitecture: website.site_architecture,
    pagesGenerated: website.pages_generated,
    assetsManifest: website.assets_manifest,
    generationStartedAt: website.generation_started_at,
    generationCompletedAt: website.generation_completed_at,
    generationDurationSeconds: website.generation_duration_seconds,
    pageViews: website.page_views,
    tourRequests: website.tour_requests,
    conversionRate: website.conversion_rate,
    version: website.version,
    previousVersionId: website.previous_version_id,
    userPreferences: website.user_preferences,
    createdAt: website.created_at,
    updatedAt: website.updated_at
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    // Verify user has access to this property
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('org_id, name')
      .eq('id', propertyId)
      .single()

    if (propertyError || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all websites for this property
    const { data: websites, error: websitesError } = await supabase
      .from('property_websites')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (websitesError) {
      console.error('Error fetching websites:', websitesError)
      return NextResponse.json({ error: 'Failed to fetch websites' }, { status: 500 })
    }

    // Transform to camelCase for frontend
    const transformedWebsites = (websites || []).map(transformWebsite)

    return NextResponse.json({
      websites: transformedWebsites,
      propertyName: property.name,
      total: transformedWebsites.length
    })

  } catch (error) {
    console.error('List websites error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list websites' },
      { status: 500 }
    )
  }
}
