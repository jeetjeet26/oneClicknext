/**
 * MarketVision 360 - Semantic Search API
 * Search across competitor content using natural language
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

export interface SemanticSearchResult {
  id: string
  competitorId: string
  competitorName: string
  pageUrl: string
  pageType: string
  content: string
  similarity: number
}

// POST: Semantic search across competitor content
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { query, propertyId, competitorIds, limit = 10 } = body

    if (!query) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine for semantic search
    const response = await fetch(`${DATA_ENGINE_URL}/scraper/brand-intelligence/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        property_id: propertyId || null,
        competitor_ids: competitorIds || null,
        limit
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Data engine error:', errorText)
      return NextResponse.json({ 
        error: 'Semantic search failed',
        details: errorText
      }, { status: 502 })
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      query: result.query,
      count: result.count || 0,
      results: (result.results || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        competitorId: r.competitor_id,
        competitorName: r.competitor_name,
        pageUrl: r.page_url,
        pageType: r.page_type,
        content: r.content,
        similarity: r.similarity
      }))
    })
  } catch (error) {
    console.error('Semantic Search Error:', error)
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        error: 'Search service unavailable',
        details: 'The data-engine service is not running'
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

