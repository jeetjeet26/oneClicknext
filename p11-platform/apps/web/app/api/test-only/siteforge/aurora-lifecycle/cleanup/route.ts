import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  assertActiveAuroraLifecycleLease,
  AURORA_LIFECYCLE_CONFIRMATION,
  AURORA_LIFECYCLE_DOMAIN,
  AuroraLifecycleControlError,
  isAuroraOwnedMetadata,
  postgresUuidSchema,
  requireAuroraLifecycleIdentity,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const cleanupSchema = z
  .object({
    propertyId: postgresUuidSchema,
    websiteId: postgresUuidSchema,
    targetId: postgresUuidSchema,
    ownerId: postgresUuidSchema,
    expiresAt: z.string().datetime(),
    confirmation: z.literal(AURORA_LIFECYCLE_CONFIRMATION),
  })
  .strict()

function record(
  value: Json | null | undefined
): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {}
}

function withoutOwnership(metadata: Json | null): Json {
  const next = { ...record(metadata) }
  delete next.lifecycleOwnerId
  delete next.lifecycleRunId
  delete next.lifecycleExpiresAt
  return next
}

function nullableString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function controlledError(error: unknown, headers: Record<string, string>) {
  const status =
    error instanceof AuroraLifecycleControlError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        status === 500
          ? 'Failed to clean up owned Aurora lifecycle resources'
          : (error as Error).message,
      code:
        error instanceof AuroraLifecycleControlError
          ? error.code
          : 'cleanup_failed',
    },
    { status, headers }
  )
}

export async function deleteOwnedArtifactDeployments(
  removeDeployments: (
    artifactIds: string[],
    websiteId: string
  ) => PromiseLike<{ error: { message: string } | null }>,
  websiteId: string,
  artifactIds: string[]
) {
  if (!artifactIds.length) return
  const { error } = await removeDeployments(artifactIds, websiteId)
  if (error) throw new Error(error.message)
}

