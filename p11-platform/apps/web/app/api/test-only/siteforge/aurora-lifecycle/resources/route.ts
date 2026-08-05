import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  AURORA_LIFECYCLE_DOMAIN,
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  isAuroraOwnedMetadata,
  loadExactAuroraIdentity,
  postgresUuidSchema,
  requireAuroraLifecycleIdentity,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import { provisionAuroraTargets } from '@/utils/siteforge/testing/aurora-lifecycle-bootstrap'
import {
  CloudwaysProviderClient,
  parseCloudwaysApplicationHostname,
} from '@/utils/siteforge/providers/cloudways-provider'
import { SshWordPressInstaller } from '@/utils/siteforge/wordpress/wordpress-installer'

const querySchema = z.object({
  ownerId: postgresUuidSchema,
  websiteId: postgresUuidSchema,
})
const provisionSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('provision_verified_targets'),
      propertyId: postgresUuidSchema,
      websiteId: postgresUuidSchema,
      stagingApplicationId: z.string().trim().min(1).max(200),
      stagingOperationId: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal('create_and_provision_verified_targets'),
      propertyId: postgresUuidSchema,
      websiteId: postgresUuidSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('install_verified_base_theme'),
      propertyId: postgresUuidSchema,
      websiteId: postgresUuidSchema,
      packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
])

