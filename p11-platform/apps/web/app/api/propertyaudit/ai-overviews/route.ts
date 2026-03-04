/**
 * PropertyAudit AI Overviews Visibility API
 * Stores and retrieves AI Overview visibility signals (automated ingestion).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('geo_ai_overviews')
      .select('query_id, visible, source_url, observed_at')
      .eq('property_id', propertyId)
      .order('observed_at', { ascending: false })

    if (error) {
      console.error('Error fetching AI Overviews:', error)
      return NextResponse.json({ error: 'Failed to fetch AI Overviews' }, { status: 500 })
    }

    const latestByQuery = new Map<string, any>()
    ;(data || []).forEach(row => {
      if (!latestByQuery.has(row.query_id)) {
        latestByQuery.set(row.query_id, row)
      }
    })

    return NextResponse.json({
      success: true,
      data: Array.from(latestByQuery.values())
    })
  } catch (error) {
    console.error('AI Overviews GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, queryId, visible, sourceUrl, observedAt } = body

    if (!propertyId || !queryId) {
      return NextResponse.json({ error: 'propertyId and queryId required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('geo_ai_overviews')
      .insert({
        property_id: propertyId,
        query_id: queryId,
        visible: !!visible,
        source_url: sourceUrl || null,
        observed_at: observedAt || new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting AI Overviews:', error)
      return NextResponse.json({ error: 'Failed to insert AI Overviews' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('AI Overviews POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
