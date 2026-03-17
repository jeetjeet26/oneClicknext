// SiteForge: Deploy Website to WordPress API
// POST /api/siteforge/deploy/[websiteId]
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  deployToExistingWordPress,
  deployToWordPress,
  type DeploymentProgressReporter,
} from '@/utils/siteforge/wordpress-client'
import { getPropertyContext } from '@/utils/siteforge/brand-intelligence'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import type { GeneratedPage, SiteArchitecture, WebsiteAsset } from '@/types/siteforge'
import type { Json } from '@/types/supabase'

type DeploymentWebsite = {
  property_id: string
  blueprint?: { pages?: GeneratedPage[]; version?: number; updatedAt?: string } | null
  pages_generated?: GeneratedPage[] | null
  site_blueprint_version?: number | null
  site_blueprint_updated_at?: string | null
  version?: number | null
  site_architecture?: Partial<SiteArchitecture> | null
  generation_input?: Json | null
}

type DeploymentErrorCategory = 'verification' | 'configuration' | 'provisioning' | 'unknown'

type DeploymentDiagnostics = {
  workflow: 'siteforge_wordpress_deploy'
  status: 'success' | 'failed'
  provider: 'cloudways' | 'existing_wordpress' | 'local_simulation'
  startedAt: string
  completedAt: string
  pagesAttempted: number
  assetsAttempted: number
  verification: {
    enabled: true
    status: 'passed' | 'failed'
    message?: string
  }
  target?: {
    url: string
    adminUrl: string
    instanceId: string
  }
  deploySource: {
    field: 'blueprint' | 'pages_generated'
    blueprintVersion: number | null
    blueprintUpdatedAt: string | null
  }
  error?: {
    message: string
    category: DeploymentErrorCategory
  }
}

type DeployAsyncOptions = {
  localSimulation?: boolean
}

