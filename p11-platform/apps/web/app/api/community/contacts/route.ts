import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

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

    const { data: contacts, error } = await adminClient
      .from('property_contacts')
      .select('*')
      .eq('property_id', propertyId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching contacts:', error)
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
    }

    return NextResponse.json({ contacts: contacts || [] })
  } catch (error) {
    console.error('Contacts fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, contact } = body

    if (!propertyId || !contact) {
      return NextResponse.json({ error: 'propertyId and contact are required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!contact.name?.trim() || !contact.email?.trim()) {
      return NextResponse.json({ error: 'Contact name and email are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('property_contacts')
      .insert({
        property_id: propertyId,
        contact_type: contact.type || 'primary',
        name: contact.name.trim(),
        email: contact.email.trim(),
        phone: contact.phone || null,
        role: contact.role || null,
        billing_address: contact.billingAddress || null,
        billing_method: contact.billingMethod || null,
        special_instructions: contact.specialInstructions || null,
        needs_w9: contact.needsW9 || false,
        is_primary: contact.isPrimary || false,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating contact:', error)
      return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
    }

    return NextResponse.json({ success: true, contact: data })
  } catch (error) {
    console.error('Contact create error:', error)
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
    const { contactId, contact } = body

    if (!contactId || !contact) {
      return NextResponse.json({ error: 'contactId and contact are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: existingContact, error: existingContactError } = await adminClient
      .from('property_contacts')
      .select('id, property_id')
      .eq('id', contactId)
      .single()

    if (existingContactError || !existingContact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    if (!existingContact.property_id) {
      return NextResponse.json({ error: 'Contact missing property' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, existingContact.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await adminClient
      .from('property_contacts')
      .update({
        contact_type: contact.type,
        name: contact.name?.trim(),
        email: contact.email?.trim(),
        phone: contact.phone || null,
        role: contact.role || null,
        billing_address: contact.billingAddress || null,
        billing_method: contact.billingMethod || null,
        special_instructions: contact.specialInstructions || null,
        needs_w9: contact.needsW9 || false,
        is_primary: contact.isPrimary || false,
      })
      .eq('id', contactId)
      .select()
      .single()

    if (error) {
      console.error('Error updating contact:', error)
      return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
    }

    return NextResponse.json({ success: true, contact: data })
  } catch (error) {
    console.error('Contact update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contactId = request.nextUrl.searchParams.get('contactId')
    
    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: existingContact, error: existingContactError } = await adminClient
      .from('property_contacts')
      .select('id, property_id')
      .eq('id', contactId)
      .single()

    if (existingContactError || !existingContact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    if (!existingContact.property_id) {
      return NextResponse.json({ error: 'Contact missing property' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, existingContact.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await adminClient
      .from('property_contacts')
      .delete()
      .eq('id', contactId)

    if (error) {
      console.error('Error deleting contact:', error)
      return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