export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/cleanup'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = cleanupSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new AuroraLifecycleControlError(
        'Exact owned-resource cleanup confirmation is required',
        400,
        'invalid_cleanup_request'
      )
    }
    for (const key of [
      'propertyId',
      'websiteId',
      'targetId',
      'ownerId',
      'expiresAt',
    ] as const) {
      if (parsed.data[key] !== identity[key]) {
        throw new AuroraLifecycleControlError(
          `Aurora lifecycle cleanup ${key} does not match its identity header`,
          409,
          'request_identity_mismatch'
        )
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new AuroraLifecycleControlError('Unauthorized', 401, 'unauthorized')
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
    await assertActiveAuroraLifecycleLease(request, identity, client, 'any')
    const { data: lease, error: leaseError } = await client
      .from('shared_jobs')
      .select('id, output')
      .eq('domain', AURORA_LIFECYCLE_DOMAIN)
      .eq('subject_id', identity.websiteId)
      .eq('lease_owner', identity.ownerId)
      .single()
    if (leaseError || !lease) {
      throw new AuroraLifecycleControlError(
        'Owned Aurora lifecycle lease was not found',
        409,
        'lease_not_owned'
      )
    }
    const baseline = record(lease.output)
    const rollbackArtifact = postgresUuidSchema.safeParse(
      baseline.rollbackArtifactId
    )
    if (!rollbackArtifact.success) {
      if (
        Array.isArray(baseline.ownedResources) &&
        baseline.ownedResources.length > 0
      ) {
        throw new AuroraLifecycleControlError(
          'Partial Aurora bootstrap resources require exact cleanup identity',
          409,
          'bootstrap_incomplete'
        )
      }
      const cleanupAt = new Date().toISOString()
      const { data: released, error: releaseError } = await client
        .from('shared_jobs')
        .update({
          lifecycle_status: 'cancelled',
          status_reason: 'aurora_run_tracking_released_after_failed_bootstrap',
          lease_owner: null,
          lease_expires_at: null,
          output: {
            ...baseline,
            cleanupVerified: true,
            cleanupAt,
            bootstrapCompleted: false,
            remainingOwnedResourceIds: [],
          },
          finished_at: cleanupAt,
          updated_at: cleanupAt,
        })
        .eq('id', lease.id)
        .eq('lease_owner', identity.ownerId)
        .select('id')
        .maybeSingle()
      if (releaseError || !released) {
        throw new Error('Failed to release Aurora lease after failed bootstrap')
      }
      ctx.logSuccess(200, {
        ownerId: identity.ownerId,
        websiteId: identity.websiteId,
        bootstrapCompleted: false,
      })
      return NextResponse.json(
        {
          cleanup: {
            verified: true,
            bootstrapCompleted: false,
            remainingOwnedResourceIds: [],
          },
        },
        { headers: ctx.responseHeaders }
      )
    }
    const rollbackArtifactId = rollbackArtifact.data
    const rollbackSourcePrior = record(
      baseline.rollbackSourcePrior as Json | null | undefined
    )
    const anchorTargetPrior = record(
      baseline.anchorTargetPrior as Json | null | undefined
    )
    const registeredArtifactIds = Array.isArray(baseline.ownedResources)
      ? baseline.ownedResources.flatMap((value) => {
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.kind === 'artifact' &&
            typeof value.id === 'string' &&
            postgresUuidSchema.safeParse(value.id).success
          ) {
            return [value.id]
          }
          return []
        })
      : []
    const registeredReleaseIds = Array.isArray(baseline.ownedResources)
      ? baseline.ownedResources.flatMap((value) => {
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.kind === 'release' &&
            typeof value.id === 'string' &&
            postgresUuidSchema.safeParse(value.id).success
          ) {
            return [value.id]
          }
          return []
        })
      : []
    const registeredSessionIds = Array.isArray(baseline.ownedResources)
      ? baseline.ownedResources.flatMap((value) => {
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.kind === 'editor_session' &&
            typeof value.id === 'string' &&
            postgresUuidSchema.safeParse(value.id).success
          ) {
            return [value.id]
          }
          return []
        })
      : []
    const registeredRolloutIds = Array.isArray(baseline.ownedResources)
      ? baseline.ownedResources.flatMap((value) =>
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value.kind === 'rollout' &&
          typeof value.id === 'string' &&
          postgresUuidSchema.safeParse(value.id).success
            ? [value.id]
            : []
        )
      : []
    const registeredDeploymentIds = Array.isArray(baseline.ownedResources)
      ? baseline.ownedResources.flatMap((value) =>
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value.kind === 'artifact_deployment' &&
          typeof value.id === 'string' &&
          postgresUuidSchema.safeParse(value.id).success
            ? [value.id]
            : []
        )
      : []

    const [
      { data: ownedJobs, error: ownedJobsError },
      { data: targets, error: targetsError },
    ] = await Promise.all([
      client
        .from('shared_jobs')
        .select('id, domain, subject_id, payload')
        .eq('property_id', identity.propertyId)
        .eq('subject_id', identity.websiteId)
        .contains('payload', { lifecycleOwnerId: identity.ownerId }),
      client
        .from('siteforge_wordpress_targets')
        .select('id, metadata')
        .eq('website_id', identity.websiteId),
    ])
    if (ownedJobsError || targetsError) {
      throw new Error('Failed to inspect owned Aurora resources for cleanup')
    }
    const ownedJobIds = (ownedJobs || []).map((job) => job.id)
    const { data: ownedArtifacts, error: ownedArtifactsError } =
      ownedJobIds.length
        ? await client
            .from('siteforge_blueprint_versions')
            .select('id')
            .eq('website_id', identity.websiteId)
            .in('shared_job_id', ownedJobIds)
        : { data: [], error: null }
    if (ownedArtifactsError) {
      throw new Error('Failed to inspect owned Aurora artifacts for cleanup')
    }
    const removableArtifactIds = [
      ...new Set([
        ...(ownedArtifacts || []).map((artifact) => artifact.id),
        ...registeredArtifactIds,
      ]),
    ].filter((artifactId) => artifactId !== rollbackArtifactId)
    const ownedTargets = (targets || []).filter((target) =>
      isAuroraOwnedMetadata(target.metadata, identity.ownerId)
    )
    const removableTargetIds = ownedTargets
      .map((target) => target.id)
      .filter((targetId) => targetId !== identity.targetId)

    const [rollbackReadback, anchorReadback] = await Promise.all([
      client
        .from('siteforge_blueprint_versions')
        .update({
          remote_verification_report:
            rollbackSourcePrior.remoteVerificationReport ?? null,
          remote_verified_url: nullableString(
            rollbackSourcePrior.remoteVerifiedUrl
          ),
          remote_verified_at: nullableString(
            rollbackSourcePrior.remoteVerifiedAt
          ),
        })
        .eq('id', rollbackArtifactId)
        .eq('website_id', identity.websiteId),
      client
        .from('siteforge_wordpress_targets')
        .update({
          last_verified_artifact_id: nullableString(
            anchorTargetPrior.lastVerifiedArtifactId
          ),
          last_verified_content_hash: nullableString(
            anchorTargetPrior.lastVerifiedContentHash
          ),
          last_verified_asset_manifest_hash: nullableString(
            anchorTargetPrior.lastVerifiedAssetManifestHash
          ),
          last_verified_operation_hash: nullableString(
            anchorTargetPrior.lastVerifiedOperationHash
          ),
          updated_at: new Date().toISOString(),
        })
        .eq('id', identity.targetId)
        .eq('website_id', identity.websiteId),
    ])
    if (rollbackReadback.error || anchorReadback.error) {
      throw new Error('Failed to restore Aurora bootstrap readback state')
    }
    const { error: projectionError } = await client
      .from('property_websites')
      .update({
        current_artifact_version_id: rollbackArtifactId,
        canonical_preview_target_id: null,
        canonical_preview_artifact_id: null,
        canonical_preview_content_hash: null,
        canonical_preview_url: null,
        canonical_previewed_at: null,
        staging_target_id: null,
        staging_artifact_id: null,
        staging_content_hash: null,
        staging_url: null,
        staging_admin_url: null,
        staging_certified_at: null,
        production_target_id: null,
        production_artifact_id: null,
        production_content_hash: null,
        production_url: null,
        production_certified_at: null,
        externally_promoted_artifact_id: null,
        externally_promoted_at: null,
        editor_lifecycle_status: 'editing',
        current_step: 'Aurora lifecycle resources cleaned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', identity.websiteId)
      .eq('property_id', identity.propertyId)
    if (projectionError) throw new Error(projectionError.message)

    if (registeredRolloutIds.length) {
      const { error } = await client
        .from('siteforge_runtime_target_rollouts')
        .delete()
        .in('id', registeredRolloutIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    await deleteOwnedArtifactDeployments(
      (artifactIds, ownedWebsiteId) =>
        client
          .from('siteforge_artifact_deployments')
          .delete()
          .in('artifact_id', artifactIds)
          .eq('website_id', ownedWebsiteId),
      identity.websiteId,
      removableArtifactIds
    )
    if (registeredDeploymentIds.length) {
      const { error } = await client
        .from('siteforge_artifact_deployments')
        .delete()
        .in('id', registeredDeploymentIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    if (removableTargetIds.length) {
      const { error } = await client
        .from('siteforge_wordpress_targets')
        .delete()
        .in('id', removableTargetIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    const productionTarget = ownedTargets.find(
      (target) => target.id === identity.targetId
    )
    if (productionTarget) {
      const { error } = await client
        .from('siteforge_wordpress_targets')
        .update({
          metadata: withoutOwnership(productionTarget.metadata),
          updated_at: new Date().toISOString(),
        })
        .eq('id', identity.targetId)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    if (registeredReleaseIds.length) {
      const { error } = await client
        .from('siteforge_launch_releases')
        .delete()
        .in('id', registeredReleaseIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    if (registeredSessionIds.length) {
      const { error } = await client
        .from('siteforge_edit_sessions')
        .delete()
        .in('id', registeredSessionIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    if (removableArtifactIds.length) {
      const { error } = await client
        .from('siteforge_blueprint_versions')
        .delete()
        .in('id', removableArtifactIds)
        .eq('website_id', identity.websiteId)
      if (error) throw new Error(error.message)
    }
    if (ownedJobIds.length) {
      const { error } = await client
        .from('shared_jobs')
        .delete()
        .in('id', ownedJobIds)
        .eq('property_id', identity.propertyId)
      if (error) throw new Error(error.message)
    }

    const [
      { data: remainingTargets, error: remainingTargetsError },
      { data: remainingJobs, error: remainingJobsError },
    ] = await Promise.all([
      client
        .from('siteforge_wordpress_targets')
        .select('id, metadata')
        .eq('website_id', identity.websiteId),
      client
        .from('shared_jobs')
        .select('id')
        .eq('property_id', identity.propertyId)
        .eq('subject_id', identity.websiteId)
        .contains('payload', { lifecycleOwnerId: identity.ownerId }),
    ])
    if (remainingTargetsError || remainingJobsError) {
      throw new Error('Failed to verify owned Aurora target and job cleanup')
    }
    const remainingIds = [
      ...(remainingTargets || [])
        .filter((target) =>
          isAuroraOwnedMetadata(target.metadata, identity.ownerId)
        )
        .map((target) => target.id),
      ...(remainingJobs || []).map((job) => job.id),
    ]
    if (removableArtifactIds.length) {
      const { data, error } = await client
        .from('siteforge_blueprint_versions')
        .select('id')
        .in('id', removableArtifactIds)
        .eq('website_id', identity.websiteId)
      if (error)
        throw new Error('Failed to verify owned Aurora artifact cleanup')
      remainingIds.push(...(data || []).map((item) => item.id))
    }
    if (registeredRolloutIds.length) {
      const { data, error } = await client
        .from('siteforge_runtime_target_rollouts')
        .select('id')
        .in('id', registeredRolloutIds)
        .eq('website_id', identity.websiteId)
      if (error)
        throw new Error('Failed to verify owned Aurora rollout cleanup')
      remainingIds.push(...(data || []).map((item) => item.id))
    }
    if (registeredDeploymentIds.length) {
      const { data, error } = await client
        .from('siteforge_artifact_deployments')
        .select('id')
        .in('id', registeredDeploymentIds)
        .eq('website_id', identity.websiteId)
      if (error) {
        throw new Error('Failed to verify owned Aurora deployment cleanup')
      }
      remainingIds.push(...(data || []).map((item) => item.id))
    }
    if (registeredReleaseIds.length) {
      const { data, error } = await client
        .from('siteforge_launch_releases')
        .select('id')
        .in('id', registeredReleaseIds)
        .eq('website_id', identity.websiteId)
      if (error)
        throw new Error('Failed to verify owned Aurora release cleanup')
      remainingIds.push(...(data || []).map((item) => item.id))
    }
    if (registeredSessionIds.length) {
      const { data, error } = await client
        .from('siteforge_edit_sessions')
        .select('id')
        .in('id', registeredSessionIds)
        .eq('website_id', identity.websiteId)
      if (error)
        throw new Error('Failed to verify owned Aurora session cleanup')
      remainingIds.push(...(data || []).map((item) => item.id))
    }
    if (remainingIds.length) {
      throw new Error(
        `Owned Aurora resources remain after cleanup: ${remainingIds.join(', ')}`
      )
    }

    const cleanupAt = new Date().toISOString()
    const { data: cleanedLease, error: cleanupError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'cancelled',
        status_reason: 'owned_resources_cleanup_verified',
        lease_owner: null,
        lease_expires_at: null,
        output: {
          ...baseline,
          cleanupVerified: true,
          cleanupAt,
          remainingOwnedResourceIds: [],
        },
        finished_at: cleanupAt,
        updated_at: cleanupAt,
      })
      .eq('id', lease.id)
      .eq('lease_owner', identity.ownerId)
      .select('id')
      .maybeSingle()
    if (cleanupError || !cleanedLease) {
      throw new Error('Cleanup completed but lease terminalization failed')
    }

    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
      removedTargets: removableTargetIds.length,
      removedArtifacts: removableArtifactIds.length,
      removedJobs: ownedJobIds.length,
    })
    return NextResponse.json(
      {
        cleanup: {
          verified: true,
          remainingOwnedResourceIds: [],
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const response = controlledError(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}
