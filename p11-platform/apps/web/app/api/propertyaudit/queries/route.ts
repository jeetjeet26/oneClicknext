/**
 * PropertyAudit Queries API
 * Manage query panels for GEO tracking
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { aggregateAnswersByQuery } from '@/utils/propertyaudit/reporting'

export interface GeoQuery {
  id: string
  propertyId: string
  text: string
  type: 'branded' | 'category' | 'comparison' | 'local' | 'faq' | 'voice_search'
  geo: string | null
  weight: number
  runCount: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// GET: List queries for a property
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const type = searchParams.get('type')
    const activeOnly = searchParams.get('activeOnly') !== 'false'
    const includePerformance = searchParams.get('includePerformance') !== 'false' // Default true

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    let query = supabase
      .from('geo_queries')
      .select('*')
      .eq('property_id', propertyId)
      .order('type', { ascending: true })
      .order('created_at', { ascending: true })

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    if (type) {
      query = query.eq('type', type)
    }

    const { data: queries, error } = await query

    if (error) {
      console.error('Error fetching queries:', error)
      return NextResponse.json({ error: 'Failed to fetch queries' }, { status: 500 })
    }

    // Fetch latest answers for performance data if requested
    let answersMap = new Map<string, any>()
    if (includePerformance && queries && queries.length > 0) {
      // Get latest completed runs for this property
      const { data: latestRuns } = await supabase
        .from('geo_runs')
        .select('id')
        .eq('property_id', propertyId)
        .eq('status', 'completed')
        .order('started_at', { ascending: false })
        .limit(2)

      if (latestRuns && latestRuns.length > 0) {
        const runIds = latestRuns.map(r => r.id)
        
        // Fetch answers for these runs
        const { data: answers } = await supabase
          .from('geo_answers')
          .select('query_id, presence, llm_rank, link_rank, sov, flags, created_at, geo_queries (id, text, type)')
          .in('run_id', runIds)

        const aggregated = aggregateAnswersByQuery(answers || [], queries, new Map())
        aggregated.forEach(answer => {
          if (!answersMap.has(answer.query_id)) {
            answersMap.set(answer.query_id, answer)
          }
        })
      }
    }

    // Fetch AI Overview visibility data (for ALL property queries, independent of runs)
    let aiOverviewMap = new Map<string, { visible: boolean; sourceUrl?: string | null }>()
    if (includePerformance) {
      // Fetch all AI Overview data for this property, not limited to specific query IDs
      // This allows AI Overview visibility to work independently of historical audit runs
      const { data: aiOverviews } = await supabase
        .from('geo_ai_overviews')
        .select('query_id, visible, source_url, observed_at')
        .eq('property_id', propertyId)
        .order('observed_at', { ascending: false })

      // Keep only latest per query
      ;(aiOverviews || []).forEach((row: { query_id: string; visible: boolean; source_url?: string | null }) => {
        if (row.query_id && !aiOverviewMap.has(row.query_id)) {
          aiOverviewMap.set(row.query_id, { visible: row.visible, sourceUrl: row.source_url })
        }
      })
    }

    // Group by type for easy consumption
    const grouped = {
      branded: queries?.filter(q => q.type === 'branded') || [],
      category: queries?.filter(q => q.type === 'category') || [],
      comparison: queries?.filter(q => q.type === 'comparison') || [],
      local: queries?.filter(q => q.type === 'local') || [],
      faq: queries?.filter(q => q.type === 'faq') || [],
      voice_search: queries?.filter(q => q.type === 'voice_search') || [],
    }

    // Merge performance data with queries
    const queriesWithPerformance = queries?.map(q => {
      const answer = answersMap.get(q.id)
      const aiOverview = aiOverviewMap.get(q.id)
      return {
        ...formatQuery(q),
        ...(answer ? {
          presence: answer.presence,
          llmRank: answer.llm_rank,
          linkRank: answer.link_rank,
          sov: answer.sov,
          presenceRate: answer.presence_rate
        } : {}),
        ...(aiOverview ? {
          aiOverviewVisible: aiOverview.visible,
          aiOverviewSource: aiOverview.sourceUrl
        } : {})
      }
    }) || []

    return NextResponse.json({
      queries: queriesWithPerformance,
      grouped,
      total: queries?.length || 0,
    })
  } catch (error) {
    console.error('PropertyAudit Queries GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Create new query or generate query panel from property data
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, query, generateFromProperty } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    // Generate query panel from property data
    if (generateFromProperty) {
      const queries = await generateQueryPanel(supabase, propertyId)
      
      // Insert all generated queries
      const { data: insertedQueries, error: insertError } = await supabase
        .from('geo_queries')
        .insert(queries)
        .select()

      if (insertError) {
        console.error('Error inserting generated queries:', insertError)
        return NextResponse.json({ error: 'Failed to generate query panel' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        generated: insertedQueries?.length || 0,
        queries: insertedQueries?.map(formatQuery) || [],
      })
    }

    // Create single query
    if (query) {
      const { data: newQuery, error: insertError } = await supabase
        .from('geo_queries')
        .insert({
          property_id: propertyId,
          text: query.text,
          type: query.type,
          geo: query.geo || null,
          weight: query.weight || 1,
          is_active: true,
        })
        .select()
        .single()

      if (insertError) {
        console.error('Error inserting query:', insertError)
        return NextResponse.json({ error: 'Failed to create query' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        query: formatQuery(newQuery),
      })
    }

    return NextResponse.json({ error: 'query or generateFromProperty required' }, { status: 400 })
  } catch (error) {
    console.error('PropertyAudit Queries POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Remove a query
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const queryId = searchParams.get('queryId')

    if (!queryId) {
      return NextResponse.json({ error: 'queryId required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('geo_queries')
      .delete()
      .eq('id', queryId)

    if (error) {
      console.error('Error deleting query:', error)
      return NextResponse.json({ error: 'Failed to delete query' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PropertyAudit Queries DELETE Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Generate query panel from property data
async function generateQueryPanel(supabase: Awaited<ReturnType<typeof createClient>>, propertyId: string) {
  // Fetch property data
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select(`
      id,
      name,
      address,
      property_type,
      amenities,
      special_features
    `)
    .eq('id', propertyId)
    .single()

  if (propertyError || !property) {
    console.error('Property fetch error:', propertyError)
    throw new Error('Property not found')
  }

  // Extract address components with fallbacks
  const addressObj = property.address as { 
    city?: string
    state?: string
    street?: string
    neighborhood?: string
    zip?: string
  } | null
  
  const city = addressObj?.city || 'Unknown City'
  const state = addressObj?.state || ''
  const cityState = state ? `${city}, ${state}` : city
  const neighborhood = addressObj?.neighborhood || city
  const street = addressObj?.street || ''

  // Fetch competitors from MarketVision
  const { data: competitors } = await supabase
    .from('competitors')
    .select('name')
    .eq('property_id', propertyId)
    .limit(5)

  // Fetch BrandForge data for USPs (optional)
  const { data: brandData } = await supabase
    .from('brand_books')
    .select('unique_selling_points, target_audience')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const queries: Array<{
    property_id: string
    text: string
    type: string
    geo: string | null
    weight: number
    run_count: number
    is_active: boolean
  }> = []

  const propertyName = property.name
  const amenities = property.amenities || []
  const specialFeatures = property.special_features || []

  // ============================================================================
  // 1. BRANDED QUERIES (4 queries) - Keep as-is
  // ============================================================================
  queries.push(
    { property_id: propertyId, text: `What is ${propertyName}?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Is ${propertyName} a good place to live?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${propertyName} reviews`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${propertyName} apartments`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
  )

  // ============================================================================
  // 2. GENERIC CATEGORY QUERIES (1-2 queries) - Reduced for benchmarking only
  // ============================================================================
  queries.push(
    { property_id: propertyId, text: `Best apartments in ${city}`, type: 'category', geo: cityState, weight: 0.8, run_count: 1, is_active: true },
  )

  // ============================================================================
  // 3. AMENITY COMBINATION QUERIES (NEW - 4-6 queries)
  // Long-tail queries with 2-3 amenity combinations
  // ============================================================================
  if (amenities.length >= 2) {
    const amenityCombos = generateAmenityCombinations(amenities, neighborhood, city, propertyId, cityState)
    queries.push(...amenityCombos.slice(0, 6))
  } else {
    // Fallback if no amenities: use generic but neighborhood-specific
    queries.push(
      { property_id: propertyId, text: `Modern apartments in ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
      { property_id: propertyId, text: `Newly built apartments ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
    )
  }

  // ============================================================================
  // 4. NEIGHBORHOOD-SPECIFIC QUERIES (NEW - 3 queries)
  // ============================================================================
  queries.push(
    { property_id: propertyId, text: `Best place to live in ${neighborhood}`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${neighborhood} apartment communities`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Moving to ${neighborhood} - apartment recommendations`, type: 'local', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
  )

  // ============================================================================
  // 5. USP-DRIVEN QUERIES (NEW - 2-3 queries if BrandForge data exists)
  // ============================================================================
  if (brandData?.unique_selling_points) {
    const usps = Array.isArray(brandData.unique_selling_points) 
      ? brandData.unique_selling_points 
      : []
    
    for (const usp of usps.slice(0, 3)) {
      if (typeof usp === 'string' && usp.length > 0) {
        const uspQuery = generateUSPQuery(usp, city, neighborhood)
        if (uspQuery) {
          queries.push({
            property_id: propertyId,
            text: uspQuery,
            type: 'category',
            geo: cityState,
            weight: 1.5, // High weight - unique differentiator
            run_count: 1,
            is_active: true,
          })
        }
      }
    }
  }

  // ============================================================================
  // 6. LIFESTYLE/PERSONA QUERIES (NEW - 2-3 queries if target audience exists)
  // ============================================================================
  if (brandData?.target_audience) {
    const personas = extractPersonas(brandData.target_audience)
    personas.slice(0, 3).forEach(persona => {
      queries.push({
        property_id: propertyId,
        text: `Apartments for ${persona} in ${neighborhood}`,
        type: 'category',
        geo: cityState,
        weight: 1.3,
        run_count: 1,
        is_active: true,
      })
    })
  }

  // ============================================================================
  // 7. COMPARISON QUERIES (Keep current - 3 queries)
  // ============================================================================
  if (competitors && competitors.length > 0) {
    for (const competitor of competitors.slice(0, 3)) {
      queries.push({
        property_id: propertyId,
        text: `${propertyName} vs ${competitor.name}`,
        type: 'comparison',
        geo: cityState,
        weight: 1.3,
        run_count: 1,
        is_active: true,
      })
    }
  }

  // ============================================================================
  // 8. SPECIFIC LOCATION QUERIES (NEW - if street address available)
  // ============================================================================
  if (street) {
    queries.push(
      { property_id: propertyId, text: `Apartments near ${street}`, type: 'local', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
    )
  }

  // ============================================================================
  // 9. VOICE SEARCH QUERIES (Improved - 4-6 queries)
  // Make voice search queries more specific
  // ============================================================================
  queries.push(
    { property_id: propertyId, text: `How do I apply to ${propertyName}?`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
    { property_id: propertyId, text: `What amenities does ${propertyName} have?`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Tell me about ${propertyName}`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
  )

  // Add specific voice queries if amenities available
  if (amenities.length > 0) {
    const topAmenity = amenities[0].toLowerCase()
    queries.push({
      property_id: propertyId,
      text: `Where can I find apartments in ${neighborhood} with ${topAmenity}?`,
      type: 'voice_search',
      geo: cityState,
      weight: 1.2,
      run_count: 1,
      is_active: true,
    })
  } else {
    queries.push({
      property_id: propertyId,
      text: `Where can I find apartments in ${neighborhood}?`,
      type: 'voice_search',
      geo: cityState,
      weight: 1.1,
      run_count: 1,
      is_active: true,
    })
  }

  return queries
}

/**
 * Generate amenity combination queries
 * Creates long-tail queries with 2-3 amenity combinations
 */
