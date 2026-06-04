import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { normalizePublicWebsiteUrl } from '@/utils/services/public-url'
import { assertValidPropertyType } from '@/utils/property-types'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

/**
 * Add another property to an existing organization
 * Multi-Property Support
 */

interface AddPropertyRequest {
  name: string
  address?: {
    street?: string
    city?: string
    state?: string
    zip?: string
  } | null
  propertyType?: string | null
  websiteUrl?: string | null
  unitCount?: number | null
  yearBuilt?: number | null
  copyFromPropertyId?: string | null // Template: copy settings from existing property
  copyContacts?: boolean
  copyIntegrations?: boolean
  // Legacy support for communityType naming
  communityType?: string | null
}

async function scrapeWebsiteForProperty(
  propertyId: string,
  websiteUrl: string | null | undefined,
  forwardedCookie?: string | null
): Promise<{ success: boolean; error?: string }> {
  const canonicalWebsiteUrl = normalizePublicWebsiteUrl(websiteUrl)
  if (!canonicalWebsiteUrl) return { success: true }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.INTERNAL_API_KEY) {
      headers.Authorization = `Bearer ${process.env.INTERNAL_API_KEY}`
    }
    if (forwardedCookie) {
      headers.cookie = forwardedCookie
    }

    const response = await fetch(`${getAppBaseUrl()}/api/onboarding/scrape-website`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        propertyId,
        websiteUrl: canonicalWebsiteUrl,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return { success: false, error: payload.error || 'Website scrape failed' }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Website scrape failed',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: AddPropertyRequest = await request.json()

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Property name is required' }, { status: 400 })
    }

    let propertyType: string | null
    try {
      propertyType = assertValidPropertyType(body.propertyType || body.communityType || null)
    } catch {
      return NextResponse.json({ error: 'Invalid property type' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get user's profile to find their org
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'User must belong to an organization' }, { status: 400 })
    }

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return NextResponse.json({ error: 'Only admins and managers can add properties' }, { status: 403 })
    }

    // Create the new property with all profile data consolidated
    const { data: property, error: propertyError } = await adminClient
      .from('properties')
      .insert({
        org_id: profile.org_id,
        name: body.name.trim(),
        address: body.address ? {
          street: body.address.street || null,
          city: body.address.city || null,
          state: body.address.state || null,
          zip: body.address.zip || null,
        } : null,
        settings: {
          timezone: 'America/Los_Angeles',
        },
        // Profile data now directly on properties table
        property_type: propertyType,
        website_url: normalizePublicWebsiteUrl(body.websiteUrl),
        unit_count: body.unitCount || null,
        year_built: body.yearBuilt || null,
      })
      .select()
      .single()

    if (propertyError) {
      console.error('Error creating property:', propertyError)
      return NextResponse.json({ error: 'Failed to create property' }, { status: 500 })
    }

    // If copying from template property
    if (body.copyFromPropertyId) {
      // Copy contacts if requested
      if (body.copyContacts) {
        const { data: sourceContacts } = await adminClient
          .from('property_contacts')
          .select('*')
          .eq('property_id', body.copyFromPropertyId)

        if (sourceContacts && sourceContacts.length > 0) {
          const contactsToInsert = sourceContacts.map(c => ({
            property_id: property.id,
            contact_type: c.contact_type,
            name: c.name,
            email: c.email,
            phone: c.phone,
            role: c.role,
            billing_address: c.billing_address,
            billing_method: c.billing_method,
            special_instructions: c.special_instructions,
            needs_w9: c.needs_w9,
            is_primary: c.is_primary,
          }))

          const { error: contactsError } = await adminClient
            .from('property_contacts')
            .insert(contactsToInsert)

          if (contactsError) {
            console.error('Error copying contacts:', contactsError)
          }
        }
      }

      // Copy integrations if requested
      if (body.copyIntegrations) {
        const { data: sourceIntegrations } = await adminClient
          .from('integration_credentials')
          .select('*')
          .eq('property_id', body.copyFromPropertyId)

        if (sourceIntegrations && sourceIntegrations.length > 0) {
          const integrationsToInsert = sourceIntegrations.map(i => ({
            property_id: property.id,
            platform: i.platform,
            status: 'pending', // Reset status - need to verify for new property
            notes: `Copied from ${body.copyFromPropertyId}`,
          }))

          const { error: integrationsError } = await adminClient
            .from('integration_credentials')
            .insert(integrationsToInsert)

          if (integrationsError) {
            console.error('Error copying integrations:', integrationsError)
          }
        }
      }

      // Copy profile settings from source property
      const { data: sourceProperty } = await adminClient
        .from('properties')
        .select('brand_voice, target_audience, office_hours, pet_policy, parking_info')
        .eq('id', body.copyFromPropertyId)
        .single()

      if (sourceProperty) {
        await adminClient
          .from('properties')
          .update({
            brand_voice: sourceProperty.brand_voice,
            target_audience: sourceProperty.target_audience,
            office_hours: sourceProperty.office_hours,
            pet_policy: sourceProperty.pet_policy,
            parking_info: sourceProperty.parking_info,
          })
          .eq('id', property.id)
      }
    }

    // Create default onboarding tasks
    try {
      await adminClient.rpc('create_default_onboarding_tasks', {
        p_property_id: property.id
      })
    } catch (taskError) {
      console.error('Error creating onboarding tasks:', taskError)
    }

    if (body.websiteUrl) {
      const scrapeResult = await scrapeWebsiteForProperty(
        property.id,
        body.websiteUrl,
        request.headers.get('cookie')
      )
      if (!scrapeResult.success) {
        console.error('Website scrape failed after property add:', scrapeResult.error)
      }
    }

    return NextResponse.json({
      success: true,
      property,
    })
  } catch (error) {
    console.error('Add property error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET: List all properties for the user's organization
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get user's org
    const { data: profile } = await adminClient
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ properties: [] })
    }

    // Fetch all properties (profile data is now consolidated on properties table)
    const { data: properties, error: propertiesError } = await adminClient
      .from('properties')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError)
      return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 })
    }

    return NextResponse.json({
      properties: properties || [],
      count: properties?.length || 0,
    })
  } catch (error) {
    console.error('Properties list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
