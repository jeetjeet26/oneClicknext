import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  deriveSiteForgeAutonomyEvidence,
  getActiveSiteForgeAutonomyMode,
  promoteSiteForgeAutonomyMode,
  SITEFORGE_AUTONOMY_MODES,
} from '@/utils/siteforge/autonomy-policy'

const scopeSchema = z.string().trim().min(3).max(100).regex(/^[a-z0-9._:-]+$/i)
const promotionSchema = z
  .object({
    propertyId: z.guid(),
    actionScope: scopeSchema,
    requestedMode: z.enum(SITEFORGE_AUTONOMY_MODES),
    holdoutPercent: z.number().int().min(0).max(100).default(0),
    limits: z.record(z.string(), z.unknown()).default({}),
    policyVersion: z.string().trim().min(1).max(100),
    rationale: z.string().trim().min(10).max(2_000),
  })
  .strict()

async function authenticatedUser() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  return user
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/autonomy')
  const params = new URL(request.url).searchParams
  const propertyId = params.get('propertyId')
  const actionScope = params.get('actionScope')
  if (
    !z.guid().safeParse(propertyId).success ||
    !scopeSchema.safeParse(actionScope).success
  ) {
    return NextResponse.json(
      { error: 'Valid propertyId and actionScope are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const user = await authenticatedUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }
  const access = await validatePropertyAccess(user.id, propertyId!)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: ctx.responseHeaders }
    )
  }
  const scope = {
    orgId: access.orgId,
    propertyId,
    actionScope: actionScope!,
  }
  const [policy, evidence] = await Promise.all([
    getActiveSiteForgeAutonomyMode(scope),
    deriveSiteForgeAutonomyEvidence(scope),
  ])
  return NextResponse.json(
    {
      policy,
      evidence,
      evidenceSource: 'durable_jobs_incidents_approvals_restores_outcomes',
      automaticProductionLaunch: false,
      progression: SITEFORGE_AUTONOMY_MODES,
    },
    { headers: ctx.responseHeaders }
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/autonomy')
  const parsed = promotionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid autonomy promotion request' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const user = await authenticatedUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }
  const access = await validatePropertyManagerAccess(
    user.id,
    parsed.data.propertyId
  )
  if (!access.authorized || !access.orgId) {
    return NextResponse.json(
      { error: 'Manager permission required' },
      { status: 403, headers: ctx.responseHeaders }
    )
  }
  try {
    const policy = await promoteSiteForgeAutonomyMode({
      ...parsed.data,
      orgId: access.orgId,
      actorId: user.id,
    })
    return NextResponse.json(
      { policy, automaticProductionLaunch: false },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Promotion rejected' },
      { status: 409, headers: ctx.responseHeaders }
    )
  }
}
