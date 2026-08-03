import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { runOnePassSiteForgeRepair } from '@/utils/siteforge/incidents'
import { authorizeSiteForgeIncident } from '@/utils/siteforge/operations-auth'

const requestSchema = z.object({
  rationale: z.string().trim().min(10).max(2_000),
  confirmOnePass: z.literal(true),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/incidents/[incidentId]/repair'
  )
  const { incidentId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(incidentId).success || !parsed.success) {
    return NextResponse.json(
      { error: 'Explicit one-pass repair confirmation and rationale are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeIncident(incidentId, true)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  try {
    const result = await runOnePassSiteForgeRepair({
      incidentId,
      actorId: auth.user.id,
      rationale: parsed.data.rationale,
    })
    return NextResponse.json(result, { headers: ctx.responseHeaders })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Repair failed'
    return NextResponse.json(
      { error: message },
      {
        status: /not found/i.test(message) ? 404 : 409,
        headers: ctx.responseHeaders,
      }
    )
  }
}
