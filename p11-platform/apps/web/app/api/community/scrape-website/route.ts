import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

/**
 * POST /api/community/scrape-website
 * Triggers a website scrape for an existing property and saves to knowledge base
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { propertyId, websiteUrl, additionalUrls = [] } = await request.json()

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    if (!websiteUrl) {
      return NextResponse.json({ error: 'websiteUrl is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Verify property exists and user has access
    const { data: property, error: propError } = await adminClient
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (propError || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Collect all URLs to scrape
    const urlsToScrape = [websiteUrl, ...additionalUrls].filter(u => u?.trim())

    // Call the internal scrape API with propertyId
    const baseUrl = getAppBaseUrl()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.INTERNAL_API_KEY) {
      headers.Authorization = `Bearer ${process.env.INTERNAL_API_KEY}`
    }
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) {
      headers.cookie = cookieHeader
    }

    const scrapeResponse = await fetch(`${baseUrl}/api/onboarding/scrape-website`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        urls: urlsToScrape, 
        propertyId  // Pass propertyId so it saves to DB
      }),
    })

    if (!scrapeResponse.ok) {
      const errorData = await scrapeResponse.json()
      return NextResponse.json({ 
        error: errorData.error || 'Website scrape failed' 
      }, { status: scrapeResponse.status })
    }

    const scrapeResult = await scrapeResponse.json()

    // Keep canonical setup truth on properties (avoid splitting identity with community_profiles).
    await adminClient
      .from('properties')
      .update({ website_url: websiteUrl })
      .eq('id', propertyId)
      .is('website_url', null)

    return NextResponse.json({
      success: true,
      documentsCreated: scrapeResult.documentsCreated || scrapeResult.chunksCreated || 0,
      amenities: scrapeResult.amenities || [],
      propertyName: scrapeResult.propertyName,
      pagesScraped: scrapeResult.pagesScraped || 1,
    })

  } catch (error) {
    console.error('Community website scrape error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Server error' 
    }, { status: 500 })
  }
}

