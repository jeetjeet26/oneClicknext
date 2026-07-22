/**
 * MarketVision 360 - Monitoring configuration
 * GET/PUT the per-property scrape_config (cadence, radius, comp-set policy).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { Database } from '@/types/supabase'

type ScrapeConfigUpsert = Database['public']['Tables']['scrape_config']['Insert']

const ALLOWED_FREQUENCIES = ['daily', 'weekly', 'manual'] as const

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: config } = await supabase
      .from('scrape_config')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle()

    return NextResponse.json({ config: config ?? null })
  } catch (error) {
    console.error('MarketVision Config GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, isEnabled, scrapeFrequency, radiusMiles, maxCompetitors, autoAdd } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const update: ScrapeConfigUpsert = { property_id: propertyId }

    if (typeof isEnabled === 'boolean') update.is_enabled = isEnabled
    if (typeof scrapeFrequency === 'string') {
      if (!ALLOWED_FREQUENCIES.includes(scrapeFrequency as (typeof ALLOWED_FREQUENCIES)[number])) {
        return NextResponse.json(
          { error: `scrapeFrequency must be one of ${ALLOWED_FREQUENCIES.join(', ')}` },
          { status: 400 }
        )
      }
      update.scrape_frequency = scrapeFrequency
    }
    if (typeof radiusMiles === 'number') {
      if (radiusMiles < 0.5 || radiusMiles > 25) {
        return NextResponse.json({ error: 'radiusMiles must be between 0.5 and 25' }, { status: 400 })
      }
      update.radius_miles = radiusMiles
    }
    if (typeof maxCompetitors === 'number') {
      if (maxCompetitors < 1 || maxCompetitors > 100) {
        return NextResponse.json({ error: 'maxCompetitors must be between 1 and 100' }, { status: 400 })
      }
      update.max_competitors = maxCompetitors
    }
    if (typeof autoAdd === 'boolean') update.auto_add = autoAdd

    const { data: config, error } = await supabase
      .from('scrape_config')
      .upsert(update, { onConflict: 'property_id' })
      .select()
      .single()

    if (error) {
      console.error('Error updating scrape config:', error)
      return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true, config })
  } catch (error) {
    console.error('MarketVision Config PUT Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
