// SiteForge: Website Preview API
// GET /api/siteforge/preview/[websiteId]
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { makeBlueprintFromPages } from '@/utils/siteforge/blueprint'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import type { GeneratedPage, WebsiteStatusResponse } from '@/types/siteforge'
import { hasCloudwaysProviderCredentials } from '@/utils/siteforge/providers/cloudways-provider'

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
    const service = createServiceClient()
    const { data: website, error } = await service
      .from('property_websites')
      .select(`
        *,
        properties!property_websites_property_id_fkey (
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

    const { data: currentArtifact } = website.current_artifact_version_id
      ? await service
          .from('siteforge_blueprint_versions')
          .select('id, version, blueprint, asset_manifest, created_at')
          .eq('id', website.current_artifact_version_id)
          .eq('website_id', website.id)
          .maybeSingle()
      : { data: null }

    // Current previews consume the immutable artifact. Legacy records are only
    // adapted when no artifact has been published yet.
    let siteBlueprint = (currentArtifact?.blueprint || website.blueprint) as unknown as {
      pages?: GeneratedPage[]
      designSystem?: {
        colorSystem?: Record<string, unknown>
        typography?: Record<string, unknown>
        spacing?: Record<string, unknown>
      }
    } | null
    let siteBlueprintVersion: number | null =
      currentArtifact?.version || (siteBlueprint ? 1 : null)
    let siteBlueprintUpdatedAt: string | null =
      currentArtifact?.created_at || null

    if (!siteBlueprint && Array.isArray(website.pages_generated) && website.pages_generated.length > 0) {
      try {
        const blueprint = makeBlueprintFromPages(website.pages_generated as unknown as GeneratedPage[], 1)
        siteBlueprint = blueprint as unknown as typeof siteBlueprint
        siteBlueprintVersion = 1
        siteBlueprintUpdatedAt = blueprint.updatedAt ?? null
      } catch (e) {
        console.warn('Failed to adapt legacy blueprint (non-fatal):', e)
      }
    }

    const { data: artifactHistory } = await service
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, content_hash, parent_version_id, change_type, changes_summary, quality_score, quality_report, created_at, deployment_decision, deployment_approved_at'
      )
      .eq('website_id', websiteId)
      .order('version', { ascending: false })

    const response = {
      websiteId: website.id,
      property: website.properties,
      generationStatus: website.generation_status,
      brandSource: website.brand_source,
      brandConfidence: website.brand_confidence,
      brandReadiness: getBrandReadiness(website.brand_source, website.brand_confidence),
      deploymentReadiness: getDeploymentReadiness(
        Boolean(website.wordpress_credential_ref)
      ),
      siteArchitecture: website.site_architecture,
      designSystem: siteBlueprint?.designSystem
        ? {
            ...siteBlueprint.designSystem,
            colors: siteBlueprint.designSystem.colorSystem,
          }
        : undefined,
      siteBlueprint,
      siteBlueprintVersion,
      siteBlueprintUpdatedAt,
      pagesGenerated: siteBlueprint?.pages || (website.pages_generated as unknown as GeneratedPage[]) || [],
      assets: currentArtifact?.asset_manifest || [],
      artifact: {
        currentId: website.current_artifact_version_id,
        canonicalPreviewUrl: website.canonical_preview_url,
        canonicalPreviewArtifactId: website.canonical_preview_artifact_id,
        canonicalPreviewContentHash: website.canonical_preview_content_hash,
        deployedArtifactId: website.deployed_artifact_version_id,
        deployedContentHash: website.deployed_content_hash,
        history: artifactHistory || [],
      },
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

function getDeploymentReadiness(
  hasCredentialReference = false
): WebsiteStatusResponse['deploymentReadiness'] {
  const hasCloudways = hasCloudwaysProviderCredentials()
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

  if (hasExistingWp || hasCredentialReference) {
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







