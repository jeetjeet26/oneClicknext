// SiteForge: Website Status API
// GET /api/siteforge/status/[websiteId]
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import type { WebsiteStatusResponse } from '@/types/siteforge'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

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

    // Get website with property check
    const { data: website, error } = await serviceSupabase
      .from('property_websites')
      .select('*')
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

    const status = (website.generation_status ?? 'queued') as WebsiteStatusResponse['status']
    const progress = typeof website.generation_progress === 'number' ? website.generation_progress : 0
    const deploymentDiagnostics = extractDeploymentDiagnostics(website.generation_input)

    const response: WebsiteStatusResponse = {
      websiteId: website.id,
      status,
      progress,
      currentStep: website.current_step ?? undefined,
      errorMessage: website.error_message ?? undefined,
      brandReadiness: getBrandReadiness(website.brand_source, website.brand_confidence),
      deploymentReadiness: getDeploymentReadiness(),
      siteArchitecture: website.site_architecture
        ? (website.site_architecture as unknown as WebsiteStatusResponse['siteArchitecture'])
        : undefined,
      wpUrl: website.wp_url ?? undefined,
      wpAdminUrl: website.wp_admin_url ?? undefined,
      deploymentDiagnostics
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Website status error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
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


















