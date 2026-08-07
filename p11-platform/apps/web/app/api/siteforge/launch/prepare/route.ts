import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  prepareLaunchRelease,
  SiteForgeLaunchError,
} from '@/utils/siteforge/launch/repository'
import { requireLaunchManager } from '../auth'
import {
  assertActiveAuroraLifecycleLease,
  registerAuroraOwnedResource,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const requestSchema = z.object({
  propertyId: z.guid(),
  websiteId: z.string().uuid(),
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rollbackArtifactId: z.string().uuid().nullish(),
  rollbackContentHash: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
}).strict().refine(
  value => Boolean(value.rollbackArtifactId) === Boolean(value.rollbackContentHash),
  'Rollback artifact identity must be complete or fully omitted'
)

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/prepare')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Exact launch and rollback artifact identities are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId, request)
    if (!auth.user) return auth.response
    const release = await prepareLaunchRelease({
      ...parsed.data,
      rollbackArtifactId: parsed.data.rollbackArtifactId ?? null,
      rollbackContentHash: parsed.data.rollbackContentHash ?? null,
      requestedBy: auth.user.id,
      requestId: ctx.requestId,
    })
    const lifecycle = await assertActiveAuroraLifecycleLease(request, {
      propertyId: parsed.data.propertyId,
      websiteId: parsed.data.websiteId,
    })
    if (lifecycle) {
      const client = createServiceClient()
      const { data: launchJob } = await client
        .from('shared_jobs')
        .select('id, payload')
        .eq('domain', 'siteforge.launch')
        .eq('subject_id', release.id)
        .maybeSingle()
      if (launchJob) {
        const payload =
          launchJob.payload &&
          typeof launchJob.payload === 'object' &&
          !Array.isArray(launchJob.payload)
            ? launchJob.payload
            : {}
        const { error } = await client
          .from('shared_jobs')
          .update({
            payload: {
              ...payload,
              lifecycleOwnerId: lifecycle.ownerId,
              lifecycleRunId: lifecycle.ownerId,
              lifecycleExpiresAt: lifecycle.expiresAt,
              websiteId: lifecycle.websiteId,
            },
          })
          .eq('id', launchJob.id)
        if (error) throw new Error('Failed to tag the owned launch release')
      }
      await registerAuroraOwnedResource(
        lifecycle,
        { kind: 'release', id: release.id },
        client
      )
    }
    ctx.logSuccess(201, { releaseId: release.id, state: release.state })
    return NextResponse.json(
      { release, finalLaunchHumanOwned: true },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: status === 500 ? 'Failed to prepare SiteForge launch' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
