import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { Database } from '@/types/supabase'

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  google_analytics: 'Google Analytics',
  google_search_console: 'Google Search Console',
  google_tag_manager: 'Google Tag Manager',
  google_ads: 'Google Ads',
  google_business_profile: 'Google Business Profile',
  meta_ads: 'Meta Ads',
  linkedin_ads: 'LinkedIn Ads',
  tiktok_ads: 'TikTok Ads',
  email_marketing: 'Email Marketing',
  crm: 'CRM',
  pms: 'Property Management System',
}

type IntegrationCredentialRow = Database['public']['Tables']['integration_credentials']['Row']

type IntegrationReadiness = {
  mode: 'verified_state' | 'manual_unverified'
  ready: boolean
  blockers: string[]
  checkedAt: string
}

const AD_ACCOUNT_PLATFORMS = ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasUsableCredentials(credentials: unknown): boolean {
  if (!isRecord(credentials)) {
    return false
  }
  return Object.values(credentials).some((entry) => {
    if (typeof entry === 'string') {
      return entry.trim().length > 0
    }
    return entry !== null && entry !== undefined
  })
}

function getReadinessFromCredentialState(
  integration: IntegrationCredentialRow,
  context: {
    emailConfigHealthy: boolean | null
    pmsCalendarHealthy: boolean | null
    adConnectionHealthByPlatform: Record<string, boolean>
  }
): IntegrationReadiness {
  const checkedAt = new Date().toISOString()

  if (integration.platform === 'crm') {
    const blockers: string[] = []
    if (!hasUsableCredentials(integration.credentials)) {
      blockers.push('missing_credentials')
    }
    if (!integration.mapping_validated) {
      blockers.push('mapping_not_validated')
    }
    return {
      mode: 'verified_state',
      ready: blockers.length === 0,
      blockers,
      checkedAt,
    }
  }

  if (integration.platform === 'email_marketing') {
    const isHealthy = context.emailConfigHealthy === true
    return {
      mode: 'verified_state',
      ready: isHealthy,
      blockers: isHealthy ? [] : ['email_token_not_healthy'],
      checkedAt,
    }
  }

  if (integration.platform === 'pms') {
    const isHealthy = context.pmsCalendarHealthy === true
    return {
      mode: 'verified_state',
      ready: isHealthy,
      blockers: isHealthy ? [] : ['calendar_token_not_healthy'],
      checkedAt,
    }
  }

  if (AD_ACCOUNT_PLATFORMS.includes(integration.platform as (typeof AD_ACCOUNT_PLATFORMS)[number])) {
    const isHealthy = context.adConnectionHealthByPlatform[integration.platform] === true
    return {
      mode: 'verified_state',
      ready: isHealthy,
      blockers: isHealthy ? [] : ['ad_account_not_connected_or_unhealthy'],
      checkedAt,
    }
  }

  return {
    mode: 'manual_unverified',
    ready: integration.status === 'verified' || integration.status === 'connected',
    blockers: [],
    checkedAt,
  }
}