function generateAmenityCombinations(
  amenities: string[],
  neighborhood: string,
  city: string,
  propertyId: string,
  cityState: string
): Array<{
  property_id: string
  text: string
  type: string
  geo: string
  weight: number
  run_count: number
  is_active: boolean
}> {
  const combos: Array<{ text: string; weight: number }> = []
  
  // Normalize amenity names
  const normalized = amenities.map(a => a.toLowerCase())
  
  // Common amenity keywords for better query construction
  const amenityMap: Record<string, string> = {
    pool: 'pool',
    'swimming pool': 'pool',
    gym: 'fitness center',
    fitness: 'fitness center',
    'fitness center': 'fitness center',
    pet: 'pet-friendly',
    dog: 'dog-friendly',
    'pet friendly': 'pet-friendly',
    'dog park': 'dog park',
    parking: 'parking',
    garage: 'garage parking',
    rooftop: 'rooftop',
    'rooftop deck': 'rooftop deck',
    coworking: 'coworking space',
    'ev charging': 'EV charging',
    'electric vehicle': 'EV charging',
    concierge: 'concierge',
    'smart home': 'smart home technology',
    spa: 'spa',
    'package locker': 'package lockers',
    'bike storage': 'bike storage',
  }

  // Extract key amenities
  const keyAmenities: string[] = []
  for (const amenity of normalized) {
    for (const [key, value] of Object.entries(amenityMap)) {
      if (amenity.includes(key) && !keyAmenities.includes(value)) {
        keyAmenities.push(value)
        break
      }
    }
  }

  // Generate 2-amenity combinations
  if (keyAmenities.length >= 2) {
    for (let i = 0; i < Math.min(keyAmenities.length - 1, 3); i++) {
      for (let j = i + 1; j < Math.min(keyAmenities.length, 4); j++) {
        combos.push({
          text: `Apartments with ${keyAmenities[i]} and ${keyAmenities[j]} in ${neighborhood}`,
          weight: 1.4,
        })
        
        if (combos.length >= 6) break
      }
      if (combos.length >= 6) break
    }
  }

  // Generate 3-amenity combinations if we have room
  if (keyAmenities.length >= 3 && combos.length < 4) {
    for (let i = 0; i < Math.min(keyAmenities.length - 2, 2); i++) {
      combos.push({
        text: `${neighborhood} apartments with ${keyAmenities[i]}, ${keyAmenities[i + 1]}, and ${keyAmenities[i + 2]}`,
        weight: 1.5, // Higher weight - very specific
      })
    }
  }

  // If we have nearby landmarks or special features, add those
  if (keyAmenities.length > 0) {
    combos.push({
      text: `Modern apartments near ${neighborhood} with ${keyAmenities[0]}`,
      weight: 1.3,
    })
  }

  // Convert to full query objects (run_count included for type compatibility)
  return combos.slice(0, 6).map(combo => ({
    property_id: propertyId,
    text: combo.text,
    type: 'category' as const,
    geo: cityState,
    weight: combo.weight,
    run_count: 1,
    is_active: true,
  }))
}

