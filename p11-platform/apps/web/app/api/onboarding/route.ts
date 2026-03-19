import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

interface OrganizationInput {
  name: string
  type?: string | null
  legalName?: string | null
}

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

    // Import the scraping logic - call the internal API
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

interface OnboardingRequestBody {
  organization: OrganizationInput
  property: PropertyInput
  contacts: ContactInput[]
  integrations?: IntegrationInput[]
  documentCount?: number
  // Legacy support for simple onboarding
  organizationName?: string
  propertyName?: string | null
  propertyAddress?: AddressInput | null
  // Legacy support for community naming
  community?: PropertyInput
}

function partialSetupResponse(
  message: string,
  organization: { id?: string } | null,
  property: { id?: string } | null,
  setupFailures: string[]
) {
  return NextResponse.json(
    {
      error: message,
      success: false,
      organization,
      property,
      setupFailures,
    },
    { status: 500 }
  )
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: OnboardingRequestBody = await request.json()
    
    // Handle legacy simple onboarding format
    if (body.organizationName && !body.organization) {
      return handleLegacyOnboarding(user.id, body)
    }

    const { organization, contacts, integrations = [] } = body
    // Support both 'property' and legacy 'community' naming
    const property = body.property || body.community

    if (!organization?.name?.trim()) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
    }

    if (!property?.name?.trim()) {
      return NextResponse.json({ error: 'Property name is required' }, { status: 400 })
    }

    // Validate at least one primary contact
    const primaryContact = contacts?.find(c => c.type === 'primary')
    if (!primaryContact?.name?.trim() || !primaryContact?.email?.trim()) {
      return NextResponse.json({ error: 'Primary contact name and email are required' }, { status: 400 })
    }

    // Use admin client to bypass RLS for creating org and updating profile
    const adminClient = createAdminClient()

    // Check if user already has an organization
    const { data: existingProfile } = await adminClient
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (existingProfile?.org_id) {
      return NextResponse.json({ error: 'You already belong to an organization' }, { status: 400 })
    }

    // Create organization
    const { data: org, error: orgError } = await adminClient
      .from('organizations')
      .insert({
        name: organization.name.trim(),
        subscription_tier: 'starter',
      })
      .select()
      .single()

    if (orgError) {
      console.error('Error creating organization:', orgError)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }

    // Update user profile with org_id and make them admin
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        org_id: org.id,
        role: 'admin',
      })
      .eq('id', user.id)

    if (profileError) {
      console.error('Error updating profile:', profileError)
      await adminClient.from('organizations').delete().eq('id', org.id)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    // Create property with all profile data consolidated
    const { data: newProperty, error: propertyError } = await adminClient
      .from('properties')
      .insert({
        org_id: org.id,
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
        // Profile data now directly on properties table
        property_type: property.type || null,
        website_url: property.websiteUrl || null,
        unit_count: property.unitCount || null,
        year_built: property.yearBuilt || null,
        amenities: property.amenities || [],
        onboarding_completed_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (propertyError || !newProperty) {
      console.error('Error creating property:', propertyError)
      return partialSetupResponse(
        'Failed to complete property setup during onboarding',
        org,
        null,
        ['property_creation_failed']
      )
    }

    const setupFailures: string[] = []

    // Create contacts
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
        setupFailures.push('property_contacts_failed')
      }
    }

    // Create integration records
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
        setupFailures.push('integration_records_failed')
      }
    }

    // Create default onboarding tasks
    try {
      await adminClient.rpc('create_default_onboarding_tasks', {
        p_property_id: newProperty.id
      })
    } catch (taskError) {
      console.error('Error creating onboarding tasks:', taskError)
      setupFailures.push('onboarding_tasks_failed')
    }

    // Create knowledge source record for intake form
    const { error: knowledgeError } = await adminClient
      .from('knowledge_sources')
      .insert({
        property_id: newProperty.id,
        source_type: 'intake_form',
        source_name: 'Onboarding Intake Form',
        status: 'completed',
        extracted_data: {
          organization: {
            name: organization.name,
            type: organization.type,
            legalName: organization.legalName,
          },
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
      })

    if (knowledgeError) {
      console.error('Error creating knowledge source:', knowledgeError)
      setupFailures.push('intake_knowledge_source_failed')
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
        setupFailures.push('website_scrape_failed')
      }
    }

    if (setupFailures.length > 0) {
      return partialSetupResponse(
        'Onboarding created the organization and property, but one or more downstream setup steps failed',
        org,
        newProperty,
        setupFailures
      )
    }

    return NextResponse.json({
      success: true,
      organization: org,
      property: newProperty,
    })
  } catch (error) {
    console.error('Onboarding error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Handle legacy simple onboarding format (2-step flow)
async function handleLegacyOnboarding(
  userId: string, 
  body: OnboardingRequestBody
) {
  const { organizationName, propertyName, propertyAddress } = body

  if (!organizationName?.trim()) {
    return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Check if user already has an organization
  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .single()

  if (existingProfile?.org_id) {
    return NextResponse.json({ error: 'You already belong to an organization' }, { status: 400 })
  }

  // Create organization
  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    .insert({
      name: organizationName.trim(),
      subscription_tier: 'starter',
    })
    .select()
    .single()

  if (orgError) {
    console.error('Error creating organization:', orgError)
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
  }

  // Update user profile with org_id and make them admin
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      org_id: org.id,
      role: 'admin',
    })
    .eq('id', userId)

  if (profileError) {
    console.error('Error updating profile:', profileError)
    await adminClient.from('organizations').delete().eq('id', org.id)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  // Create property if provided
  let property = null
  if (propertyName?.trim()) {
    const { data: newProperty, error: propertyError } = await adminClient
      .from('properties')
      .insert({
        org_id: org.id,
        name: propertyName.trim(),
        address: propertyAddress ? {
          street: propertyAddress.street || null,
          city: propertyAddress.city || null,
          state: propertyAddress.state || null,
          zip: propertyAddress.zip || null,
        } : null,
        settings: {
          timezone: 'America/Los_Angeles',
        },
      })
      .select()
      .single()

    if (propertyError) {
      console.error('Error creating property:', propertyError)
      return partialSetupResponse(
        'Failed to complete property setup during onboarding',
        org,
        null,
        ['property_creation_failed']
      )
    }
    property = newProperty
  }

  return NextResponse.json({
    success: true,
    organization: org,
    property,
  })
}

// GET endpoint to check onboarding status
export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user has an org
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('org_id, role, full_name')
      .eq('id', user.id)
      .single()

    return NextResponse.json({
      needsOnboarding: !profile?.org_id,
      profile,
    })
  } catch (error) {
    console.error('Onboarding status check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
