/**
 * PropertyAudit Queries API
 * Manage query panels for GEO tracking
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { Database } from '@/types/supabase'
import {
  aggregateAnswersByQuery,
  type ReportAnswer,
  type ReportQuery,
} from '@/utils/propertyaudit/reporting'
import {
  normalizeSeedKeywords,
  type PropertyAuditSeedKeyword,
} from '@/utils/propertyaudit/seed-keywords'
import { getPropertyTypeConfig } from '@/utils/property-types'
import { retrieveCompetitorKbContext } from '@/utils/services/competitor-kb'

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

const QUERY_TYPES = new Set<GeoQuery['type']>([
  'branded',
  'category',
  'comparison',
  'local',
  'faq',
  'voice_search',
])

function isValidQueryType(value: string): value is GeoQuery['type'] {
  return QUERY_TYPES.has(value as GeoQuery['type'])
}

type GeoQueryInsert = Database['public']['Tables']['geo_queries']['Insert']
type PropertyAuditQueryClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>

function capitalizeForPrompt(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (type && !isValidQueryType(type)) {
      return NextResponse.json({ error: 'Invalid query type filter' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    let query = serviceClient
      .from('geo_queries')
      .select('*')
      .eq('property_id', propertyId)
      .order('type', { ascending: true })
      .order('created_at', { ascending: true })

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    if (type && isValidQueryType(type)) {
      query = query.eq('type', type)
    }

    const { data: queries, error } = await query

    if (error) {
      console.error('Error fetching queries:', error)
      return NextResponse.json({ error: 'Failed to fetch queries' }, { status: 500 })
    }

    // Fetch latest answers for performance data if requested
    const answersMap = new Map<string, ReportAnswer>()
    if (includePerformance && queries && queries.length > 0) {
      // Get latest completed runs for this property
      const { data: latestRuns } = await serviceClient
        .from('geo_runs')
        .select('id')
        .eq('property_id', propertyId)
        .eq('status', 'completed')
        .order('started_at', { ascending: false })
        .limit(2)

      if (latestRuns && latestRuns.length > 0) {
        const runIds = latestRuns.map(r => r.id)
        
        // Fetch answers for these runs
        const { data: answers } = await serviceClient
          .from('geo_answers')
          .select('query_id, presence, llm_rank, link_rank, sov, flags, created_at, geo_queries (id, text, type)')
          .in('run_id', runIds)

        const aggregated = aggregateAnswersByQuery(
          (answers || []) as unknown as ReportAnswer[],
          (queries || []) as unknown as ReportQuery[],
          new Map()
        )
        aggregated.forEach(answer => {
          const queryId = answer.query_id
          if (!queryId) return
          if (!answersMap.has(queryId)) {
            answersMap.set(queryId, answer)
          }
        })
      }
    }

    // Fetch AI Overview visibility data (for ALL property queries, independent of runs)
    const aiOverviewMap = new Map<string, { visible: boolean; sourceUrl?: string | null }>()
    if (includePerformance) {
      // Fetch all AI Overview data for this property, not limited to specific query IDs
      // This allows AI Overview visibility to work independently of historical audit runs
      const { data: aiOverviews } = await serviceClient
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
          presenceRate: answer.presence_rate,
          citationConsistency: answer.citation_consistency,
          answerDrift: answer.answer_drift,
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
    const { propertyId, query, queries, generateFromProperty, seedKeywords } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceClient()

    // Generate query panel from property data
    if (generateFromProperty) {
      const queries = await generateQueryPanel(
        serviceClient,
        propertyId,
        normalizeSeedKeywords(seedKeywords, { limit: 20 })
      )
      
      // Insert all generated queries
      const { data: insertedQueries, error: insertError } = await serviceClient
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

    // Bulk create client-authored queries
    if (Array.isArray(queries) && queries.length > 0) {
      const inserts = queries
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter(
          (entry): entry is { text: string; type: GeoQuery['type']; geo?: string | null; weight?: number; runCount?: number } =>
            typeof entry.text === 'string' &&
            entry.text.trim().length > 0 &&
            typeof entry.type === 'string' &&
            isValidQueryType(entry.type)
        )
        .map(entry => ({
          property_id: propertyId,
          text: entry.text.trim(),
          type: entry.type,
          geo: entry.geo || null,
          weight: entry.weight || 1,
          run_count: Math.max(1, Math.min(5, Number(entry.runCount) || 1)),
          is_active: true,
        }))

      if (inserts.length === 0) {
        return NextResponse.json({ error: 'No valid queries supplied' }, { status: 400 })
      }

      const { data: insertedQueries, error: insertError } = await serviceClient
        .from('geo_queries')
        .insert(inserts)
        .select()

      if (insertError) {
        console.error('Error inserting client queries:', insertError)
        return NextResponse.json({ error: 'Failed to create queries' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        created: insertedQueries?.length || 0,
        queries: insertedQueries?.map(formatQuery) || [],
      })
    }

    // Create single query
    if (query) {
      const { data: newQuery, error: insertError } = await serviceClient
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

    const serviceClient = createServiceClient()

    const { data: existingQuery, error: queryError } = await serviceClient
      .from('geo_queries')
      .select('property_id')
      .eq('id', queryId)
      .single()

    if (queryError || !existingQuery) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingQuery.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await serviceClient
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
async function generateQueryPanel(
  supabase: PropertyAuditQueryClient,
  propertyId: string,
  seedKeywords: PropertyAuditSeedKeyword[] = []
): Promise<GeoQueryInsert[]> {
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

  // Fetch competitors from MarketVision. Intake-enriched competitors are ranked first
  // when brand intelligence confidence is available.
  const { data: competitors } = await supabase
    .from('competitors')
    .select('id,name,is_active,brand_intel:competitor_brand_intelligence(confidence_score,last_analyzed_at)')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .limit(10)

  // Fetch BrandForge data for USPs (optional)
  const { data: brandData } = await supabase
    .from('brand_books')
    .select('unique_selling_points')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const propertyName = property.name
  const amenities = property.amenities || []
  const specialFeatures = property.special_features || []
  const propertyTypeConfig = getPropertyTypeConfig(property.property_type)
  const propertyType = propertyTypeConfig.searchNouns[0]
  const secondaryPropertyType = propertyTypeConfig.searchNouns[1] || propertyType
  const tertiaryPropertyType = propertyTypeConfig.searchNouns[2] || secondaryPropertyType
  const displayNoun = propertyTypeConfig.displayNoun
  const pluralDisplayNoun = propertyTypeConfig.pluralDisplayNoun
  const isForSaleResidential = propertyTypeConfig.isForSaleResidential
  const topAmenityCombos = amenities.length >= 2
    ? generateAmenityCombinations(amenities, neighborhood, propertyId, cityState, propertyType).slice(0, 2)
    : []
  const uspQueries = Array.isArray(brandData?.unique_selling_points)
    ? brandData.unique_selling_points
        .filter((usp): usp is string => typeof usp === 'string' && usp.trim().length > 0)
        .map(usp => generateUSPQuery(usp, neighborhood, propertyType))
        .filter((query): query is string => typeof query === 'string' && query.length > 0)
        .slice(0, 2)
    : []
  const featureQueries = specialFeatures.length > 0
    ? generateSpecialFeatureQueries(specialFeatures, neighborhood, propertyId, cityState, propertyType).slice(0, 2)
    : []
  const topSeedTheme = seedKeywords.slice(0, 5).map(seed => seed.keyword).join(', ')
  const competitorKbContext = await retrieveCompetitorKbContext({
    propertyId,
    query: topSeedTheme
      ? `competitor positioning and comparison targets for ${propertyName} in ${cityState}; keyword themes: ${topSeedTheme}`
      : `competitor positioning and comparison targets for ${propertyName} in ${cityState}`,
    matchCount: 12,
  })
  const structuredComparisonTargets = (competitors || [])
    .map(entry => {
      const brandIntel = Array.isArray(entry.brand_intel)
        ? entry.brand_intel[0]
        : entry.brand_intel
      return {
        name: entry.name,
        confidence: Number(brandIntel?.confidence_score ?? 0),
        analyzedAt: brandIntel?.last_analyzed_at ? Date.parse(brandIntel.last_analyzed_at) : 0,
      }
    })
    .filter((entry): entry is { name: string; confidence: number; analyzedAt: number } =>
      typeof entry.name === 'string' && entry.name.length > 0
    )
    .sort((a, b) => (b.confidence - a.confidence) || (b.analyzedAt - a.analyzedAt))
    .map(entry => entry.name)
  const comparisonTargets = Array.from(new Set([
    ...structuredComparisonTargets,
    ...competitorKbContext.competitorNames,
  ])).slice(0, 5)
  const seedPrompts = buildSeedKeywordPrompts({
    seeds: seedKeywords,
    propertyId,
    city,
    cityState,
    neighborhood,
    propertyType,
    pluralDisplayNoun,
    enrichedCompetitorNames: comparisonTargets,
  })
  const amenityAndUspPrompts = [
    ...topAmenityCombos,
    ...uspQueries.map(text => ({
      property_id: propertyId,
      text,
      type: 'category' as const,
      geo: cityState,
      weight: 1.4,
      run_count: 1,
      is_active: true,
    })),
    ...featureQueries,
    {
      property_id: propertyId,
      text: `${capitalizeForPrompt(pluralDisplayNoun)} with premium amenities in ${neighborhood}`,
      type: 'category' as const,
      geo: cityState,
      weight: 1.3,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: `${capitalizeForPrompt(pluralDisplayNoun)} with modern features in ${neighborhood}`,
      type: 'category' as const,
      geo: cityState,
      weight: 1.3,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: `Amenity-rich ${pluralDisplayNoun} in ${cityState}`,
      type: 'category' as const,
      geo: cityState,
      weight: 1.2,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: `${capitalizeForPrompt(pluralDisplayNoun)} with standout amenities in ${neighborhood}`,
      type: 'category' as const,
      geo: cityState,
      weight: 1.2,
      run_count: 1,
      is_active: true,
    },
  ]

  const generated: GeoQueryInsert[] = [
    // 4 branded prompts
    { property_id: propertyId, text: `What is ${propertyName}?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Is ${propertyName} a good place to live?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${propertyName} reviews`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${propertyName} ${displayNoun}`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },

    // Category / consideration prompts. Seeded panels reserve room for top
    // keyword-derived discovery prompts without crowding out comparisons.
    { property_id: propertyId, text: `Best ${propertyType} in ${city}`, type: 'category', geo: cityState, weight: 0.8, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Best ${propertyType} in ${neighborhood}`, type: 'category', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Modern ${secondaryPropertyType} in ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
    { property_id: propertyId, text: `Luxury ${propertyType} near ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
    ...(seedPrompts.length > 0
      ? seedPrompts.slice(0, 3)
      : [
          { property_id: propertyId, text: `Top rated ${tertiaryPropertyType} in ${cityState}`, type: 'category' as const, geo: cityState, weight: 1.0, run_count: 1, is_active: true },
          { property_id: propertyId, text: `${secondaryPropertyType} near ${street || neighborhood}`, type: 'category' as const, geo: cityState, weight: 1.1, run_count: 1, is_active: true },
        ]),

    // Amenity / USP prompts
    ...amenityAndUspPrompts.slice(0, seedPrompts.length > 0 ? 3 : 4),

    // 3 local-intent prompts
    { property_id: propertyId, text: `Best place to live in ${neighborhood}`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
    { property_id: propertyId, text: `${neighborhood} ${pluralDisplayNoun}`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
    { property_id: propertyId, text: isForSaleResidential ? `Moving to ${neighborhood} - new home recommendations` : `Moving to ${neighborhood} - apartment recommendations`, type: 'local', geo: cityState, weight: 1.2, run_count: 1, is_active: true },

    // 3 comparison prompts
    ...buildComparisonPrompts(propertyId, propertyName, comparisonTargets, cityState, neighborhood, pluralDisplayNoun, propertyType),

    // 2 decision-stage prompts
    { property_id: propertyId, text: `How much does it cost to live at ${propertyName}?`, type: 'faq', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
    { property_id: propertyId, text: isForSaleResidential ? `How do I buy at ${propertyName}?` : `How do I apply to ${propertyName}?`, type: 'faq', geo: cityState, weight: 1.2, run_count: 1, is_active: true },

    // 2 support / voice-style prompts
    { property_id: propertyId, text: `Tell me about ${propertyName}`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
    { property_id: propertyId, text: `What amenities does ${propertyName} have?`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
  ]

  const deduped = new Map<string, GeoQueryInsert>()
  for (const generatedQuery of generated) {
    const key = generatedQuery.text.trim().toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, generatedQuery)
    }
  }

  const fallbackAmenityOrFeature = amenityAndUspPrompts

  for (const queryText of uspQueries.slice(2)) {
    if (deduped.size >= 24) break
    deduped.set(queryText.toLowerCase(), {
      property_id: propertyId,
      text: queryText,
      type: 'category',
      geo: cityState,
      weight: 1.4,
      run_count: 1,
      is_active: true,
    })
  }

  for (const generatedQuery of seedPrompts.slice(3)) {
    if (deduped.size >= 24) break
    deduped.set(generatedQuery.text.toLowerCase(), generatedQuery)
  }

  for (const generatedQuery of fallbackAmenityOrFeature) {
    if (deduped.size >= 24) break
    deduped.set(generatedQuery.text.toLowerCase(), generatedQuery)
  }

  const finalFallbacks: GeoQueryInsert[] = [
    {
      property_id: propertyId,
      text: `${propertyName} pricing`,
      type: 'faq',
      geo: cityState,
      weight: 1.1,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: isForSaleResidential ? `${propertyName} purchase process` : `${propertyName} application process`,
      type: 'faq',
      geo: cityState,
      weight: 1.1,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: isForSaleResidential ? `Best ${propertyType} in ${cityState}` : `Best apartments for renters in ${cityState}`,
      type: 'category',
      geo: cityState,
      weight: 1.0,
      run_count: 1,
      is_active: true,
    },
    {
      property_id: propertyId,
      text: isForSaleResidential ? `Where should I buy a new home in ${neighborhood}?` : `Where should I rent in ${neighborhood}?`,
      type: 'voice_search',
      geo: cityState,
      weight: 1.1,
      run_count: 1,
      is_active: true,
    },
  ]

  for (const generatedQuery of finalFallbacks) {
    if (deduped.size >= 24) break
    deduped.set(generatedQuery.text.toLowerCase(), generatedQuery)
  }

  return Array.from(deduped.values()).slice(0, 24)
}

function buildSeedKeywordPrompts(args: {
  seeds: PropertyAuditSeedKeyword[]
  propertyId: string
  city: string
  cityState: string
  neighborhood: string
  propertyType: string
  pluralDisplayNoun: string
  enrichedCompetitorNames: string[]
}): GeoQueryInsert[] {
  const competitorNameFragments = args.enrichedCompetitorNames
    .map(name => name.toLowerCase().trim())
    .filter(name => name.length >= 3)

  const prompts: GeoQueryInsert[] = []
  for (const seed of args.seeds) {
    const keyword = seed.keyword.trim()
    const keywordLower = keyword.toLowerCase()
    if (!keyword) continue
    if (competitorNameFragments.some(name => keywordLower.includes(name))) {
      continue
    }

    const hasLocalIntent =
      keywordLower.includes('near me') ||
      keywordLower.includes(args.city.toLowerCase()) ||
      keywordLower.includes(args.neighborhood.toLowerCase())
    const hasPropertyType =
      keywordLower.includes(args.propertyType.toLowerCase()) ||
      keywordLower.includes(args.pluralDisplayNoun.toLowerCase())

    prompts.push({
      property_id: args.propertyId,
      text: hasPropertyType || hasLocalIntent ? keyword : `${keyword} ${args.pluralDisplayNoun}`,
      type: hasLocalIntent ? 'local' : 'category',
      geo: args.cityState,
      weight: seed.score > 0 ? 1.45 : 1.25,
      run_count: 1,
      is_active: true,
    })
  }

  const deduped = new Map<string, GeoQueryInsert>()
  for (const prompt of prompts) {
    deduped.set(prompt.text.toLowerCase(), prompt)
    if (deduped.size >= 8) break
  }

  return Array.from(deduped.values())
}

function buildComparisonPrompts(
  propertyId: string,
  propertyName: string,
  competitors: string[],
  cityState: string,
  neighborhood: string,
  pluralDisplayNoun: string,
  primarySearchTerm: string
): GeoQueryInsert[] {
  const prompts = competitors.slice(0, 3).map((competitor) => ({
    property_id: propertyId,
    text: `${propertyName} vs ${competitor}`,
    type: 'comparison' as const,
    geo: cityState,
    weight: 1.3,
    run_count: 1,
    is_active: true,
  }))

  while (prompts.length < 3) {
    const fallbackText =
      prompts.length === 0
        ? `${propertyName} vs ${primarySearchTerm} in ${neighborhood}`
        : prompts.length === 1
          ? `${propertyName} vs luxury ${primarySearchTerm} in ${cityState}`
          : `${propertyName} vs nearby ${pluralDisplayNoun}`
    prompts.push({
      property_id: propertyId,
      text: fallbackText,
      type: 'comparison',
      geo: cityState,
      weight: 1.2,
      run_count: 1,
      is_active: true,
    })
  }

  return prompts
}

/**
 * Generate amenity combination queries
 * Creates long-tail queries with 2-3 amenity combinations
 */