function resolveDeploySource(
  website: DeploymentWebsite
): {
  pages: GeneratedPage[]
  source: DeploymentDiagnostics['deploySource']
} {
  const blueprintPages = Array.isArray(website.blueprint?.pages)
    ? website.blueprint.pages
    : []

  if (blueprintPages.length > 0) {
    const normalizedVersion =
      website.site_blueprint_version ??
      website.version ??
      website.blueprint?.version ??
      null
    const normalizedUpdatedAt =
      website.site_blueprint_updated_at ??
      website.blueprint?.updatedAt ??
      null
    return {
      pages: blueprintPages,
      source: {
        field: 'blueprint',
        blueprintVersion: normalizedVersion,
        blueprintUpdatedAt: normalizedUpdatedAt,
      },
    }
  }

  const legacyPages = Array.isArray(website.pages_generated) ? website.pages_generated : []
  return {
    pages: legacyPages,
    source: {
      field: 'pages_generated',
      blueprintVersion: null,
      blueprintUpdatedAt: null,
    },
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/deploy/[websiteId]')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { websiteId } = await params

    if (!websiteId) {
      ctx.logSuccess(400, { reason: 'missing_website_id' })
      return badRequest('websiteId required', ctx.responseHeaders)
    }

    // Get website with property check
    const { data: website, error } = await serviceSupabase
      .from('property_websites')
      .select('*')
      .eq('id', websiteId)
      .single()

    if (error || !website) {
      ctx.logSuccess(404, { reason: 'website_not_found', websiteId })
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    if (typeof website.property_id !== 'string') {
      ctx.logSuccess(400, { reason: 'invalid_website_property_mapping', websiteId })
      return badRequest('Website property mapping is invalid', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, {
        reason: 'forbidden_property_access',
        websiteId,
        propertyId: website.property_id,
        userId: user.id,
      })
      return forbidden(ctx.responseHeaders)
    }

    // Check if website is ready for deployment
    if (website.generation_status !== 'ready_for_preview' && website.generation_status !== 'complete') {
      ctx.logSuccess(400, { reason: 'website_not_ready_for_deploy', websiteId })
      return badRequest('Website must be ready for preview before deploying', ctx.responseHeaders)
    }

    // Check if already deployed
    if (website.wp_url) {
      ctx.logSuccess(400, { reason: 'website_already_deployed', websiteId })
      return NextResponse.json(
        {
          error: 'Website already deployed',
          wpUrl: website.wp_url,
          wpAdminUrl: website.wp_admin_url,
        },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    // Deployment options:
    // A) Cloudways provision + deploy (requires CLOUDWAYS_API_KEY + CLOUDWAYS_EMAIL)
    // B) Deploy to an existing WordPress instance (requires SITEFORGE_WP_URL + SITEFORGE_WP_USERNAME + SITEFORGE_WP_APP_PASSWORD)
    const cloudwaysApiKey = process.env.CLOUDWAYS_API_KEY
    const cloudwaysEmail = process.env.CLOUDWAYS_EMAIL
    const wpUrl = process.env.SITEFORGE_WP_URL
    const wpUsername = process.env.SITEFORGE_WP_USERNAME
    const wpAppPassword = process.env.SITEFORGE_WP_APP_PASSWORD

    const hasCloudways = Boolean(cloudwaysApiKey && cloudwaysEmail)
    const hasExistingWp = Boolean(wpUrl && wpUsername && wpAppPassword)
    const localSimulationRequested = new URL(request.url).searchParams.get('simulate') === '1'
    const localSimulationEnabled =
      localSimulationRequested && process.env.NODE_ENV !== 'production'

    if (!hasCloudways && !hasExistingWp && !localSimulationEnabled) {
      ctx.logSuccess(400, { reason: 'missing_wordpress_deploy_config', websiteId })
      return NextResponse.json(
        {
          error:
            'WordPress deployment requires either Cloudways credentials (CLOUDWAYS_API_KEY + CLOUDWAYS_EMAIL) or an existing WP target (SITEFORGE_WP_URL + SITEFORGE_WP_USERNAME + SITEFORGE_WP_APP_PASSWORD).',
          requiresConfig: true,
          localSimulationHint:
            'For deterministic local smoke only, append ?simulate=1 while running in non-production.'
        },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    // Update status to deploying
    const { pages: deployPages, source: deploySource } = resolveDeploySource(website as DeploymentWebsite)

    if (deployPages.length === 0) {
      ctx.logSuccess(400, { reason: 'no_pages_available_for_deploy', websiteId })
      return badRequest('Website has no pages available to deploy', ctx.responseHeaders)
    }

    await serviceSupabase
      .from('property_websites')
      .update({
        generation_status: 'deploying',
        current_step:
          deploySource.field === 'blueprint'
            ? `Deploying edited blueprint (v${deploySource.blueprintVersion ?? 'unknown'}) to WordPress...`
            : 'Deploying legacy generated pages to WordPress...'
      })
      .eq('id', websiteId)

    // Start deployment in background
    deployToWordPressAsync(
      websiteId,
      {
        ...(website as DeploymentWebsite),
        blueprint: deploySource.field === 'blueprint' ? (website as DeploymentWebsite).blueprint : null,
        pages_generated: deployPages,
      },
      { localSimulation: localSimulationEnabled }
    ).catch(error => {
      console.error('Deployment error:', error)
    })

    ctx.logSuccess(200, { websiteId, status: 'deploying' })
    return NextResponse.json(
      {
        status: 'deploying',
        message: 'Deployment started. This may take a few minutes.',
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'siteforge_deploy_start' })
    return serverError(error, ctx.responseHeaders)
  }
}

/**
 * Background WordPress deployment process
 * Uses service client since this runs after HTTP response is sent
 */
export async function deployToWordPressAsync(
  websiteId: string,
  website: DeploymentWebsite,
  options: DeployAsyncOptions = {}
) {
  // Use service client for background tasks (no request context available)
  const supabase = createServiceClient()
  
  const startedAt = new Date().toISOString()
  const deploySource = resolveDeploySource(website)
  let pagesAttempted = deploySource.pages.length
  let assetsAttempted = 0
  const localSimulation = options.localSimulation === true
  const provider: DeploymentDiagnostics['provider'] = localSimulation
    ? 'local_simulation'
    : resolveDeploymentProvider()
  let lastProgressStep = ''
  let lastProgressAt = 0

  try {
    const cloudwaysApiKey = process.env.CLOUDWAYS_API_KEY
    const cloudwaysEmail = process.env.CLOUDWAYS_EMAIL
    const wpUrl = process.env.SITEFORGE_WP_URL
    const wpUsername = process.env.SITEFORGE_WP_USERNAME
    const wpAppPassword = process.env.SITEFORGE_WP_APP_PASSWORD

    // Load assets for this website
    const { data: assets } = await supabase
      .from('website_assets')
      .select('*')
      .eq('website_id', websiteId)

    // Determine deploy source explicitly (edited blueprint preferred, legacy fallback explicit).
    const pages = deploySource.pages
    const normalizedAssets = (assets || []) as unknown as WebsiteAsset[]
    pagesAttempted = pages.length
    assetsAttempted = normalizedAssets.length
    const architecture = {
      pages,
      navigation: website.site_architecture?.navigation,
      designDecisions: website.site_architecture?.designDecisions,
    } as unknown as SiteArchitecture

    const progressReporter: DeploymentProgressReporter = async step => {
      const now = Date.now()
      if (step === lastProgressStep && now - lastProgressAt < 15_000) {
        return
      }
      lastProgressStep = step
      lastProgressAt = now
      await supabase
        .from('property_websites')
        .update({ current_step: step })
        .eq('id', websiteId)
    }

    let instance: Awaited<ReturnType<typeof deployToWordPress>>
    if (localSimulation) {
      const baseUrl = getLocalSimulationBaseUrl()
      instance = {
        instanceId: `local-sim-${websiteId.slice(0, 8)}`,
        url: `${baseUrl}/siteforge/preview/${websiteId}`,
        adminUrl: `${baseUrl}/siteforge/preview/${websiteId}`,
        credentials: {
          username: 'local-simulation',
          password: 'local-simulation',
        },
      }
    } else if (cloudwaysApiKey && cloudwaysEmail) {
      // Get property context (for naming/settings)
      await progressReporter('Loading property context for Cloudways provisioning...')
      const propertyContext = await getPropertyContext(website.property_id)
      // Provision + deploy through Cloudways + WordPress API orchestration
      instance = await runWithTimeout(
        deployToWordPress(
          architecture,
          propertyContext,
          normalizedAssets,
          { apiKey: cloudwaysApiKey, email: cloudwaysEmail },
          { onProgress: progressReporter }
        ),
        getDeploymentTimeoutMs(),
        'SiteForge deployment timed out while provisioning/deploying to Cloudways'
      )
    } else if (wpUrl && wpUsername && wpAppPassword) {
      // Get property context (for naming/settings)
      await progressReporter('Loading property context for existing WordPress deployment...')
      const propertyContext = await getPropertyContext(website.property_id)
      instance = await runWithTimeout(
        deployToExistingWordPress({
          wpUrl,
          credentials: { username: wpUsername, password: wpAppPassword },
          pages,
          propertyContext,
          assets: normalizedAssets,
          onProgress: progressReporter,
        }),
        getDeploymentTimeoutMs(),
        'SiteForge deployment timed out while deploying to existing WordPress'
      )
    } else {
      throw new Error('No deployment credentials configured')
    }

    const diagnostics: DeploymentDiagnostics = {
      workflow: 'siteforge_wordpress_deploy',
      status: 'success',
      provider,
      startedAt,
      completedAt: new Date().toISOString(),
      pagesAttempted,
      assetsAttempted,
      verification: {
        enabled: true,
        status: 'passed',
        message: localSimulation
          ? 'Deployment verified in deterministic local simulation mode.'
          : undefined,
      },
      target: {
        url: instance.url,
        adminUrl: instance.adminUrl,
        instanceId: instance.instanceId,
      },
      deploySource: deploySource.source,
    }

    // Mark as complete
    await supabase
      .from('property_websites')
      .update({
        generation_status: 'complete',
        current_step: `Deployment complete (verified ${pagesAttempted} pages, ${assetsAttempted} assets).`,
        error_message: null,
        wp_url: instance.url,
        wp_admin_url: instance.adminUrl,
        wp_instance_id: instance.instanceId,
        wp_credentials: instance.credentials,
        deployed_at: diagnostics.completedAt,
        generation_input: mergeDeploymentDiagnostics(
          website.generation_input,
          diagnostics
        ),
      })
      .eq('id', websiteId)
      
  } catch (error) {
    console.error('WordPress deployment error:', error)
    const message =
      error instanceof Error ? error.message : 'Deployment failed'
    const diagnostics: DeploymentDiagnostics = {
      workflow: 'siteforge_wordpress_deploy',
      status: 'failed',
      provider,
      startedAt,
      completedAt: new Date().toISOString(),
      pagesAttempted,
      assetsAttempted,
      verification: {
        enabled: true,
        status: classifyDeploymentErrorCategory(message) === 'verification' ? 'failed' : 'passed',
      },
      deploySource: deploySource.source,
      error: {
        message,
        category: classifyDeploymentErrorCategory(message),
      },
    }

    await supabase
      .from('property_websites')
      .update({
        generation_status: 'deploy_failed',
        current_step: diagnostics.error?.category === 'verification'
          ? 'Deployment failed during verification'
          : 'Deployment failed',
        error_message: message,
        generation_input: mergeDeploymentDiagnostics(
          website.generation_input,
          diagnostics
        ),
      })
      .eq('id', websiteId)
  }
}

function mergeDeploymentDiagnostics(
  existingGenerationInput: DeploymentWebsite['generation_input'],
  diagnostics: DeploymentDiagnostics
): Json {
  const base =
    existingGenerationInput &&
    typeof existingGenerationInput === 'object' &&
    !Array.isArray(existingGenerationInput)
      ? (existingGenerationInput as { [key: string]: Json | undefined })
      : {}

  return {
    ...base,
    deploymentDiagnostics: diagnostics as unknown as Json,
  }
}

function resolveDeploymentProvider(): DeploymentDiagnostics['provider'] {
  return process.env.CLOUDWAYS_API_KEY && process.env.CLOUDWAYS_EMAIL
    ? 'cloudways'
    : 'existing_wordpress'
}

function getLocalSimulationBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    'http://127.0.0.1:3000'
  )
}

function getDeploymentTimeoutMs(): number {
  const parsed = Number(process.env.SITEFORGE_DEPLOY_TIMEOUT_MS || 2_700_000)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_700_000
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    promise
      .then(value => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(value)
      })
      .catch(error => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        reject(error)
      })
  })
}

function classifyDeploymentErrorCategory(
  message: string
): DeploymentErrorCategory {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('verification failed') ||
    normalized.includes('did not become ready') ||
    normalized.includes('missing required wordpress namespaces') ||
    normalized.includes('missing published pages')
  ) {
    return 'verification'
  }
  if (
    normalized.includes('requires either cloudways credentials') ||
    normalized.includes('no deployment credentials configured')
  ) {
    return 'configuration'
  }
  if (normalized.includes('cloudways') || normalized.includes('operation')) {
    return 'provisioning'
  }
  return 'unknown'
}