/**
 * Generate query from USP
 * Converts brand USP into searchable query
 */
function generateUSPQuery(usp: string, city: string, neighborhood: string): string | null {
  const lowerUSP = usp.toLowerCase()
  
  // Extract key features from USP
  if (lowerUSP.includes('sustainable') || lowerUSP.includes('green') || lowerUSP.includes('solar')) {
    return `Sustainable green apartments in ${neighborhood} with solar power`
  }
  if (lowerUSP.includes('luxury') || lowerUSP.includes('premium') || lowerUSP.includes('high-end')) {
    return `Premium luxury apartments in ${neighborhood}`
  }
  if (lowerUSP.includes('tech') || lowerUSP.includes('smart home') || lowerUSP.includes('automation')) {
    return `Apartments with smart home technology in ${neighborhood}`
  }
  if (lowerUSP.includes('walkable') || lowerUSP.includes('walk score')) {
    return `Walkable apartments in ${neighborhood} near shops and dining`
  }
  if (lowerUSP.includes('view') || lowerUSP.includes('scenic')) {
    return `Apartments with views in ${neighborhood}`
  }
  if (lowerUSP.includes('resort') || lowerUSP.includes('amenity')) {
    return `Resort-style apartments in ${neighborhood}`
  }
  if (lowerUSP.includes('community') || lowerUSP.includes('social')) {
    return `Apartments with strong community in ${neighborhood}`
  }
  
  // Generic fallback - try to extract key terms
  const words = usp.split(' ').filter(w => w.length > 4)
  if (words.length > 0) {
    return `${words[0]} apartments in ${neighborhood}`
  }
  
  return null
}