function generateAmenityCombinations(
  amenities: string[],
  neighborhood: string,
  propertyId: string,
  cityState: string,
  primarySearchTerm: string
): GeoQueryInsert[] {
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
          text: `${capitalizeForPrompt(primarySearchTerm)} with ${keyAmenities[i]} and ${keyAmenities[j]} in ${neighborhood}`,
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
        text: `${neighborhood} ${primarySearchTerm} with ${keyAmenities[i]}, ${keyAmenities[i + 1]}, and ${keyAmenities[i + 2]}`,
        weight: 1.5, // Higher weight - very specific
      })
    }
  }

  // If we have nearby landmarks or special features, add those
  if (keyAmenities.length > 0) {
    combos.push({
      text: `Modern ${primarySearchTerm} near ${neighborhood} with ${keyAmenities[0]}`,
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

function generateSpecialFeatureQueries(
  specialFeatures: string[],
  neighborhood: string,
  propertyId: string,
  cityState: string,
  primarySearchTerm: string
): GeoQueryInsert[] {
  const normalizedFeatures = specialFeatures
    .filter((feature): feature is string => typeof feature === 'string' && feature.trim().length > 0)
    .slice(0, 3)

  return normalizedFeatures.map((feature) => ({
    property_id: propertyId,
    text: `${capitalizeForPrompt(primarySearchTerm)} in ${neighborhood} with ${feature}`,
    type: 'category' as const,
    geo: cityState,
    weight: 1.4,
    run_count: 1,
    is_active: true,
  }))
}

/**
 * Generate query from USP
 * Converts brand USP into searchable query
 */
function generateUSPQuery(usp: string, neighborhood: string, primarySearchTerm: string): string | null {
  const lowerUSP = usp.toLowerCase()
  
  // Extract key features from USP
  if (lowerUSP.includes('sustainable') || lowerUSP.includes('green') || lowerUSP.includes('solar')) {
    return `Sustainable green ${primarySearchTerm} in ${neighborhood} with solar power`
  }
  if (lowerUSP.includes('luxury') || lowerUSP.includes('premium') || lowerUSP.includes('high-end')) {
    return `Premium luxury ${primarySearchTerm} in ${neighborhood}`
  }
  if (lowerUSP.includes('tech') || lowerUSP.includes('smart home') || lowerUSP.includes('automation')) {
    return `${capitalizeForPrompt(primarySearchTerm)} with smart home technology in ${neighborhood}`
  }
  if (lowerUSP.includes('walkable') || lowerUSP.includes('walk score')) {
    return `Walkable ${primarySearchTerm} in ${neighborhood} near shops and dining`
  }
  if (lowerUSP.includes('view') || lowerUSP.includes('scenic')) {
    return `${capitalizeForPrompt(primarySearchTerm)} with views in ${neighborhood}`
  }
  if (lowerUSP.includes('resort') || lowerUSP.includes('amenity')) {
    return `Resort-style ${primarySearchTerm} in ${neighborhood}`
  }
  if (lowerUSP.includes('community') || lowerUSP.includes('social')) {
    return `${capitalizeForPrompt(primarySearchTerm)} with strong community in ${neighborhood}`
  }
  
  // Generic fallback - try to extract key terms
  const words = usp.split(' ').filter(w => w.length > 4)
  if (words.length > 0) {
    return `${words[0]} ${primarySearchTerm} in ${neighborhood}`
  }
  
  return null
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

