import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/utils/audit'
import { normalizePublicWebsiteUrl } from '@/utils/services/public-url'
import { assertValidPropertyType } from '@/utils/property-types'

// PUT - Update a property with all details (contacts, integrations)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { id: propertyId } = await params

  try {
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    // Support both 'property' and legacy 'community' naming
    const propertyData = body.property || body.community
    const { contacts, integrations } = body

    if (!propertyData?.name?.trim()) {
      return NextResponse.json({ error: 'Property name is required' }, { status: 400 })
    }

    let propertyType: string | null
    try {
      propertyType = assertValidPropertyType(propertyData?.type || propertyData?.propertyType || null)
    } catch {
      return NextResponse.json({ error: 'Invalid property type' }, { status: 400 })
    }

    // Get user's profile to find their organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const userRole = profile.role || ''

    // Check if user has permission
    if (!['admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Verify property belongs to user's org
    const { data: existingProperty, error: propertyError } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', propertyId)
      .eq('org_id', profile.org_id)
      .single()

    if (propertyError || !existingProperty) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Update the property with all profile data consolidated
    const { data: property, error: updateError } = await supabase
      .from('properties')
      .update({
        name: propertyData.name,
        address: propertyData.address || {},
        // Profile data now directly on properties table
        property_type: propertyType,
        website_url: normalizePublicWebsiteUrl(propertyData.websiteUrl),
        unit_count: propertyData.unitCount || null,
        year_built: propertyData.yearBuilt || null,
        amenities: propertyData.amenities || [],
        pet_policy: propertyData.petPolicy || {},
        parking_info: propertyData.parkingInfo || {},
        special_features: propertyData.specialFeatures || [],
        brand_voice: propertyData.brandVoice || null,
        target_audience: propertyData.targetAudience || null,
        office_hours: propertyData.officeHours || {},
        social_media: propertyData.socialMedia || {},
        updated_at: new Date().toISOString()
      })
      .eq('id', propertyId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating property:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Update contacts - delete existing and insert new
    if (contacts && contacts.length > 0) {
      // Delete existing contacts
      await supabase
        .from('property_contacts')
        .delete()
        .eq('property_id', propertyId)

      // Insert new contacts
      const contactsToInsert = contacts.map((contact: {
        type: string
        name: string
        email: string
        phone?: string
        role?: string
        billingAddress?: {
          street?: string
          city?: string
          state?: string
          zip?: string
        }
        billingMethod?: string
        specialInstructions?: string
        needsW9?: boolean
      }) => ({
        property_id: propertyId,
        contact_type: contact.type,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        role: contact.role,
        billing_address: contact.billingAddress,
        billing_method: contact.billingMethod,
        special_instructions: contact.specialInstructions,
        needs_w9: contact.needsW9 || false
      }))

      const { error: contactsError } = await supabase
        .from('property_contacts')
        .insert(contactsToInsert)

      if (contactsError) {
        console.error('Error updating contacts:', contactsError)
        // Don't fail the whole operation, just log
      }
    }

    // Update integrations - upsert by platform
    if (integrations && integrations.length > 0) {
      for (const integration of integrations) {
        const integrationData = {
          property_id: propertyId,
          platform: integration.platform,
          status: integration.status || 'pending',
          account_id: integration.accountId,
          account_name: integration.accountName,
          notes: integration.notes,
          updated_at: new Date().toISOString()
        }

        // Check if integration exists
        const { data: existing } = await supabase
          .from('integration_credentials')
          .select('id')
          .eq('property_id', propertyId)
          .eq('platform', integration.platform)
          .single()

        if (existing) {
          await supabase
            .from('integration_credentials')
            .update(integrationData)
            .eq('id', existing.id)
        } else {
          await supabase
            .from('integration_credentials')
            .insert(integrationData)
        }
      }
    }

    // Log audit event
    await logAuditEvent({
      action: 'update',
      entityType: 'property',
      entityId: propertyId,
      entityName: property.name,
      details: { 
        updated_sections: ['property', 'contacts', 'integrations'],
        contacts_count: contacts?.length || 0,
        integrations_count: integrations?.length || 0
      },
      request
    })

    return NextResponse.json({ 
      property,
      message: 'Property updated successfully'
    })
  } catch (error) {
    console.error('Property update error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