function record(value: Json | null | undefined): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {}
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/resources'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = provisionSchema.safeParse(await request.json())
    if (
      !parsed.success ||
      parsed.data.propertyId !== identity.propertyId ||
      parsed.data.websiteId !== identity.websiteId
    ) {
      throw new AuroraLifecycleControlError(
        'Invalid exact Aurora target provisioning request',
        400,
        'invalid_request'
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new AuroraLifecycleControlError(
        'Unauthorized',
        401,
        'unauthorized'
      )
    }
    const access = await validatePropertyManagerAccess(
      user.id,
      identity.propertyId
    )
    if (!access.authorized) {
      throw new AuroraLifecycleControlError(
        'Aurora lifecycle manager permission required',
        403,
        'forbidden'
      )
    }
    const client = createServiceClient()
    const exact = await loadExactAuroraIdentity(
      identity,
      client,
      'bootstrap'
    )
    await assertActiveAuroraLifecycleLease(
      request,
      identity,
      client,
      'bootstrap'
    )
    if (parsed.data.operation === 'install_verified_base_theme') {
      const apiKey = process.env.CLOUDWAYS_API_KEY?.trim()
      const email = process.env.CLOUDWAYS_EMAIL?.trim()
      const providerIdentity = exact.target.site_url
        ? parseCloudwaysApplicationHostname(exact.target.site_url)
        : null
      if (!apiKey || !email) {
        throw new AuroraLifecycleControlError(
          'Cloudways API credentials are required',
          503,
          'provider_unavailable'
        )
      }
      if (!providerIdentity) {
        throw new AuroraLifecycleControlError(
          'Exact Aurora Cloudways preview identity could not be derived',
          409,
          'provider_identity_missing'
        )
      }
      const { data: themePackage, error: packageError } = await client
        .from('siteforge_runtime_packages')
        .select('id, storage_path')
        .eq('package_type', 'base_theme')
        .eq('package_sha256', parsed.data.packageSha256)
        .eq('publication_status', 'published')
        .is('revoked_at', null)
        .maybeSingle()
      if (packageError || !themePackage?.storage_path) {
        throw new AuroraLifecycleControlError(
          'Published immutable base theme package was not found',
          409,
          'base_theme_unverified'
        )
      }
      const { data: archiveBlob, error: archiveError } = await client.storage
        .from('siteforge-artifacts')
        .download(themePackage.storage_path)
      if (archiveError || !archiveBlob) {
        throw new Error('Failed to load immutable base theme package bytes')
      }
      const archive = Buffer.from(await archiveBlob.arrayBuffer())
      if (
        createHash('sha256').update(archive).digest('hex') !==
        parsed.data.packageSha256
      ) {
        throw new Error('Immutable base theme package digest mismatch')
      }
      const cloudways = new CloudwaysProviderClient({ apiKey, email })
      const application = await cloudways.getApplication({
        serverId: providerIdentity.serverId,
        applicationId: providerIdentity.applicationId,
      })
      if (!application.public_ip) {
        throw new Error('Cloudways preview application has no public IP')
      }
      await new SshWordPressInstaller().installBaseTheme({
        ssh: {
          host: application.public_ip,
          username: application.app_user,
          password: application.app_password,
        },
        archive,
        packageSha256: parsed.data.packageSha256,
      })
      const { data: website, error: websiteError } = await client
        .from('property_websites')
        .select('current_artifact_version_id')
        .eq('id', identity.websiteId)
        .eq('property_id', identity.propertyId)
        .single()
      if (websiteError || !website?.current_artifact_version_id) {
        throw new Error('Aurora preview is missing its current artifact')
      }
      const { data: source, error: sourceError } = await client
        .from('siteforge_blueprint_versions')
        .select(
          'id, version, website_id, blueprint, created_by, org_id, property_id, blueprint_schema_version, content_hash, edit_intent, patches_applied, source_plan_version_id, quality_score, quality_report, approval_action_attempt_id, confirmed_approval_id, deployment_decision, decision_reason, deployment_approved_by, deployment_approved_at, asset_manifest, asset_manifest_hash, base_theme_package_id, base_theme_package_sha256, theme_overlay_id, overlay_package_sha256, site_configuration, motion_configuration, runtime_contract_version, runtime_package_sha256, operation_set, operation_set_hash'
        )
        .eq('id', website.current_artifact_version_id)
        .eq('website_id', identity.websiteId)
        .eq('property_id', identity.propertyId)
        .single()
      if (sourceError || !source) {
        throw new Error('Failed to load Aurora preview artifact for theme repair')
      }
      let repairedArtifactId = source.id
      if (source.base_theme_package_sha256 !== parsed.data.packageSha256) {
        const { data: latest, error: versionError } = await client
          .from('siteforge_blueprint_versions')
          .select('version')
          .eq('website_id', identity.websiteId)
          .order('version', { ascending: false })
          .limit(1)
          .single()
        if (versionError || !latest) {
          throw new Error('Failed to reserve Aurora theme repair version')
        }
        const { data: repaired, error: repairError } = await client
          .from('siteforge_blueprint_versions')
          .insert({
            website_id: source.website_id,
            version: latest.version + 1,
            blueprint: source.blueprint,
            created_by: source.created_by,
            org_id: source.org_id,
            property_id: source.property_id,
            blueprint_schema_version: source.blueprint_schema_version,
            content_hash: source.content_hash,
            parent_version_id: source.id,
            change_type: 'import',
            changes_summary:
              'Bind Aurora test baseline to the installed immutable base theme package.',
            edit_intent: source.edit_intent,
            patches_applied: source.patches_applied,
            source_plan_version_id: source.source_plan_version_id,
            shared_job_id: null,
            quality_score: source.quality_score,
            quality_report: source.quality_report,
            approval_action_attempt_id: source.approval_action_attempt_id,
            confirmed_approval_id: source.confirmed_approval_id,
            deployment_decision: source.deployment_decision,
            decision_reason: source.decision_reason,
            deployment_approved_by: source.deployment_approved_by,
            deployment_approved_at: source.deployment_approved_at,
            remote_verification_report: null,
            remote_verified_url: null,
            remote_verified_at: null,
            asset_manifest: source.asset_manifest,
            asset_manifest_hash: source.asset_manifest_hash,
            base_theme_package_id: themePackage.id,
            base_theme_package_sha256: parsed.data.packageSha256,
            theme_overlay_id: source.theme_overlay_id,
            overlay_package_sha256: source.overlay_package_sha256,
            site_configuration: source.site_configuration,
            motion_configuration: source.motion_configuration,
            runtime_contract_version: source.runtime_contract_version,
            runtime_package_sha256: source.runtime_package_sha256,
            operation_set: source.operation_set,
            operation_set_hash: source.operation_set_hash,
          })
          .select('id')
          .single()
        if (repairError || !repaired) {
          throw new Error('Failed to bind Aurora preview to installed base theme')
        }
        const { data: updatedWebsite, error: projectionError } = await client
          .from('property_websites')
          .update({
            current_artifact_version_id: repaired.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', identity.websiteId)
          .eq('property_id', identity.propertyId)
          .eq('current_artifact_version_id', source.id)
          .select('id')
          .maybeSingle()
        if (projectionError || !updatedWebsite) {
          throw new Error('Aurora theme repair lost its artifact update race')
        }
        repairedArtifactId = repaired.id
      }
      ctx.logSuccess(200, {
        ownerId: identity.ownerId,
        websiteId: identity.websiteId,
        packageSha256: parsed.data.packageSha256,
        artifactId: repairedArtifactId,
      })
      return NextResponse.json(
        {
          installed: true,
          packageSha256: parsed.data.packageSha256,
          artifactId: repairedArtifactId,
        },
        { headers: ctx.responseHeaders }
      )
    }
    let stagingApplicationId =
      parsed.data.operation === 'provision_verified_targets'
        ? parsed.data.stagingApplicationId
        : ''
    let stagingOperationId =
      parsed.data.operation === 'provision_verified_targets'
        ? parsed.data.stagingOperationId
        : ''
    if (parsed.data.operation === 'create_and_provision_verified_targets') {
      const apiKey = process.env.CLOUDWAYS_API_KEY?.trim()
      const email = process.env.CLOUDWAYS_EMAIL?.trim()
      const providerIdentity = exact.target.site_url
        ? parseCloudwaysApplicationHostname(exact.target.site_url)
        : null
      if (!apiKey || !email) {
        throw new AuroraLifecycleControlError(
          'Cloudways API credentials are required',
          503,
          'provider_unavailable'
        )
      }
      if (!providerIdentity) {
        throw new AuroraLifecycleControlError(
          'Exact Aurora Cloudways preview identity could not be derived',
          409,
          'provider_identity_missing'
        )
      }
      const cloudways = new CloudwaysProviderClient({ apiKey, email })
      const staging = await cloudways.createStagingApplication({
        serverId: providerIdentity.serverId,
        parentApplicationId: providerIdentity.applicationId,
        label: `aurora-lifecycle-${identity.ownerId.slice(0, 8)}`,
      })
      if (!staging.applicationId || !staging.operationId) {
        throw new Error(
          'Cloudways did not return the exact staging application and operation identity'
        )
      }
      await cloudways.waitForOperation(staging.operationId)
      stagingApplicationId = staging.applicationId
      stagingOperationId = staging.operationId
    }
    const provisioned = await provisionAuroraTargets({
      identity,
      actorId: user.id,
      stagingApplicationId,
      stagingOperationId,
      client,
    })
    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
      ...provisioned,
    })
    return NextResponse.json(
      {
        provisioned: true,
        stagingApplicationId,
        stagingOperationId,
        ...provisioned,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const response = errorResponse(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}

function errorResponse(error: unknown, headers: Record<string, string>) {
  const status =
    error instanceof AuroraLifecycleControlError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        status === 500
          ? 'Failed to inspect Aurora lifecycle resources'
          : (error as Error).message,
      code:
        error instanceof AuroraLifecycleControlError
          ? error.code
          : 'resource_inspection_failed',
    },
    { status, headers }
  )
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/resources'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = querySchema.safeParse({
      ownerId: request.nextUrl.searchParams.get('ownerId'),
      websiteId: request.nextUrl.searchParams.get('websiteId'),
    })
    if (
      !parsed.success ||
      parsed.data.ownerId !== identity.ownerId ||
      parsed.data.websiteId !== identity.websiteId
    ) {
      throw new AuroraLifecycleControlError(
        'Resource inspection must use the exact lifecycle owner and website',
        409,
        'request_identity_mismatch'
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new AuroraLifecycleControlError(
        'Unauthorized',
        401,
        'unauthorized'
      )
    }
    const access = await validatePropertyManagerAccess(
      user.id,
      identity.propertyId
    )
    if (!access.authorized) {
      throw new AuroraLifecycleControlError(
        'Aurora lifecycle manager permission required',
        403,
        'forbidden'
      )
    }
    const client = createServiceClient()
    const exact = await loadExactAuroraIdentity(identity, client)
    const [
      { data: website },
      { data: artifacts },
      { data: extensions },
      { data: baselines },
      { data: certifications },
      { data: releases },
      { data: targets },
      { data: lease },
    ] = await Promise.all([
      client
        .from('property_websites')
        .select('current_artifact_version_id')
        .eq('id', identity.websiteId)
        .single(),
      client
        .from('siteforge_blueprint_versions')
        .select(
          'id, content_hash, runtime_contract_version, runtime_package_sha256, base_theme_package_sha256, remote_verified_at, parent_version_id, edit_intent, created_at'
        )
        .eq('website_id', identity.websiteId)
        .order('version', { ascending: true }),
      client
        .from('siteforge_runtime_extension_requests')
        .select('id, status, artifact_id')
        .eq('website_id', identity.websiteId)
        .order('created_at', { ascending: true }),
      client
        .from('siteforge_visual_baselines')
        .select('id, status, artifact_id')
        .eq('website_id', identity.websiteId)
        .order('created_at', { ascending: true }),
      client
        .from('siteforge_certification_evidence')
        .select(
          'id, artifact_id, environment, status, policy_version, report, evidence_manifest'
        )
        .eq('website_id', identity.websiteId)
        .order('created_at', { ascending: true }),
      client
        .from('siteforge_launch_releases')
        .select('id, state, artifact_id, artifact_content_hash')
        .eq('website_id', identity.websiteId)
        .order('created_at', { ascending: true }),
      client
        .from('siteforge_wordpress_targets')
        .select('id, target_type, metadata')
        .eq('website_id', identity.websiteId)
        .in('target_type', ['canonical_preview', 'staging', 'production']),
      client
        .from('shared_jobs')
        .select('id, lifecycle_status, lease_owner, lease_expires_at, output')
        .eq('domain', AURORA_LIFECYCLE_DOMAIN)
        .eq('subject_id', identity.websiteId)
        .maybeSingle(),
    ])
    const current = artifacts?.find(
      artifact => artifact.id === website?.current_artifact_version_id
    )
    const rollbackArtifacts = (artifacts || [])
      .filter(artifact => Boolean(artifact.remote_verified_at))
      .map(artifact => ({
        id: artifact.id,
        contentHash: artifact.content_hash,
        immutable: true,
        remoteVerified: true,
        runtimeContractVersion: artifact.runtime_contract_version,
        runtimePackageSha256: artifact.runtime_package_sha256,
        baseThemePackageSha256: artifact.base_theme_package_sha256,
      }))
    const ownedTargetIds = (targets || [])
      .filter(target =>
        isAuroraOwnedMetadata(target.metadata, identity.ownerId)
      )
      .map(target => target.id)
    const leaseOutput = record(lease?.output)
    const cleaned = leaseOutput.cleanupVerified === true
    const registeredResourceIds = Array.isArray(leaseOutput.ownedResources)
      ? leaseOutput.ownedResources.flatMap(value =>
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof value.id === 'string'
            ? [value.id]
            : []
        )
      : []
    const intents = (artifacts || [])
      .map(artifact => artifact.edit_intent?.toLowerCase() || '')
      .join('\n')
    const semanticCoverage = {
      copy: intents.includes('copy:'),
      topology: intents.includes('topology:'),
      navigation: intents.includes('navigation'),
      footer: intents.includes('footer'),
      forms: intents.includes('forms:'),
      seo: intents.includes('seo'),
      redirects: intents.includes('redirect'),
      media: intents.includes('media:'),
      knowledge: intents.includes('knowledge:'),
      responsive: intents.includes('responsive:'),
      accessibility: intents.includes('accessibility:'),
      customInteraction: intents.includes('custom interaction:'),
    }
    const ownedResourceIds = cleaned
      ? []
      : [
          ...(lease?.lease_owner === identity.ownerId ? [lease.id] : []),
          ...ownedTargetIds,
          ...registeredResourceIds,
        ]

    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
      ownedResourceCount: ownedResourceIds.length,
    })
    return NextResponse.json(
      {
        identity: {
          propertyId: identity.propertyId,
          websiteId: identity.websiteId,
          targetId: identity.targetId,
          rolloutAssignmentId: identity.rolloutAssignmentId,
        },
        lease: lease
          ? {
              id: lease.id,
              ownerId: lease.lease_owner,
              expiresAt: lease.lease_expires_at,
              status: lease.lifecycle_status,
            }
          : null,
        targets: (targets || []).map(target => ({
          id: target.id,
          type: target.target_type,
          owned: ownedTargetIds.includes(target.id),
        })),
        runtimeAssignment: {
          id: exact.rollout.id,
          targetId: exact.rollout.target_id,
          contractVersion: exact.rollout.requested_contract_version,
          runtimePackageSha256: exact.rollout.runtime_package_sha256,
          status: exact.rollout.status,
        },
        currentArtifact: current
          ? {
              id: current.id,
              contentHash: current.content_hash,
              runtimeContractVersion: current.runtime_contract_version,
              runtimePackageSha256: current.runtime_package_sha256,
              runtimeManifestSha256:
                typeof leaseOutput.runtimeManifestSha256 === 'string'
                  ? leaseOutput.runtimeManifestSha256
                  : null,
              baseThemePackageSha256: current.base_theme_package_sha256,
            }
          : null,
        rollbackArtifacts,
        extensionRequests: (extensions || []).map(item => ({
          id: item.id,
          status: item.status,
          artifactId: item.artifact_id,
        })),
        baselineCandidates: (baselines || []).map(item => ({
          id: item.id,
          status: item.status,
          artifactId: item.artifact_id,
        })),
        certifications: (certifications || []).map(item => {
          const report = record(item.report)
          const manifest = record(item.evidence_manifest)
          return {
            id: item.id,
            artifactId: item.artifact_id,
            environment: item.environment,
            access:
              report.accessMode ||
              report.access ||
              manifest.accessMode ||
              manifest.access ||
              null,
            status: item.status,
            policyVersion: item.policy_version,
          }
        }),
        releases: (releases || []).map(item => ({
          id: item.id,
          state: item.state,
          artifactId: item.artifact_id,
          contentHash: item.artifact_content_hash,
        })),
        cleanup: {
          verified: cleaned,
          remainingOwnedResourceIds: ownedResourceIds,
        },
        ownedResourceIds,
        mutationLeaseViolations: [],
        artifactLineage: (artifacts || []).map(artifact => artifact.id),
        semanticCoverage,
      },
      {
        headers: {
          ...ctx.responseHeaders,
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error) {
    const response = errorResponse(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}
