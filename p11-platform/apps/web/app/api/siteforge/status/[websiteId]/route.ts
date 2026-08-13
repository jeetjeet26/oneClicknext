// SiteForge: Website Status API
// GET /api/siteforge/status/[websiteId]
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import type { WebsiteStatusResponse } from '@/types/siteforge'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasCloudwaysProviderCredentials } from '@/utils/siteforge/providers/cloudways-provider'

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

    const { data: sharedJob } = await serviceSupabase
      .from('shared_jobs')
      .select(
        'id, domain, lifecycle_status, workflow_run_id, stage, progress, current_step, retry_at, cancel_requested, attempt_count, max_attempts, error_message'
      )
      .in('domain', [
        'siteforge.generation',
        'siteforge.deployment',
        'siteforge.production-certification',
        'siteforge.preview',
        'siteforge.semantic_edit',
      ])
      .in(
        'subject_id',
        [
          website.id,
          website.current_artifact_version_id,
          website.staging_artifact_id,
          website.production_artifact_id,
        ].filter((value): value is string => typeof value === 'string')
      )
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const status = sharedJob
      ? mapSharedJobStatus(sharedJob.lifecycle_status, website.generation_status)
      : (website.generation_status ?? 'queued') as WebsiteStatusResponse['status']
    const progress = sharedJob
      ? sharedJob.progress
      : typeof website.generation_progress === 'number'
        ? website.generation_progress
        : 0
    const deploymentDiagnostics = extractDeploymentDiagnostics(website.generation_input)

    const response: WebsiteStatusResponse = {
      websiteId: website.id,
      jobId: sharedJob?.id,
      workflowRunId: sharedJob?.workflow_run_id ?? undefined,
      lifecycleStatus: sharedJob?.lifecycle_status as WebsiteStatusResponse['lifecycleStatus'],
      retryAt: sharedJob?.retry_at ?? undefined,
      cancelRequested: sharedJob?.cancel_requested,
      attemptCount: sharedJob?.attempt_count,
      maxAttempts: sharedJob?.max_attempts,
      status,
      progress,
      currentStep: sharedJob?.current_step || website.current_step || undefined,
      errorMessage: sharedJob?.error_message || website.error_message || undefined,
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

function mapSharedJobStatus(
  lifecycleStatus: string,
  websiteStatus: string | null
): WebsiteStatusResponse['status'] {
  if (lifecycleStatus === 'succeeded') {
    return websiteStatus === 'complete' ? 'complete' : 'ready_for_preview'
  }
  if (lifecycleStatus === 'failed' || lifecycleStatus === 'cancelled') {
    return 'failed'
  }
  return (websiteStatus || 'queued') as WebsiteStatusResponse['status']
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

  if (hasExistingWp) {
    return {
      ready: false,
      mode: 'existing_wordpress',
      blockers: [
        'The staging and audited launch-release route currently requires a Cloudways application identity.',
      ],
    }
  }

  return {
    ready: false,
    mode: 'unconfigured',
    blockers: ['missing_wordpress_provider_credentials'],
  }
}


















