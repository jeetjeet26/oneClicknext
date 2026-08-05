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
  requireAuroraLifecycleIdentity,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import { provisionAuroraTargets } from '@/utils/siteforge/testing/aurora-lifecycle-bootstrap'

const querySchema = z.object({
  ownerId: z.string().uuid(),
  websiteId: z.string().uuid(),
})
const provisionSchema = z
  .object({
    operation: z.literal('provision_verified_targets'),
    propertyId: z.string().uuid(),
    websiteId: z.string().uuid(),
    stagingApplicationId: z.string().trim().min(1).max(200),
    stagingOperationId: z.string().trim().min(1).max(500),
  })
  .strict()

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
    await assertActiveAuroraLifecycleLease(
      request,
      identity,
      client,
      'bootstrap'
    )
    const provisioned = await provisionAuroraTargets({
      identity,
      actorId: user.id,
      stagingApplicationId: parsed.data.stagingApplicationId,
      stagingOperationId: parsed.data.stagingOperationId,
      client,
    })
    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
      ...provisioned,
    })
    return NextResponse.json(
      { provisioned: true, ...provisioned },
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
