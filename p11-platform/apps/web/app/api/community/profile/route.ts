import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { normalizePublicWebsiteUrl } from '@/utils/services/public-url'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = request.nextUrl.searchParams.get('propertyId')
    
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Fetch property directly (profile data is now consolidated into properties)
    const { data: property, error: propertyError } = await adminClient
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single()

    if (propertyError) {
      console.error('Error fetching property:', propertyError)
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Transform to the expected format for backward compatibility
    // The "profile" is now just the property itself
    const profile = {
      id: property.id,
      property_id: property.id,
      legal_name: property.name,
      community_type: property.property_type,
      website_url: property.website_url,
      unit_count: property.unit_count,
      year_built: property.year_built,
      amenities: property.amenities || [],
      pet_policy: property.pet_policy || {},
      parking_info: property.parking_info || {},
      special_features: property.special_features || [],
      brand_voice: property.brand_voice,
      target_audience: property.target_audience,
      office_hours: property.office_hours || {},
      social_media: property.social_media || {},
      intake_completed_at: property.onboarding_completed_at,
    }

    return NextResponse.json({
      profile,
      property,
      needsSetup: !property.onboarding_completed_at,
    })
  } catch (error) {
    console.error('Property profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, ...updates } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Update property directly (profile data is now on properties table)
    const { data, error } = await adminClient
      .from('properties')
      .update({
        property_type: updates.communityType || null,
        website_url: normalizePublicWebsiteUrl(updates.websiteUrl),
        unit_count: updates.unitCount || null,
        year_built: updates.yearBuilt || null,
        amenities: updates.amenities || [],
        pet_policy: updates.petPolicy || {},
        parking_info: updates.parkingInfo || {},
        special_features: updates.specialFeatures || [],
        brand_voice: updates.brandVoice || null,
        target_audience: updates.targetAudience || null,
        office_hours: updates.officeHours || {},
        social_media: updates.socialMedia || {},
      })
      .eq('id', propertyId)
      .select()
      .single()

    if (error) {
      console.error('Error updating property:', error)
      return NextResponse.json({ error: 'Failed to update property' }, { status: 500 })
    }

    // Return in the expected profile format for backward compatibility
    const profile = {
      id: data.id,
      property_id: data.id,
      legal_name: data.name,
      community_type: data.property_type,
      website_url: data.website_url,
      unit_count: data.unit_count,
      year_built: data.year_built,
      amenities: data.amenities || [],
      pet_policy: data.pet_policy || {},
      parking_info: data.parking_info || {},
      special_features: data.special_features || [],
      brand_voice: data.brand_voice,
      target_audience: data.target_audience,
      office_hours: data.office_hours || {},
      social_media: data.social_media || {},
      intake_completed_at: data.onboarding_completed_at,
    }

    return NextResponse.json({ success: true, profile })
  } catch (error) {
    console.error('Property profile update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
