import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { approveOnboardingSnapshot } from '@/utils/onboarding/repository'

const bodySchema = z.object({
  propertyId: z.guid(),
  rationale: z.string().min(10).max(2_000),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const ctx = createRequestContext(request, '/api/onboarding/readiness/[snapshotId]/approve')
  ctx.logStart()
  const { snapshotId } = await context.params
  const parsedSnapshotId = z.guid().safeParse(snapshotId)
  const parsedBody = bodySchema.safeParse(await request.json())
  if (!parsedSnapshotId.success || !parsedBody.success) {
    return NextResponse.json({ error: 'Invalid approval request' }, { status: 400, headers: ctx.responseHeaders })
  }
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const access = await validatePropertyManagerAccess(user.id, parsedBody.data.propertyId)
  if (!access.authorized || !access.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  try {
    const snapshot = await approveOnboardingSnapshot({
      orgId: access.orgId,
      propertyId: parsedBody.data.propertyId,
      snapshotId: parsedSnapshotId.data,
      userId: user.id,
      rationale: parsedBody.data.rationale,
    })
    ctx.logSuccess(200, { snapshotId: snapshot.id })
    return NextResponse.json({ snapshot }, { headers: ctx.responseHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed'
    ctx.logError(409, error)
    return NextResponse.json({ error: message }, { status: 409, headers: ctx.responseHeaders })
  }
}
