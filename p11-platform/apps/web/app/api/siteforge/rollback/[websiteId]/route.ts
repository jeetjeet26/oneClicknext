// SiteForge: Rollback Website API
// POST /api/siteforge/rollback/[websiteId]
// Restores the current website record to the previous saved version.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { Json } from '@/types/supabase'

type RollbackWebsiteRow = {
  id: string
  property_id: string
  version?: number | null
  blueprint?: Json | null
  site_architecture?: Json | null
  pages_generated?: Json | null
  assets_manifest?: Json | null
  brand_source?: string | null
  brand_confidence?: number | null
  user_preferences?: Json | null
  generation_input?: Json | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { websiteId } = await params
    if (!websiteId) {
      return NextResponse.json({ error: 'websiteId required' }, { status: 400 })
    }

    const { data: currentWebsite, error: currentError } = await serviceSupabase
      .from('property_websites')
      .select('id, property_id, version')
      .eq('id', websiteId)
      .single()

    if (currentError || !currentWebsite) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 })
    }

    if (typeof currentWebsite.property_id !== 'string') {
      return NextResponse.json({ error: 'Website property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, currentWebsite.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentVersion =
      typeof currentWebsite.version === 'number' ? currentWebsite.version : 1

    let previousQuery = serviceSupabase
      .from('property_websites')
      .select('id, version')
      .eq('property_id', currentWebsite.property_id)
      .neq('id', websiteId)

    if (typeof currentWebsite.version === 'number') {
      previousQuery = previousQuery.lt('version', currentWebsite.version)
    }

    const { data: previousCandidates, error: previousError } = await previousQuery
      .order('version', { ascending: false })
      .limit(1)

    if (previousError) {
      console.error('Rollback previous version lookup failed:', previousError)
      return NextResponse.json({ error: 'Failed to load rollback preview' }, { status: 500 })
    }

    const previousWebsite = previousCandidates?.[0] as RollbackWebsiteRow | undefined
    const targetVersion = previousWebsite
      ? (typeof previousWebsite.version === 'number'
          ? previousWebsite.version
          : currentVersion - 1)
      : null

    return NextResponse.json({
      canRollback: Boolean(previousWebsite),
      currentVersion,
      rollbackToVersion: targetVersion ?? undefined,
      rollbackToWebsiteId: previousWebsite?.id,
      message: previousWebsite
        ? `Rollback will restore version ${targetVersion}.`
        : 'No previous version is available for rollback.',
    })
  } catch (error) {
    console.error('Rollback preview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load rollback preview' },
      { status: 500 }
    )
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { websiteId } = await params
    if (!websiteId) {
      return NextResponse.json({ error: 'websiteId required' }, { status: 400 })
    }

    const { data: currentWebsite, error: currentError } = await serviceSupabase
      .from('property_websites')
      .select(
        'id, property_id, version, blueprint, site_architecture, pages_generated, assets_manifest, brand_source, brand_confidence, user_preferences, generation_input'
      )
      .eq('id', websiteId)
      .single()

    if (currentError || !currentWebsite) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 })
    }

    if (typeof currentWebsite.property_id !== 'string') {
      return NextResponse.json({ error: 'Website property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, currentWebsite.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentVersion =
      typeof currentWebsite.version === 'number' ? currentWebsite.version : 1

    let previousQuery = serviceSupabase
      .from('property_websites')
      .select(
        'id, version, blueprint, site_architecture, pages_generated, assets_manifest, brand_source, brand_confidence, user_preferences'
      )
      .eq('property_id', currentWebsite.property_id)
      .neq('id', websiteId)

    if (typeof currentWebsite.version === 'number') {
      previousQuery = previousQuery.lt('version', currentWebsite.version)
    }

    const { data: previousCandidates, error: previousError } = await previousQuery
      .order('version', { ascending: false })
      .limit(1)

    if (previousError) {
      console.error('Rollback previous version lookup failed:', previousError)
      return NextResponse.json({ error: 'Failed to load previous version' }, { status: 500 })
    }

    const previousWebsite = previousCandidates?.[0] as RollbackWebsiteRow | undefined
    if (!previousWebsite) {
      return NextResponse.json(
        { error: 'No previous version is available for rollback' },
        { status: 400 }
      )
    }

    const rollbackAt = new Date().toISOString()
    const rollbackMetadata = {
      action: 'rollback',
      fromWebsiteId: websiteId,
      toWebsiteId: previousWebsite.id,
      fromVersion: currentVersion,
      toVersion:
        typeof previousWebsite.version === 'number'
          ? previousWebsite.version
          : currentVersion - 1,
      rolledBackAt: rollbackAt,
    }

    const { error: updateError } = await serviceSupabase
      .from('property_websites')
      .update({
        blueprint: previousWebsite.blueprint ?? null,
        site_architecture: previousWebsite.site_architecture ?? null,
        pages_generated: previousWebsite.pages_generated ?? null,
        assets_manifest: previousWebsite.assets_manifest ?? null,
        brand_source: previousWebsite.brand_source ?? null,
        brand_confidence: previousWebsite.brand_confidence ?? null,
        user_preferences: previousWebsite.user_preferences ?? null,
        previous_version_id: previousWebsite.id,
        generation_status: 'ready_for_preview',
        generation_progress: 100,
        current_step: `Rolled back to version ${rollbackMetadata.toVersion}. Review and redeploy when ready.`,
        error_message: null,
        wp_url: null,
        wp_admin_url: null,
        wp_instance_id: null,
        wp_credentials: null,
        deployed_at: null,
        generation_input: mergeRollbackMetadata(currentWebsite.generation_input, rollbackMetadata),
        updated_at: rollbackAt,
      })
      .eq('id', websiteId)

    if (updateError) {
      console.error('Rollback update failed:', updateError)
      return NextResponse.json({ error: 'Failed to rollback website' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      rolledBackFromVersion: rollbackMetadata.fromVersion,
      rolledBackToVersion: rollbackMetadata.toVersion,
      rolledBackToWebsiteId: previousWebsite.id,
      message: `Rollback complete. Restored version ${rollbackMetadata.toVersion}.`,
    })
  } catch (error) {
    console.error('Rollback website error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rollback website' },
      { status: 500 }
    )
  }
}

function mergeRollbackMetadata(
  existingGenerationInput: Json | null | undefined,
  rollbackMetadata: Record<string, string | number>
): Json {
  const base =
    existingGenerationInput &&
    typeof existingGenerationInput === 'object' &&
    !Array.isArray(existingGenerationInput)
      ? (existingGenerationInput as { [key: string]: Json | undefined })
      : {}

  return {
    ...base,
    rollback: rollbackMetadata as unknown as Json,
  }
}
