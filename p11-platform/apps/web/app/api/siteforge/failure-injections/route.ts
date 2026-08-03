import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { siteForgeFailureInjectionEnabled } from '@/utils/siteforge/failure-injection'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  failpoint: z.string().trim().min(3).max(100).regex(/^[a-z0-9._:-]+$/i),
  scopeKey: z.string().trim().min(1).max(200),
  remainingHits: z.number().int().min(1).max(20).default(1),
  expiresAt: z.string().datetime(),
})

async function authorize(propertyId: string) {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 } as const
  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized || !access.orgId) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user, orgId: access.orgId } as const
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/failure-injections')
  if (!siteForgeFailureInjectionEnabled()) {
    return NextResponse.json(
      { error: 'Failure injection is available only in local/test environments' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (
    !parsed.success ||
    new Date(parsed.data.expiresAt).getTime() <= Date.now() ||
    new Date(parsed.data.expiresAt).getTime() > Date.now() + 60 * 60_000
  ) {
    return NextResponse.json(
      { error: 'Valid failure injection with a TTL of at most one hour is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorize(parsed.data.propertyId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const service = createServiceClient()
  const { data, error } = await service
    .from('siteforge_failure_injections')
    .upsert(
      {
        org_id: auth.orgId,
        failpoint: parsed.data.failpoint,
        scope_key: parsed.data.scopeKey,
        remaining_hits: parsed.data.remainingHits,
        expires_at: parsed.data.expiresAt,
        created_by: auth.user.id,
      },
      { onConflict: 'org_id,failpoint,scope_key' }
    )
    .select('*')
    .single()
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json({ injection: data }, { status: 201, headers: ctx.responseHeaders })
}

export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/failure-injections')
  if (!siteForgeFailureInjectionEnabled()) {
    return NextResponse.json(
      { error: 'Failure injection is available only in local/test environments' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  const params = new URL(request.url).searchParams
  const parsed = requestSchema.pick({
    propertyId: true,
    failpoint: true,
    scopeKey: true,
  }).safeParse({
    propertyId: params.get('propertyId'),
    failpoint: params.get('failpoint'),
    scopeKey: params.get('scopeKey'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid failure injection identity is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorize(parsed.data.propertyId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { error } = await createServiceClient()
    .from('siteforge_failure_injections')
    .delete()
    .eq('org_id', auth.orgId)
    .eq('failpoint', parsed.data.failpoint)
    .eq('scope_key', parsed.data.scopeKey)
  return error
    ? NextResponse.json({ error: error.message }, { status: 500, headers: ctx.responseHeaders })
    : NextResponse.json({ removed: true }, { headers: ctx.responseHeaders })
}
