import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'

// GET - Get a single property with all details (contacts, integrations, documents)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { id } = await params

  try {
    const access = await validatePropertyAccess(user.id, id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get user's profile to find their organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    // Get property with basic info
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select(`
        id,
        name,
        address,
        settings,
        created_at,
        org_id
      `)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .single()

    if (propertyError || !property) {
      console.error('Error fetching property:', propertyError)
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Get contacts for this property
    const { data: contacts } = await supabase
      .from('property_contacts')
      .select('*')
      .eq('property_id', id)
      .order('contact_type', { ascending: true })

    // Get integrations for this property
    const { data: integrations } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('property_id', id)

    // Get document chunks for this property (for knowledge base)
    const { data: documentChunks } = await supabase
      .from('documents')
      .select('id, metadata, created_at')
      .eq('property_id', id)
      .order('created_at', { ascending: false })

    // Transform chunks into a document summary format
    const documents = documentChunks?.reduce((acc, chunk) => {
      const title = (chunk.metadata as Record<string, unknown>)?.title as string || 'Unknown Document'
      const source = (chunk.metadata as Record<string, unknown>)?.source as string || ''
      
      // Group by unique title/source
      const key = `${title}-${source}`
      if (!acc.has(key)) {
        acc.set(key, {
          id: chunk.id,
          name: title,
          source: source,
          created_at: chunk.created_at,
          chunk_count: 1
        })
      } else {
        acc.get(key)!.chunk_count++
      }
      return acc
    }, new Map<string, { id: string; name: string; source: string; created_at: string | null; chunk_count: number }>())

    const documentsList = documents ? Array.from(documents.values()) : []

    // Get knowledge sources
    const { data: knowledgeSources } = await supabase
      .from('knowledge_sources')
      .select('*')
      .eq('property_id', id)

    return NextResponse.json({
      property: {
        ...property,
        contacts: contacts || [],
        integrations: integrations || [],
        documents: documentsList,
        knowledgeSources: knowledgeSources || []
      }
    })
  } catch (error) {
    console.error('Property API error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