function deriveEffectiveStatus(
  currentStatus: string | null,
  readiness: IntegrationReadiness
): string {
  if (readiness.mode !== 'verified_state') {
    return currentStatus || 'pending'
  }

  if (readiness.ready) {
    return 'verified'
  }

  if (currentStatus === 'pending' || currentStatus === 'requested') {
    return currentStatus
  }

  return 'error'
}

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

    const { data: integrations, error } = await adminClient
      .from('integration_credentials')
      .select('*')
      .eq('property_id', propertyId)
      .order('platform', { ascending: true })

    if (error) {
      console.error('Error fetching integrations:', error)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    const integrationRows = integrations || []
    const platformSet = new Set(integrationRows.map((integration) => integration.platform))

    const [emailConfig, pmsCalendar, adConnections] = await Promise.all([
      platformSet.has('email_marketing')
        ? adminClient
            .from('email_configurations')
            .select('token_status, sync_enabled')
            .eq('property_id', propertyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      platformSet.has('pms')
        ? adminClient
            .from('agent_calendars')
            .select('token_status, sync_enabled, calendar_id')
            .eq('property_id', propertyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      AD_ACCOUNT_PLATFORMS.some((platform) => platformSet.has(platform))
        ? adminClient
            .from('ad_account_connections')
            .select('platform, is_active, error_count, last_error')
            .eq('property_id', propertyId)
            .in('platform', [...AD_ACCOUNT_PLATFORMS])
        : Promise.resolve({ data: [], error: null }),
    ])

    if (emailConfig.error || pmsCalendar.error || adConnections.error) {
      const verifyError = emailConfig.error || pmsCalendar.error || adConnections.error
      console.error('Error verifying integration readiness:', verifyError)
      return NextResponse.json({ error: 'Failed to verify integration readiness' }, { status: 500 })
    }

    const emailConfigHealthy = Boolean(
      emailConfig.data &&
      emailConfig.data.sync_enabled === true &&
      emailConfig.data.token_status === 'healthy'
    )
    const pmsCalendarHealthy = Boolean(
      pmsCalendar.data &&
      pmsCalendar.data.sync_enabled === true &&
      pmsCalendar.data.token_status === 'healthy' &&
      typeof pmsCalendar.data.calendar_id === 'string' &&
      pmsCalendar.data.calendar_id.length > 0
    )
    const adConnectionHealthByPlatform: Record<string, boolean> = {}
    for (const adConnection of adConnections.data || []) {
      adConnectionHealthByPlatform[adConnection.platform] = Boolean(
        adConnection.is_active &&
        (adConnection.error_count ?? 0) === 0 &&
        !adConnection.last_error
      )
    }

    // Add display names and verified readiness so downstream consumers don't rely on manual status bookkeeping.
    const enrichedIntegrations = integrationRows.map((integration) => {
      const readiness = getReadinessFromCredentialState(integration, {
        emailConfigHealthy,
        pmsCalendarHealthy,
        adConnectionHealthByPlatform,
      })
      return {
        ...integration,
        status: deriveEffectiveStatus(integration.status, readiness),
        statusSource: readiness.mode,
        readiness,
        displayName: PLATFORM_DISPLAY_NAMES[integration.platform] || integration.platform,
      }
    })

    return NextResponse.json({ integrations: enrichedIntegrations })
  } catch (error) {
    console.error('Integrations fetch error:', error)
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
    const { propertyId, integration } = body

    if (!propertyId || !integration?.platform) {
      return NextResponse.json({ error: 'propertyId and integration.platform are required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Upsert integration
    const { data, error } = await adminClient
      .from('integration_credentials')
      .upsert({
        property_id: propertyId,
        platform: integration.platform,
        account_id: integration.accountId || null,
        account_name: integration.accountName || null,
        access_type: integration.accessType || null,
        status: integration.status || 'pending',
        notes: integration.notes || null,
      }, {
        onConflict: 'property_id,platform',
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving integration:', error)
      return NextResponse.json({ error: 'Failed to save integration' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      integration: {
        ...data,
        displayName: PLATFORM_DISPLAY_NAMES[data.platform] || data.platform,
      },
    })
  } catch (error) {
    console.error('Integration save error:', error)
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
    const { integrationId, status, notes, accountId, accountName, lastError } = body

    if (!integrationId) {
      return NextResponse.json({ error: 'integrationId is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: existingIntegration, error: existingIntegrationError } = await adminClient
      .from('integration_credentials')
      .select('id, property_id')
      .eq('id', integrationId)
      .single()

    if (existingIntegrationError || !existingIntegration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    if (typeof existingIntegration.property_id !== 'string') {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingIntegration.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {}
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes
    if (accountId !== undefined) updates.account_id = accountId
    if (accountName !== undefined) updates.account_name = accountName
    if (lastError !== undefined) updates.last_error = lastError
    
    if (status === 'verified' || status === 'connected') {
      updates.verified_at = new Date().toISOString()
    }

    const { data, error } = await adminClient
      .from('integration_credentials')
      .update(updates)
      .eq('id', integrationId)
      .select()
      .single()

    if (error) {
      console.error('Error updating integration:', error)
      return NextResponse.json({ error: 'Failed to update integration' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      integration: {
        ...data,
        displayName: PLATFORM_DISPLAY_NAMES[data.platform] || data.platform,
      },
    })
  } catch (error) {
    console.error('Integration update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

