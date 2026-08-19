import { FatalError } from 'workflow'
import type { GeneratedPage, SiteArchitecture } from '@/types/siteforge'
import type { Json, Tables, TablesUpdate } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  propertyContextFromOnboardingSnapshot,
  runtimePropertyProfile,
} from '@/utils/siteforge/property-context'
import { normalizeLegacyPages } from '@/utils/siteforge/blueprint'
import { mapWebsiteAssetRow } from '@/utils/siteforge/assets/repository'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  parseRenderableSiteForgeLegalConfig,
} from '@/utils/siteforge/quality/deterministic-gates'
import {
  getWordPressCredentialReference,
  storeWordPressCredentialReference,
} from '@/utils/siteforge/wordpress/credential-vault'
import {
  buildRenderedCertificationTruth,
  certifyRenderedWordPressArtifact,
  type RenderedCertificationReport,
} from '@/utils/siteforge/verification/rendered-certification'
import {
  CloudwaysProviderClient,
  getCloudwaysProviderCredentials,
  hasCloudwaysProviderCredentials,
} from '@/utils/siteforge/providers/cloudways-provider'
import { getConfiguredDnsProvider } from '@/utils/siteforge/providers/dns-provider'
import { loadSiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'
import { loadApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plan-repository'
import {
  deployToExistingWordPress,
  deployToWordPress,
  WordPressAPIClient,
  type DeploymentProgressReporter,
} from '@/utils/siteforge/wordpress-client'
import { brandForgeContractV1Schema } from '@/utils/brandforge/contracts'
import {
  loadVerifiedSiteForgeRelease,
  type VerifiedSiteForgeRelease,
} from '@/utils/siteforge/artifacts/release'
import { deployArtifactBoundRuntimeV3 } from '@/utils/siteforge/workflows/runtime-deployment-v3'
import { buildReleaseCertificationBinding } from '@/utils/siteforge/verification/certification-binding'

export type SiteForgeDeploymentWorkflowInput = {
  sharedJobId: string
  /** Historic siteforge_jobs row id; retained in old payloads, never written. */
  legacyJobId?: string
  websiteId: string
  propertyId: string
  artifactId: string
  contentHash: string
  approvalId: string
  localSimulation: boolean
  startedAt: string
}

type DeploymentWebsite = {
  property_id: string
  blueprint?: {
    pages?: GeneratedPage[]
    version?: number
    updatedAt?: string
    wordpressThemeArtifact?: unknown
    legal?: unknown
    propertySnapshot?: unknown
    brandSnapshot?: { contract?: unknown }
    analytics?: unknown
  } | null
  pages_generated?: GeneratedPage[] | null
  site_blueprint_version?: number | null
  site_blueprint_updated_at?: string | null
  version?: number | null
  site_architecture?: Partial<SiteArchitecture> | null
  generation_input?: Json | null
}

type DeploymentErrorCategory = 'verification' | 'configuration' | 'provisioning' | 'unknown'
type DeploymentProvider = 'cloudways' | 'existing_wordpress' | 'local_simulation'

type DeploymentDiagnostics = {
  workflow: 'siteforge_wordpress_deploy'
  status: 'success' | 'failed'
  provider: DeploymentProvider
  startedAt: string
  completedAt: string
  pagesAttempted: number
  assetsAttempted: number
  verification: {
    enabled: true
    status: 'passed' | 'failed'
    message?: string
  }
  certification?: RenderedCertificationReport | null
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function assertSiteForgeDeploymentActive(
  input: SiteForgeDeploymentWorkflowInput
): Promise<void> {
  'use step'

  console.info('[siteforge_deployment_workflow] checking cancellation', {
    sharedJobId: input.sharedJobId,
  })
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('shared_jobs')
    .select('lifecycle_status, cancel_requested, lease_owner')
    .eq('id', input.sharedJobId)
    .eq('domain', 'siteforge.deployment')
    .single()

  if (error || !data) {
    throw new FatalError(`Failed to load SiteForge deployment job: ${error?.message || 'not found'}`)
  }
  if (data.cancel_requested || data.lifecycle_status === 'cancelled') {
    throw new FatalError('SiteForge deployment was cancelled')
  }
  const leaseOwner = `siteforge-deployment:${input.sharedJobId}`
  if (data.lease_owner !== leaseOwner) {
    const now = new Date()
    const { data: claimed, error: claimError } = await supabase
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        lease_owner: leaseOwner,
        lease_expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        heartbeat_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.deployment')
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .is('lease_owner', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      throw new FatalError('SiteForge deployment is already claimed')
    }
  }
}

export async function updateSiteForgeDeploymentStage(
  input: SiteForgeDeploymentWorkflowInput,
  stage: string,
  progress: number,
  currentStep: string
): Promise<void> {
  'use step'

  console.info('[siteforge_deployment_workflow] stage started', {
    sharedJobId: input.sharedJobId,
    stage,
    progress,
  })
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const sharedUpdate: TablesUpdate<'shared_jobs'> = {
    lifecycle_status: 'running',
    status_reason: stage,
    stage,
    progress,
    current_step: currentStep,
    heartbeat_at: now,
    lease_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    started_at: progress === 5 ? now : undefined,
    error_message: null,
    error_details: null,
    updated_at: now,
  }
  const { error: sharedError } = await supabase
    .from('shared_jobs')
    .update(sharedUpdate)
    .eq('id', input.sharedJobId)
  if (sharedError) {
    throw new Error(`Failed to persist deployment stage: ${sharedError.message}`)
  }

  const { error: websiteError } = await supabase
    .from('property_websites')
    .update({
      generation_status: 'deploying',
      current_step: currentStep,
      error_message: null,
      updated_at: now,
    })
    .eq('id', input.websiteId)
  if (websiteError) {
    throw new Error(`Failed to persist compatibility website stage: ${websiteError.message}`)
  }
}

export async function runSiteForgeDeployment(
  input: SiteForgeDeploymentWorkflowInput
): Promise<{
  provider: DeploymentProvider
  url: string
  adminUrl: string
  instanceId: string
  pagesAttempted: number
  assetsAttempted: number
}> {
  'use step'

  console.info('[siteforge_deployment_workflow] deployment started', {
    sharedJobId: input.sharedJobId,
    websiteId: input.websiteId,
  })
  const supabase = createServiceClient()
  const startedAt = input.startedAt
  const { data: website, error: websiteError } = await supabase
    .from('property_websites')
    .select('*')
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .single()
  if (websiteError || !website) {
    throw new FatalError(`Deployment website not found: ${websiteError?.message || input.websiteId}`)
  }
  if (
    website.current_artifact_version_id !== input.artifactId ||
    website.canonical_preview_artifact_id !== input.artifactId ||
    website.canonical_preview_content_hash !== input.contentHash
  ) {
    throw new FatalError(
      'Deployment artifact changed after preview approval'
    )
  }
  const { data: approval, error: approvalError } = await supabase
    .from('siteforge_blueprint_versions')
    .select(
      'id, content_hash, deployment_decision, deployment_approved_at, confirmed_approval_id'
    )
    .eq('id', input.artifactId)
    .eq('content_hash', input.contentHash)
    .single()
  if (
    approvalError ||
    !approval ||
    approval.deployment_decision !== 'approved' ||
    approval.confirmed_approval_id !== input.approvalId ||
    !approval.deployment_approved_at
  ) {
    throw new FatalError(
      'Exact artifact deployment approval is missing or stale'
    )
  }
  const release = await loadVerifiedSiteForgeRelease(
    {
      artifactId: input.artifactId,
      websiteId: input.websiteId,
      propertyId: input.propertyId,
      orgId: website.org_id,
      contentHash: input.contentHash,
    },
    supabase
  )
  if (release.artifact.runtimeContractVersion === 3) {
    return runLegacyWorkflowThroughRuntimeV3(input, website, release, supabase)
  }

  const deploySource = resolveDeploySource(website as unknown as DeploymentWebsite)
  if (deploySource.pages.length === 0) {
    throw new FatalError('Website has no pages available to deploy')
  }
  if (!(website as unknown as DeploymentWebsite).blueprint?.wordpressThemeArtifact) {
    throw new FatalError(
      'Website is missing a validated WordPress theme artifact; regenerate before deployment'
    )
  }
  const themeArtifact = validateWordPressThemeArtifact(
    (website as unknown as DeploymentWebsite).blueprint?.wordpressThemeArtifact
  )
  const legal = parseRenderableSiteForgeLegalConfig(
    (website as unknown as DeploymentWebsite).blueprint?.legal
  )
  const analytics = siteForgeAnalyticsConfigSchema.parse(
    (website as unknown as DeploymentWebsite).blueprint?.analytics
  )
  const blueprint = (website as unknown as DeploymentWebsite).blueprint
  const propertyContext = propertyContextFromOnboardingSnapshot(
    blueprint?.propertySnapshot,
  )
  const brandContractResult = brandForgeContractV1Schema.safeParse(
    blueprint?.brandSnapshot?.contract,
  )
  const { data: assets, error: assetsError } = await supabase
    .from('website_assets')
    .select('*')
    .eq('website_id', input.websiteId)
  if (assetsError) {
    throw new Error(`Failed to load website assets: ${assetsError.message}`)
  }

  const normalizedAssets = (assets || []).map(mapWebsiteAssetRow)
  const floorPlanSnapshot = await loadApprovedFloorPlanSnapshot(
    input.propertyId,
    supabase
  )
  const approvedImageUrls = [
    ...(assets || []).flatMap((asset) =>
      [asset.file_url, asset.original_url].filter(
        (value): value is string => typeof value === 'string'
      )
    ),
    ...floorPlanSnapshot.rows.flatMap((row) =>
      row.imageUrl ? [row.imageUrl] : []
    ),
  ]
  const approvedImageDigests = (assets || []).flatMap((asset) => {
    const digest = asset.byte_sha256 || asset.content_hash
    return digest ? [digest] : []
  })
  const provider: DeploymentProvider = input.localSimulation
    ? 'local_simulation'
    : resolveDeploymentProvider()
  let lastProgressStep = ''
  let lastProgressAt = 0
  const progressReporter: DeploymentProgressReporter = async currentStep => {
    const nowMs = Date.now()
    if (currentStep === lastProgressStep && nowMs - lastProgressAt < 15_000) {
      return
    }
    lastProgressStep = currentStep
    lastProgressAt = nowMs
    const now = new Date(nowMs).toISOString()
    await Promise.all([
      supabase
        .from('shared_jobs')
        .update({
          stage: 'deploying',
          progress: 50,
          current_step: currentStep,
          heartbeat_at: now,
          lease_expires_at: new Date(nowMs + 15 * 60_000).toISOString(),
          updated_at: now,
        })
        .eq('id', input.sharedJobId),
      supabase
        .from('property_websites')
        .update({ current_step: currentStep, updated_at: now })
        .eq('id', input.websiteId),
    ])
  }

  let instance: Awaited<ReturnType<typeof deployToWordPress>>
  if (input.localSimulation) {
    const baseUrl = getLocalSimulationBaseUrl()
    instance = {
      instanceId: `local-sim-${input.websiteId.slice(0, 8)}`,
      url: `${baseUrl}/siteforge/preview/${input.websiteId}`,
      adminUrl: `${baseUrl}/siteforge/preview/${input.websiteId}`,
      credentials: {
        username: 'local-simulation',
        password: 'local-simulation',
      },
    }
  } else if (website.wordpress_credential_ref) {
    const stored = await getWordPressCredentialReference(
      website.wordpress_credential_ref
    )
    await progressReporter('Loading pinned property context for stored WordPress target...')
    instance = await runWithTimeout(
      deployToExistingWordPress({
        wpUrl: stored.url,
        credentials: {
          username: stored.username,
          password: stored.password,
        },
        pages: deploySource.pages,
        propertyContext,
        assets: normalizedAssets,
        contentHash: input.contentHash,
        onProgress: progressReporter,
      }),
      getDeploymentTimeoutMs(),
      'SiteForge deployment timed out while deploying to stored WordPress target'
    )
    instance.ssh = stored.ssh
    instance.providerMetadata = stored.providerMetadata
  } else if (hasCloudwaysProviderCredentials()) {
    throw new FatalError(
      'SITEFORGE_PROVIDER_IDEMPOTENCY_UNAVAILABLE: automatic Cloudways application provisioning is disabled until a durable provider idempotency key is supported'
    )
  } else if (
    process.env.SITEFORGE_WP_URL &&
    process.env.SITEFORGE_WP_USERNAME &&
    process.env.SITEFORGE_WP_APP_PASSWORD
  ) {
    await progressReporter('Loading pinned property context for existing WordPress deployment...')
    instance = await runWithTimeout(
      deployToExistingWordPress({
        wpUrl: process.env.SITEFORGE_WP_URL,
        credentials: {
          username: process.env.SITEFORGE_WP_USERNAME,
          password: process.env.SITEFORGE_WP_APP_PASSWORD,
        },
        pages: deploySource.pages,
        propertyContext,
        assets: normalizedAssets,
        contentHash: input.contentHash,
        onProgress: progressReporter,
      }),
      getDeploymentTimeoutMs(),
      'SiteForge deployment timed out while deploying to existing WordPress'
    )
  } else {
    throw new FatalError('No deployment credentials configured')
  }
  let certification: RenderedCertificationReport | null = null
  if (!input.localSimulation) {
    if (!website.wordpress_credential_ref) {
      await progressReporter('Storing encrypted WordPress credential reference...')
      await storeWordPressCredentialReference({
        websiteId: input.websiteId,
        credentials: {
          provider:
            hasCloudwaysProviderCredentials() ? 'cloudways' : 'wordpress',
          url: instance.url,
          username: instance.credentials.username,
          password: instance.credentials.password,
          ssh:
            instance.ssh?.password
              ? {
                  host: instance.ssh.host,
                  port: instance.ssh.port,
                  username: instance.ssh.username,
                  password: instance.ssh.password,
                  applicationRoot: instance.ssh.applicationRoot,
                }
              : undefined,
          providerMetadata: instance.providerMetadata,
        },
      })
    }
    await progressReporter('Applying validated SiteForge design tokens...')
    const publicRuntime = await loadSiteForgePublicRuntimeConfig(
      input.websiteId,
      input.propertyId,
      supabase
    )
    await new WordPressAPIClient(
      instance.url,
      instance.credentials,
      { onProgress: progressReporter }
    ).applySiteForgeSettings({
      themeArtifact,
      legal,
      analytics,
      propertyProfile: runtimePropertyProfile(propertyContext),
      publicRuntime,
    })
    await progressReporter('Certifying rendered WordPress output...')
    certification = await certifyRenderedWordPressArtifact({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      artifactBinding: buildReleaseCertificationBinding(release),
      editAcceptanceContract:
        release.artifact.editAcceptanceContract || undefined,
      targetUrl: instance.url,
      credentials: instance.credentials,
      pages: deploySource.pages,
      environment: 'staging',
      access: 'public',
      requireIndexable: false,
      brandContract: brandContractResult.success
        ? brandContractResult.data
        : undefined,
      ...buildRenderedCertificationTruth(
        blueprint?.propertySnapshot,
        approvedImageUrls,
        publicRuntime.conversionEndpoint,
        approvedImageDigests,
      ),
    })
    if (!certification.passed) {
      const blockers = certification.checks
        .filter((check) => !check.passed && check.severity === 'blocker')
        .map((check) => check.id)
      throw new FatalError(
        `Remote WordPress certification failed: ${blockers.join(', ')}`
      )
    }
    if (
      website.target_domain &&
      process.env.SITEFORGE_ENABLE_PRODUCTION_DOMAIN === '1'
    ) {
      const cloudwaysCredentials = getCloudwaysProviderCredentials()
      if (
        !instance.providerMetadata ||
        instance.providerMetadata.provider !== 'cloudways' ||
        !cloudwaysCredentials
      ) {
        throw new FatalError(
          'Cloudways metadata and API credentials are required for domain attachment'
        )
      }
      const dnsProvider = getConfiguredDnsProvider()
      if (!dnsProvider) {
        throw new FatalError(
          'A DNS provider is required before attaching a production domain'
        )
      }
      await progressReporter('Configuring production DNS after temporary certification...')
      await supabase
        .from('property_websites')
        .update({ domain_status: 'pending_dns', ssl_status: 'pending' })
        .eq('id', input.websiteId)
      const dnsRecord = await dnsProvider.upsertAddressRecord({
        hostname: website.target_domain,
        address: instance.providerMetadata.publicIp,
      })
      const cloudways = new CloudwaysProviderClient(cloudwaysCredentials)
      await cloudways.configureApplicationDomain({
        applicationId: instance.providerMetadata.applicationId,
        domain: website.target_domain,
      })
      await cloudways.verifyDns(website.target_domain)
      const productionUrl = `https://${website.target_domain}`
      await progressReporter('Certifying production domain and SSL...')
      const domainCertification = await certifyRenderedWordPressArtifact({
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        artifactBinding: buildReleaseCertificationBinding(release),
        editAcceptanceContract:
          release.artifact.editAcceptanceContract || undefined,
        targetUrl: productionUrl,
        credentials: instance.credentials,
        pages: deploySource.pages,
        environment: 'production',
        access: 'public',
        requireIndexable: false,
        brandContract: brandContractResult.success
          ? brandContractResult.data
          : undefined,
        ...buildRenderedCertificationTruth(
          blueprint?.propertySnapshot,
          approvedImageUrls,
          publicRuntime.conversionEndpoint,
          approvedImageDigests,
        ),
      })
      if (!domainCertification.passed) {
        throw new FatalError(
          'Production-domain certification failed after DNS and SSL setup'
        )
      }
      certification = domainCertification
      instance.url = productionUrl
      instance.adminUrl = `${productionUrl}/wp-admin`
      await supabase
        .from('property_websites')
        .update({
          domain_status: 'attached',
          ssl_status: 'active',
          dns_record_id: dnsRecord.recordId,
          domain_configured_at: domainCertification.verifiedAt,
        })
        .eq('id', input.websiteId)
    }
    const { error: certificationError } = await supabase
      .from('siteforge_blueprint_versions')
      .update({
        remote_verification_report: certification as unknown as Json,
        remote_verified_url: instance.url,
        remote_verified_at: certification.verifiedAt,
      })
      .eq('id', input.artifactId)
      .eq('content_hash', input.contentHash)
    if (certificationError) {
      throw new Error(
        `Failed to persist remote certification evidence: ${certificationError.message}`
      )
    }
  }

  const completedAt = new Date().toISOString()
  const diagnostics: DeploymentDiagnostics = {
    workflow: 'siteforge_wordpress_deploy',
    status: 'success',
    provider,
    startedAt,
    completedAt,
    pagesAttempted: deploySource.pages.length,
    assetsAttempted: normalizedAssets.length,
    certification,
    verification: {
      enabled: true,
      status: 'passed',
      message: input.localSimulation
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
  const output = {
    provider,
    url: instance.url,
    adminUrl: instance.adminUrl,
    instanceId: instance.instanceId,
    pagesAttempted: deploySource.pages.length,
    assetsAttempted: normalizedAssets.length,
  }

  const { error: websiteCompleteError } = await supabase
    .from('property_websites')
    .update({
      generation_status: 'complete',
      current_step: `Deployment complete (verified ${output.pagesAttempted} pages, ${output.assetsAttempted} assets).`,
      error_message: null,
      wp_url: instance.url,
      wp_admin_url: instance.adminUrl,
      wp_instance_id: instance.instanceId,
      wp_credentials: null,
      deployed_artifact_version_id: input.localSimulation
        ? website.deployed_artifact_version_id
        : input.artifactId,
      deployed_content_hash: input.localSimulation
        ? website.deployed_content_hash
        : input.contentHash,
      deployed_at: completedAt,
      generation_input: mergeDeploymentDiagnostics(
        (website as unknown as DeploymentWebsite).generation_input,
        diagnostics
      ),
      updated_at: completedAt,
    })
    .eq('id', input.websiteId)
  if (websiteCompleteError) {
    throw new Error(`Failed to persist deployed website: ${websiteCompleteError.message}`)
  }

  const { error: sharedCompleteError } = await supabase
    .from('shared_jobs')
    .update({
      lifecycle_status: 'succeeded',
      status_reason: 'completed',
      stage: 'deployed',
      progress: 100,
      current_step: 'Deployment complete',
      heartbeat_at: completedAt,
      lease_owner: null,
      lease_expires_at: null,
      finished_at: completedAt,
      output: output as unknown as Json,
      error_message: null,
      error_details: null,
      updated_at: completedAt,
    })
    .eq('id', input.sharedJobId)
  if (sharedCompleteError) {
    throw new Error(`Failed to complete shared deployment job: ${sharedCompleteError.message}`)
  }

  console.info('[siteforge_deployment_workflow] deployment completed', {
    sharedJobId: input.sharedJobId,
    ...output,
  })
  return output
}

// Cloudways provisioning is not safely repeatable. Durable retries happen through the
// explicit job retry endpoint after persisted failure state is available to operators.
runSiteForgeDeployment.maxRetries = 0

async function runLegacyWorkflowThroughRuntimeV3(
  input: SiteForgeDeploymentWorkflowInput,
  website: Tables<'property_websites'>,
  release: VerifiedSiteForgeRelease,
  client: ReturnType<typeof createServiceClient>
): Promise<{
  provider: DeploymentProvider
  url: string
  adminUrl: string
  instanceId: string
  pagesAttempted: number
  assetsAttempted: number
}> {
  if (input.localSimulation) {
    throw new FatalError(
      'Runtime v3 deployment cannot bypass the artifact-bound remote transaction engine'
    )
  }
  if (!website.wordpress_credential_ref) {
    throw new FatalError('Runtime v3 deployment requires a persisted WordPress target')
  }
  const credentials = await getWordPressCredentialReference(
    website.wordpress_credential_ref
  )
  if (!credentials.ssh) {
    throw new FatalError('Runtime v3 deployment requires exact WordPress SSH identity')
  }
  const { data: targets, error: targetError } = await client
    .from('siteforge_wordpress_targets')
    .select('*')
    .eq('website_id', input.websiteId)
    .eq('is_active', true)
    .eq('site_url', credentials.url)
  if (targetError) {
    throw new Error(`Failed to load runtime v3 deployment target: ${targetError.message}`)
  }
  const target = targets?.find(item =>
    ['canonical_preview', 'staging', 'production'].includes(item.target_type)
  )
  if (!target || !target.site_url) {
    throw new FatalError(
      'Runtime v3 deployment requires one exact active environment target'
    )
  }
  const environment = target.target_type as
    | 'canonical_preview'
    | 'staging'
    | 'production'
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    client
  )
  const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY?.trim()
  if (!acfProLicenseKey) {
    throw new FatalError('SITEFORGE_ACF_PRO_LICENSE_KEY is required')
  }
  const result = await deployArtifactBoundRuntimeV3({
    release,
    target,
    sharedJobId: input.sharedJobId,
    approvalId: input.approvalId,
    environment,
    siteUrl: target.site_url,
    adminUrl: target.admin_url || `${target.site_url.replace(/\/$/, '')}/wp-admin`,
    username: credentials.username,
    applicationPassword: credentials.password,
    ssh: credentials.ssh,
    acfProLicenseKey,
    publicRuntime,
    protection: {
      mode: target.protection_mode as 'noindex' | 'password_noindex' | 'public',
      passwordReference:
        target.protection_mode === 'password_noindex'
          ? target.credential_ref
          : null,
    },
    client,
    assertActive: () => assertSiteForgeDeploymentActive(input),
  })
  const descriptor = asRecord(
    asRecord(release.artifact.blueprint).runtimeV3Release ??
      asRecord(release.artifact.blueprint).runtimeV3 ??
      asRecord(release.artifact.blueprint).runtime_v3
  )
  const pagesAttempted = Array.isArray(asRecord(descriptor.resourceGraph).pages)
    ? (asRecord(descriptor.resourceGraph).pages as unknown[]).length
    : 0
  const output = {
    provider: (credentials.provider === 'cloudways'
      ? 'cloudways'
      : 'existing_wordpress') as DeploymentProvider,
    url: target.site_url,
    adminUrl:
      target.admin_url || `${target.site_url.replace(/\/$/, '')}/wp-admin`,
    instanceId: target.id,
    pagesAttempted,
    assetsAttempted: release.runtimeAssets.length,
  }
  const completedAt = new Date().toISOString()
  const [websiteResult, sharedResult] = await Promise.all([
    client
      .from('property_websites')
      .update({
        generation_status: 'complete',
        current_step: `Runtime v3 deployment complete (${pagesAttempted} pages, ${release.runtimeAssets.length} assets).`,
        error_message: null,
        wp_url: output.url,
        wp_admin_url: output.adminUrl,
        wp_instance_id: output.instanceId,
        wp_credentials: null,
        deployed_artifact_version_id: input.artifactId,
        deployed_content_hash: input.contentHash,
        deployed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', input.websiteId),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'succeeded',
        status_reason: 'completed',
        stage: 'deployed',
        progress: 100,
        current_step: 'Runtime v3 deployment complete',
        heartbeat_at: completedAt,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: completedAt,
        output: {
          ...output,
          runtimeEvidence: result.evidence,
        } as unknown as Json,
        error_message: null,
        error_details: null,
        updated_at: completedAt,
      })
      .eq('id', input.sharedJobId),
  ])
  const completionError = websiteResult.error || sharedResult.error
  if (completionError) {
    throw new Error(
      `Failed to persist runtime v3 deployment completion: ${completionError.message}`
    )
  }
  return output
}

export async function failSiteForgeDeployment(
  input: SiteForgeDeploymentWorkflowInput,
  message: string
): Promise<void> {
  'use step'

  console.error('[siteforge_deployment_workflow] deployment failed', {
    sharedJobId: input.sharedJobId,
    message,
  })
  const supabase = createServiceClient()
  const { data: job } = await supabase
    .from('shared_jobs')
    .select('lifecycle_status, cancel_requested')
    .eq('id', input.sharedJobId)
    .single()
  if (job?.lifecycle_status === 'cancelled' || job?.cancel_requested) {
    return
  }

  const now = new Date().toISOString()
  const { data: website } = await supabase
    .from('property_websites')
    .select('blueprint, pages_generated, site_blueprint_version, site_blueprint_updated_at, version, generation_input')
    .eq('id', input.websiteId)
    .maybeSingle()
  const deploySource = resolveDeploySource(
    (website || { property_id: input.propertyId }) as DeploymentWebsite
  )
  const { count: assetsAttempted } = await supabase
    .from('website_assets')
    .select('id', { count: 'exact', head: true })
    .eq('website_id', input.websiteId)
  const category = classifyDeploymentErrorCategory(message)
  const diagnostics: DeploymentDiagnostics = {
    workflow: 'siteforge_wordpress_deploy',
    status: 'failed',
    provider: input.localSimulation ? 'local_simulation' : resolveDeploymentProvider(),
    startedAt: input.startedAt,
    completedAt: now,
    pagesAttempted: deploySource.pages.length,
    assetsAttempted: assetsAttempted || 0,
    verification: {
      enabled: true,
      status: category === 'verification' ? 'failed' : 'passed',
    },
    deploySource: deploySource.source,
    error: { message, category },
  }

  await Promise.all([
    supabase
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'workflow_failed',
        stage: 'failed',
        current_step: category === 'verification'
          ? 'Deployment failed during verification'
          : 'Deployment failed',
        heartbeat_at: now,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: now,
        error_message: message,
        error_details: { message, category } as Json,
        updated_at: now,
      })
      .eq('id', input.sharedJobId),
    supabase
      .from('property_websites')
      .update({
        generation_status: 'deploy_failed',
        current_step: category === 'verification'
          ? 'Deployment failed during verification'
          : 'Deployment failed',
        error_message: message,
        generation_input: mergeDeploymentDiagnostics(website?.generation_input, diagnostics),
        updated_at: now,
      })
      .eq('id', input.websiteId),
    supabase
      .from('property_websites')
      .update({
        domain_status: 'failed',
        ssl_status: 'failed',
        updated_at: now,
      })
      .eq('id', input.websiteId)
      .eq('domain_status', 'pending_dns'),
  ])
}

function resolveDeploySource(website: DeploymentWebsite) {
  const blueprintPages = Array.isArray(website.blueprint?.pages)
    ? website.blueprint.pages
    : []
  if (blueprintPages.length > 0) {
    return {
      pages: normalizeLegacyPages(blueprintPages),
      source: {
        field: 'blueprint' as const,
        blueprintVersion:
          website.site_blueprint_version ??
          website.version ??
          website.blueprint?.version ??
          null,
        blueprintUpdatedAt:
          website.site_blueprint_updated_at ??
          website.blueprint?.updatedAt ??
          null,
      },
    }
  }
  return {
    pages: normalizeLegacyPages(
      Array.isArray(website.pages_generated) ? website.pages_generated : []
    ),
    source: {
      field: 'pages_generated' as const,
      blueprintVersion: null,
      blueprintUpdatedAt: null,
    },
  }
}

function mergeDeploymentDiagnostics(
  generationInput: DeploymentWebsite['generation_input'],
  diagnostics: DeploymentDiagnostics
): Json {
  const base =
    generationInput && typeof generationInput === 'object' && !Array.isArray(generationInput)
      ? (generationInput as { [key: string]: Json | undefined })
      : {}
  return {
    ...base,
    deploymentDiagnostics: diagnostics as unknown as Json,
  }
}

function resolveDeploymentProvider(): DeploymentProvider {
  return hasCloudwaysProviderCredentials()
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
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function classifyDeploymentErrorCategory(message: string): DeploymentErrorCategory {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('verification failed') ||
    normalized.includes('certification failed') ||
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
