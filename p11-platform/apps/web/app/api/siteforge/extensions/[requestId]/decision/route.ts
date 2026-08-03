import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(2_000),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/extensions/[requestId]/decision'
  )
  ctx.logStart()
  try {
    const { requestId } = await params
    const parsed = decisionSchema.safeParse(await request.json())
    if (!z.string().uuid().safeParse(requestId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid runtime extension decision' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const [{ data: extension }, { data: profile }] = await Promise.all([
      service
        .from('siteforge_runtime_extension_requests')
        .select('id, org_id, status')
        .eq('id', requestId)
        .single(),
      service
        .from('profiles')
        .select('org_id, role')
        .eq('id', user.id)
        .single(),
    ])
    if (!extension) {
      return NextResponse.json(
        { error: 'Runtime extension request not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    if (
      !profile ||
      profile.org_id !== extension.org_id ||
      !['admin', 'manager'].includes(profile.role || '')
    ) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    if (extension.status !== 'proposed') {
      return NextResponse.json(
        { error: 'Runtime extension request has already been decided' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const decidedAt = new Date().toISOString()
    const { data: decided, error: decisionError } = await service
      .from('siteforge_runtime_extension_requests')
      .update({
        status: parsed.data.decision,
        decision_by: user.id,
        decision_reason: parsed.data.reason,
        decided_at: decidedAt,
        updated_at: decidedAt,
      })
      .eq('id', extension.id)
      .eq('status', 'proposed')
      .select('id, status')
      .maybeSingle()
    if (decisionError || !decided) {
      throw new Error(
        `Failed to decide runtime extension request: ${
          decisionError?.message || 'request changed'
        }`
      )
    }
    ctx.logSuccess(200, { requestId, decision: decided.status })
    return NextResponse.json(
      { requestId, status: decided.status },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to decide runtime extension request' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
