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

    // Fetch knowledge sources
    const { data: sources, error: sourcesError } = await adminClient
      .from('knowledge_sources')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (sourcesError) {
      console.error('Error fetching knowledge sources:', sourcesError)
      return NextResponse.json({ error: 'Failed to fetch knowledge sources' }, { status: 500 })
    }

    // Get document chunks count
    const { count: documentsCount, error: countError } = await adminClient
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)

    if (countError) {
      console.error('Error counting documents:', countError)
    }

    // Get unique document titles for categorization
    const { data: documents } = await adminClient
      .from('documents')
      .select('metadata')
      .eq('property_id', propertyId)

    // Extract unique titles and categorize
    const uniqueTitles = new Set<string>()
    const categories: Record<string, number> = {
      property: 0,
      policies: 0,
      pricing: 0,
      other: 0,
    }

    documents?.forEach(doc => {
      const metadata = doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {}
      const title = typeof metadata.title === 'string' ? metadata.title : 'Unknown'
      if (!uniqueTitles.has(title)) {
        uniqueTitles.add(title)
        // Simple categorization based on title keywords
        const lowerTitle = title.toLowerCase()
        if (lowerTitle.includes('pet') || lowerTitle.includes('policy') || lowerTitle.includes('rules')) {
          categories.policies++
        } else if (lowerTitle.includes('price') || lowerTitle.includes('rent') || lowerTitle.includes('fee')) {
          categories.pricing++
        } else if (lowerTitle.includes('amenity') || lowerTitle.includes('property') || lowerTitle.includes('brochure')) {
          categories.property++
        } else {
          categories.other++
        }
      }
    })

    // Include property_units in pricing category
    const { count: unitsCount } = await adminClient
      .from('property_units')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
    
    if (unitsCount && unitsCount > 0) {
      categories.pricing++ // Count property units as one pricing source
    }

    // Generate AI insights from extracted data
    const insights: string[] = []
    sources?.forEach(source => {
      if (source.extracted_data) {
        const data = source.extracted_data as Record<string, unknown>
        if (data.pet_policy) {
          const pet = data.pet_policy as Record<string, unknown>
          if (pet.allowed !== undefined) {
            insights.push(`Pets ${pet.allowed ? 'allowed' : 'not allowed'}${pet.deposit ? ` with $${pet.deposit} deposit` : ''}${pet.restrictions ? `, ${pet.restrictions}` : ''}`)
          }
        }
        if (data.amenities && Array.isArray(data.amenities) && data.amenities.length > 0) {
          insights.push(`Amenities: ${data.amenities.slice(0, 5).join(', ')}${data.amenities.length > 5 ? ` +${data.amenities.length - 5} more` : ''}`)
        }
        if (data.specials) {
          const specials = data.specials as string[]
          if (Array.isArray(specials) && specials.length > 0) {
            insights.push(`Current specials: ${specials[0]}`)
          }
        }
      }
    })

    // Add insights from property_units
    if (unitsCount && unitsCount > 0) {
      const { data: units } = await adminClient
        .from('property_units')
        .select('unit_type, bedrooms, rent_min, rent_max')
        .eq('property_id', propertyId)
        .order('bedrooms', { ascending: true })
        .limit(3)

      if (units && units.length > 0) {
        const unitSummary = units.map(u => {
          const rentRange = u.rent_min && u.rent_max && u.rent_min !== u.rent_max
            ? `$${u.rent_min}-$${u.rent_max}`
            : u.rent_min 
            ? `$${u.rent_min}`
            : 'Call for pricing'
          return `${u.unit_type} (${u.bedrooms}BR): ${rentRange}`
        }).join(', ')
        insights.push(`Floor plans: ${unitSummary}${unitsCount > 3 ? ` +${unitsCount - 3} more` : ''}`)
      }
    }

    return NextResponse.json({
      sources: sources || [],
      documentsCount: documentsCount || 0,
      uniqueDocuments: uniqueTitles.size,
      categories,
      insights: insights.slice(0, 5), // Limit to 5 insights
    })
  } catch (error) {
    console.error('Knowledge sources fetch error:', error)
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
    const { propertyId, sourceType, sourceName, sourceUrl, extractedData } = body

    if (!propertyId || !sourceType || !sourceName) {
      return NextResponse.json({ error: 'propertyId, sourceType, and sourceName are required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('knowledge_sources')
      .insert({
        property_id: propertyId,
        source_type: sourceType,
        source_name: sourceName,
        source_url: sourceUrl || null,
        extracted_data: extractedData || {},
        status: 'completed',
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating knowledge source:', error)
      return NextResponse.json({ error: 'Failed to create knowledge source' }, { status: 500 })
    }

    return NextResponse.json({ success: true, source: data })
  } catch (error) {
    console.error('Knowledge source create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

