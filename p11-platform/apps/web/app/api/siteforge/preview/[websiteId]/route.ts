// SiteForge: Website Preview API
// GET /api/siteforge/preview/[websiteId]
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { makeBlueprintFromPages } from '@/utils/siteforge/blueprint'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { GeneratedPage, WebsiteStatusResponse } from '@/types/siteforge'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { websiteId } = await params

    if (!websiteId) {
      return NextResponse.json({ error: 'websiteId required' }, { status: 400 })
    }

    // Get website with full details
    const { data: website, error } = await supabase
      .from('property_websites')
      .select(`
        *,
        properties!inner (
          id,
          name,
          org_id,
          address
        )
      `)
      .eq('id', websiteId)
      .single()

    if (error || !website) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 })
    }

    if (typeof website.property_id !== 'string') {
      return NextResponse.json({ error: 'Website property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Backfill blueprint for older records (best-effort)
    let siteBlueprint = website.blueprint as unknown as { pages?: GeneratedPage[] } | null
    let siteBlueprintVersion: number | null = siteBlueprint ? 1 : null
    let siteBlueprintUpdatedAt: string | null = null

    if (!siteBlueprint && Array.isArray(website.pages_generated) && website.pages_generated.length > 0) {
      try {
        const blueprint = makeBlueprintFromPages(website.pages_generated as unknown as GeneratedPage[], 1)
        const updatePayload = {
          blueprint,
          pages_generated: blueprint.pages
        }
        await supabase
          .from('property_websites')
          .update(updatePayload as never)
          .eq('id', websiteId)
        siteBlueprint = blueprint
        siteBlueprintVersion = 1
        siteBlueprintUpdatedAt = blueprint.updatedAt ?? null
      } catch (e) {
        console.warn('Failed to backfill blueprint (non-fatal):', e)
      }
    }

    // Get assets
    const { data: assets } = await supabase
      .from('website_assets')
      .select('*')
      .eq('website_id', websiteId)

    const response = {
      websiteId: website.id,
      property: website.properties,
      generationStatus: website.generation_status,
      brandSource: website.brand_source,
      brandConfidence: website.brand_confidence,
      brandReadiness: getBrandReadiness(website.brand_source, website.brand_confidence),
      deploymentReadiness: getDeploymentReadiness(),
      siteArchitecture: website.site_architecture,
      siteBlueprint,
      siteBlueprintVersion,
      siteBlueprintUpdatedAt,
      pagesGenerated: siteBlueprint?.pages || (website.pages_generated as unknown as GeneratedPage[]) || [],
      assets: assets || [],
      deploymentDiagnostics: extractDeploymentDiagnostics(website.generation_input),
      wpUrl: website.wp_url,
      wpAdminUrl: website.wp_admin_url,
      createdAt: website.created_at,
      completedAt: website.generation_completed_at
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Website preview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get preview' },
      { status: 500 }
    )
  }
}

function extractDeploymentDiagnostics(
  generationInput: unknown
): WebsiteStatusResponse['deploymentDiagnostics'] | undefined {
  if (!generationInput || typeof generationInput !== 'object' || Array.isArray(generationInput)) {
    return undefined
  }

  const diagnostics = (generationInput as Record<string, unknown>).deploymentDiagnostics
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    return undefined
  }

  return diagnostics as WebsiteStatusResponse['deploymentDiagnostics']
}

function getBrandReadiness(
  brandSource: unknown,
  brandConfidence: unknown
): WebsiteStatusResponse['brandReadiness'] {
  const source = typeof brandSource === 'string' ? brandSource : null
  const confidence = typeof brandConfidence === 'number' ? brandConfidence : null
  const blockers: string[] = []

  if (!source) {
    blockers.push('missing_brand_source')
  } else if (source === 'generated') {
    blockers.push('generated_fallback_brand_context')
  }

  if (confidence === null) {
    blockers.push('missing_brand_confidence')
  } else if (confidence < 0.6) {
    blockers.push('low_brand_confidence')
  }

  return {
    degraded: blockers.length > 0,
    source,
    confidence,
    blockers,
  }
}

function getDeploymentReadiness(): WebsiteStatusResponse['deploymentReadiness'] {
  const hasCloudways = Boolean(process.env.CLOUDWAYS_API_KEY && process.env.CLOUDWAYS_EMAIL)
  const hasExistingWp = Boolean(
    process.env.SITEFORGE_WP_URL &&
      process.env.SITEFORGE_WP_USERNAME &&
      process.env.SITEFORGE_WP_APP_PASSWORD
  )

  if (hasCloudways) {
    return {
      ready: true,
      mode: 'cloudways',
      blockers: [],
    }
  }

  if (hasExistingWp) {
    return {
      ready: true,
      mode: 'existing_wordpress',
      blockers: [],
    }
  }

  return {
    ready: false,
    mode: 'unconfigured',
    blockers: ['missing_wordpress_provider_credentials'],
  }
}







