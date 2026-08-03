import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { acknowledgeSiteForgeIncident } from '@/utils/siteforge/incidents'
import { authorizeSiteForgeIncident } from '@/utils/siteforge/operations-auth'

const requestSchema = z.object({
  rationale: z.string().trim().min(5).max(2_000),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/incidents/[incidentId]/acknowledge'
  )
  const { incidentId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(incidentId).success || !parsed.success) {
    return NextResponse.json(
      { error: 'Valid incident and acknowledgement rationale are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeIncident(incidentId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  try {
    const incident = await acknowledgeSiteForgeIncident({
      incidentId,
      actorId: auth.user.id,
      rationale: parsed.data.rationale,
    })
    return NextResponse.json({ incident }, { headers: ctx.responseHeaders })
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Acknowledgement failed' },
      { status: 409, headers: ctx.responseHeaders }
    )
  }
}
