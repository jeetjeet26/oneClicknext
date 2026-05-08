import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'
import { getAppBaseUrl } from '@/utils/services/runtime-config'
import { normalizePublicWebsiteUrl } from '@/utils/services/public-url'
import { assertValidPropertyType } from '@/utils/property-types'

interface AddressInput {
  street?: string
  city?: string
  state?: string
  zip?: string
}

interface PropertyInput {
  name: string
  type?: string | null
  address?: AddressInput | null
  websiteUrl?: string | null
  additionalUrls?: string[]
  unitCount?: number | null
  yearBuilt?: number | null
  amenities?: string[]
}

// Helper to scrape website and save chunks for a property
async function scrapeAndSaveWebsiteKnowledge(
  propertyId: string,
  websiteUrl: string,
  additionalUrls: string[] = [],
  propertyName: string,
  forwardedCookie?: string | null
): Promise<{ success: boolean; documentsCreated: number; error?: string }> {
  try {
    // Collect all URLs to scrape
    const urlsToScrape = [websiteUrl, ...additionalUrls].filter(u => u?.trim())
    if (urlsToScrape.length === 0) {
      return { success: false, documentsCreated: 0, error: 'No URLs provided' }
    }

    // Call the internal scrape API with propertyId
    const baseUrl = getAppBaseUrl()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.INTERNAL_API_KEY) {
      headers.Authorization = `Bearer ${process.env.INTERNAL_API_KEY}`
    }
    if (forwardedCookie) {
      headers.cookie = forwardedCookie
    }

    const response = await fetch(`${baseUrl}/api/onboarding/scrape-website`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        urls: urlsToScrape, 
        propertyId  // Pass propertyId so it saves to DB
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      return { success: false, documentsCreated: 0, error: errorData.error || 'Scrape failed' }
    }

    const result = await response.json()
    return { 
      success: true, 
      documentsCreated: result.documentsCreated || result.chunksCreated || 0 
    }
  } catch (error) {
    console.error('Website scrape error:', error)
    return { 
      success: false, 
      documentsCreated: 0, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

interface ContactInput {
  type: 'primary' | 'secondary' | 'billing' | 'emergency'
  name: string
  email: string
  phone?: string | null
  role?: string | null
  billingAddress?: AddressInput | null
  billingMethod?: string | null
  specialInstructions?: string | null
  needsW9?: boolean
}

interface IntegrationInput {
  platform: string
  status: string
  accountId?: string | null
  accountName?: string | null
  notes?: string | null
}

interface AddPropertyRequestBody {
  property: PropertyInput
  contacts: ContactInput[]
  integrations?: IntegrationInput[]
  documentCount?: number
  existingPropertyId?: string | null
  // Legacy support for community naming
  community?: PropertyInput
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: AddPropertyRequestBody = await request.json()
    // Support both 'property' and legacy 'community' naming
    const property = body.property || body.community
    const { contacts, integrations = [], existingPropertyId = null } = body

    if (!property?.name?.trim()) {
      return NextResponse.json({ error: 'Property name is required' }, { status: 400 })
    }

    let propertyType: string | null
    try {
      propertyType = assertValidPropertyType(property.type)
    } catch {
      return NextResponse.json({ error: 'Invalid property type' }, { status: 400 })
    }

    // Validate at least one primary contact
    const primaryContact = contacts?.find(c => c.type === 'primary')
    if (!primaryContact?.name?.trim() || !primaryContact?.email?.trim()) {
      return NextResponse.json({ error: 'Primary contact name and email are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get user's organization
    const { data: profile } = await adminClient
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'You must belong to an organization to add properties' }, { status: 400 })
    }

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return NextResponse.json({ error: 'Only admins and managers can add properties' }, { status: 403 })
    }

    const propertyPayload = {
      name: property.name.trim(),
      address: property.address ? {
        street: property.address.street || null,
        city: property.address.city || null,
        state: property.address.state || null,
        zip: property.address.zip || null,
      } : null,
      settings: {
        timezone: 'America/Los_Angeles',
      },
      property_type: propertyType,
      website_url: normalizePublicWebsiteUrl(property.websiteUrl),
      unit_count: property.unitCount || null,
      year_built: property.yearBuilt || null,
      amenities: property.amenities || [],
      onboarding_completed_at: new Date().toISOString(),
    }

    let newProperty: { id: string } & Record<string, unknown> | null = null
    let propertyError: { message?: string } | null = null

    if (existingPropertyId) {
      // Canonical identity path: update the already-created property instead of creating a second row.
      const { data: existingProperty, error: existingPropertyError } = await adminClient
        .from('properties')
        .select('id')
        .eq('id', existingPropertyId)
        .eq('org_id', profile.org_id)
        .single()

      if (existingPropertyError || !existingProperty) {
        return NextResponse.json(
          { error: 'Existing property not found for this organization' },
          { status: 404 }
        )
      }

      const updateResult = await adminClient
        .from('properties')
        .update(propertyPayload)
        .eq('id', existingPropertyId)
        .select()
        .single()

      newProperty = updateResult.data as ({ id: string } & Record<string, unknown>) | null
      propertyError = updateResult.error as { message?: string } | null
    } else {
      const insertResult = await adminClient
        .from('properties')
        .insert({
          org_id: profile.org_id,
          ...propertyPayload,
        })
        .select()
        .single()

      newProperty = insertResult.data as ({ id: string } & Record<string, unknown>) | null
      propertyError = insertResult.error as { message?: string } | null
    }

    if (propertyError || !newProperty) {
      console.error('Error creating property:', propertyError)
      return NextResponse.json({ error: 'Failed to create property' }, { status: 500 })
    }

    // Create contacts
    if (existingPropertyId) {
      await adminClient
        .from('property_contacts')
        .delete()
        .eq('property_id', newProperty.id)
    }

    if (contacts && contacts.length > 0) {
      const contactsToInsert = contacts.map((c, index) => ({
        property_id: newProperty.id,
        contact_type: c.type,
        name: c.name,
        email: c.email,
        phone: c.phone || null,
        role: c.role || null,
        billing_address: c.billingAddress ? {
          street: c.billingAddress.street || null,
          city: c.billingAddress.city || null,
          state: c.billingAddress.state || null,
          zip: c.billingAddress.zip || null,
        } : null,
        billing_method: c.billingMethod || null,
        special_instructions: c.specialInstructions || null,
        needs_w9: c.needsW9 || false,
        is_primary: index === 0,
      }))

      const { error: contactsError } = await adminClient
        .from('property_contacts')
        .insert(contactsToInsert)

      if (contactsError) {
        console.error('Error creating contacts:', contactsError)
      }
    }

    // Create integration records
    if (existingPropertyId) {
      await adminClient
        .from('integration_credentials')
        .delete()
        .eq('property_id', newProperty.id)
    }

    if (integrations && integrations.length > 0) {
      const integrationsToInsert = integrations.map(i => ({
        property_id: newProperty.id,
        platform: i.platform,
        status: i.status,
        account_id: i.accountId || null,
        account_name: i.accountName || null,
        notes: i.notes || null,
      }))

      const { error: integrationsError } = await adminClient
        .from('integration_credentials')
        .insert(integrationsToInsert)

      if (integrationsError) {
        console.error('Error creating integrations:', integrationsError)
      }
    }

    if (!existingPropertyId) {
      // Create default onboarding tasks only for a new property record.
      try {
        await adminClient.rpc('create_default_onboarding_tasks', {
          p_property_id: newProperty.id
        })
      } catch (taskError) {
        console.error('Error creating onboarding tasks:', taskError)
      }
    }

    // Create/update knowledge source record for intake form.
    const intakePayload = {
      source_name: 'Add Property Intake Form',
      status: 'completed',
      extracted_data: {
        property: {
          name: property.name,
          type: property.type,
          unitCount: property.unitCount,
          yearBuilt: property.yearBuilt,
          amenities: property.amenities,
          websiteUrl: property.websiteUrl,
        },
      },
      last_synced_at: new Date().toISOString(),
    }

    const { data: existingIntakeSource } = await adminClient
      .from('knowledge_sources')
      .select('id')
      .eq('property_id', newProperty.id)
      .eq('source_type', 'intake_form')
      .maybeSingle()

    const knowledgeResult = existingIntakeSource
      ? await adminClient
          .from('knowledge_sources')
          .update(intakePayload)
          .eq('id', existingIntakeSource.id)
      : await adminClient
          .from('knowledge_sources')
          .insert({
            property_id: newProperty.id,
            source_type: 'intake_form',
            ...intakePayload,
          })

    if (knowledgeResult.error) {
      console.error('Error creating knowledge source:', knowledgeResult.error)
    }

    // If website URL was provided, scrape and save to knowledge base
    if (property.websiteUrl) {
      console.log('Scraping website for knowledge base:', property.websiteUrl)
      const scrapeResult = await scrapeAndSaveWebsiteKnowledge(
        newProperty.id,
        property.websiteUrl,
        property.additionalUrls || [],
        property.name,
        request.headers.get('cookie')
      )
      if (scrapeResult.success) {
        console.log(`Website scrape complete: ${scrapeResult.documentsCreated} documents created`)
      } else {
        console.error('Website scrape failed:', scrapeResult.error)
      }
    }

    return NextResponse.json({
      success: true,
      property: newProperty,
      reusedExistingProperty: Boolean(existingPropertyId),
    })
  } catch (error) {
    console.error('Add property error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