/**
 * Extract persona types from target audience
 */
function extractPersonas(targetAudience: string | string[]): string[] {
  const audienceText = Array.isArray(targetAudience) 
    ? targetAudience.join(' ') 
    : targetAudience
  
  const personas: string[] = []
  const lowerText = audienceText.toLowerCase()
  
  // Common persona patterns
  const personaPatterns = [
    { pattern: /young professional/i, persona: 'young professionals' },
    { pattern: /remote worker/i, persona: 'remote workers' },
    { pattern: /graduate student/i, persona: 'graduate students' },
    { pattern: /family|families/i, persona: 'families' },
    { pattern: /tech worker/i, persona: 'tech workers' },
    { pattern: /military/i, persona: 'military personnel' },
    { pattern: /retiree/i, persona: 'retirees' },
    { pattern: /empty nester/i, persona: 'empty nesters' },
    { pattern: /millennial/i, persona: 'millennials' },
    { pattern: /gen z/i, persona: 'Gen Z renters' },
  ]

  for (const { pattern, persona } of personaPatterns) {
    if (pattern.test(lowerText)) {
      personas.push(persona)
    }
  }

  // Fallback personas if none detected
  if (personas.length === 0) {
    personas.push('young professionals', 'families')
  }

  return personas.slice(0, 3)
}

/**
 * OLD FUNCTION - keeping for reference but not called
 * This is what was causing generic aggregator-dominated queries
 */
function generateOldGenericQueries(city: string, cityState: string) {
  // These queries naturally favor aggregator sites:
  return [
    `Top rated apartments ${cityState}`,      // Aggregators dominate
    `Luxury apartments ${city}`,              // Aggregators dominate
    `Best places to rent in ${city}`,         // Aggregators dominate
  ]
}

// Format query for API response
function formatQuery(query: Record<string, unknown>): GeoQuery {
  return {
    id: query.id as string,
    propertyId: query.property_id as string,
    text: query.text as string,
    type: query.type as GeoQuery['type'],
    geo: query.geo as string | null,
    weight: query.weight as number,
    runCount: (query.run_count as number) || 1,
    isActive: query.is_active as boolean,
    createdAt: query.created_at as string,
    updatedAt: query.updated_at as string,
  }
}

