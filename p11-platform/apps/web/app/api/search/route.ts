/**
 * Global Search API
 * Searches across leads, properties, documents, and conversations
 */

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

interface SearchResult {
  id: string
  type: 'lead' | 'property' | 'document' | 'conversation' | 'page'
  title: string
  subtitle?: string
  url: string
  meta?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export async function GET(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim().toLowerCase()

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    // Get user's organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ results: [] })
    }

    // Get properties for this org (we'll use these to filter results)
    const { data: properties } = await supabase
      .from('properties')
      .select('id, name')
      .eq('org_id', profile.org_id)

    const propertyIds = properties?.map(p => p.id) || []
    const results: SearchResult[] = []

    // Search Leads
    const { data: leads } = await supabase
      .from('leads')
      .select('id, first_name, last_name, email, phone, status, property_id')
      .in('property_id', propertyIds)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(5)

    if (leads) {
      for (const lead of leads) {
        const property = properties?.find(p => p.id === lead.property_id)
        results.push({
          id: `lead-${lead.id}`,
          type: 'lead',
          title: `${lead.first_name} ${lead.last_name}`,
          subtitle: lead.email || lead.phone || undefined,
          url: `/dashboard/leads?lead=${lead.id}`,
          meta: property?.name,
        })
      }
    }

    // Search Properties
    const matchingProperties = properties?.filter(p => 
      p.name.toLowerCase().includes(query)
    ) || []

    for (const property of matchingProperties.slice(0, 3)) {
      results.push({
        id: `property-${property.id}`,
        type: 'property',
        title: property.name,
        subtitle: 'Property',
        url: `/dashboard/community`,
        meta: 'Property',
      })
    }

    // Search Documents
    const { data: documents } = await supabase
      .from('documents')
      .select('id, content, metadata, property_id')
      .in('property_id', propertyIds)
      .limit(50) // Get more to filter by content

    const matchingDocs = documents?.filter(doc => {
      const metadata = asRecord(doc.metadata)
      const title = asString(metadata?.title)
      const source = asString(metadata?.source)
      const content = doc.content || ''
      return (
        title.toLowerCase().includes(query) ||
        source.toLowerCase().includes(query) ||
        content.toLowerCase().includes(query)
      )
    }).slice(0, 3) || []

    for (const doc of matchingDocs) {
      const property = properties?.find(p => p.id === doc.property_id)
      const metadata = asRecord(doc.metadata)
      results.push({
        id: `doc-${doc.id}`,
        type: 'document',
        title: asString(metadata?.title) || asString(metadata?.source) || 'Document',
        subtitle: doc.content.substring(0, 60) + '...',
        url: `/dashboard/luma`,
        meta: property?.name,
      })
    }

    // Search Conversations
    const { data: conversations } = await supabase
      .from('conversations')
      .select(`
        id,
        channel,
        property_id,
        leads:lead_id (
          first_name,
          last_name
        )
      `)
      .in('property_id', propertyIds)
      .limit(20)

    const matchingConvos = conversations?.filter(conv => {
      const lead = asRecord(conv.leads)
      if (!lead) return false
      const name = `${asString(lead.first_name)} ${asString(lead.last_name)}`.toLowerCase()
      return name.includes(query)
    }).slice(0, 3) || []

    for (const conv of matchingConvos) {
      const property = properties?.find(p => p.id === conv.property_id)
      const lead = asRecord(conv.leads)
      results.push({
        id: `conv-${conv.id}`,
        type: 'conversation',
        title: `Conversation with ${asString(lead?.first_name)} ${asString(lead?.last_name)}`,
        subtitle: `${conv.channel} channel`,
        url: `/dashboard/luma?conversation=${conv.id}`,
        meta: property?.name,
      })
    }

    // Sort results: leads first, then properties, then documents, then conversations
    const typeOrder = ['lead', 'property', 'document', 'conversation']
    results.sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type))

    return NextResponse.json({ results: results.slice(0, 10) })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}

