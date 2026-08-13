import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  approveOnboardingSnapshot,
  buildOnboardingSnapshot,
} from '@/utils/onboarding/repository'
import { evaluateReadinessApproval } from '@/utils/onboarding/readiness-policy'

const buildSchema = z.object({
  propertyId: z.guid(),
  enabledCapabilities: z.array(z.enum([
    'crm',
    'tours',
    'chatbot',
    'analytics',
  ])).default([]),
})

async function getUser() {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  return error ? null : user
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/readiness')
  ctx.logStart()
  const propertyId = request.nextUrl.searchParams.get('propertyId')
  const parsed = z.guid().safeParse(propertyId)
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  if (!parsed.success) return NextResponse.json({ error: 'Valid property ID required' }, { status: 400, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  const service = createServiceClient()
  const { data, error } = await service
    .from('property_onboarding_snapshots')
    .select('*')
    .eq('property_id', parsed.data)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Failed to load readiness' }, { status: 500, headers: ctx.responseHeaders })
  }
  ctx.logSuccess(200, { snapshotCount: data.length })
  return NextResponse.json(
    {
      snapshots: data.map(snapshot => ({
        ...snapshot,
        approvalEligibility: evaluateReadinessApproval(snapshot),
      })),
    },
    { headers: ctx.responseHeaders },
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/readiness')
  ctx.logStart()
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const parsed = buildSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid readiness request' }, { status: 400, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
  if (!access.authorized || !access.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  try {
    const builtSnapshot = await buildOnboardingSnapshot({
      ...parsed.data,
      userId: user.id,
      orgId: access.orgId,
    })
    const snapshot =
      builtSnapshot.status === 'ready'
        ? await approveOnboardingSnapshot({
            orgId: access.orgId,
            propertyId: parsed.data.propertyId,
            snapshotId: builtSnapshot.id,
            userId: user.id,
          })
        : builtSnapshot
    ctx.logSuccess(201, { snapshotId: snapshot.id, status: snapshot.status })
    return NextResponse.json(
      {
        snapshot: {
          ...snapshot,
          approvalEligibility: evaluateReadinessApproval(snapshot),
        },
      },
      { status: 201, headers: ctx.responseHeaders },
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Readiness build failed' }, { status: 500, headers: ctx.responseHeaders })
  }
}
