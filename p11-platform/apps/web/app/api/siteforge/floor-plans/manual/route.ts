import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { listPropertyConsoleFloorPlans } from '@/utils/siteforge/providers/manual-floor-plan-workflow'

const querySchema = z.object({ propertyId: z.guid() })

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/floor-plans/manual')
  ctx.logStart()
  try {
    const parsed = querySchema.safeParse({
      propertyId: request.nextUrl.searchParams.get('propertyId'),
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Valid propertyId required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const [units, websitesResult] = await Promise.all([
      listPropertyConsoleFloorPlans(
        parsed.data.propertyId,
        service,
        access.orgId
      ),
      service
        .from('property_websites')
        .select('id, current_artifact_version_id, generation_status, updated_at')
        .eq('property_id', parsed.data.propertyId)
        .eq('org_id', access.orgId)
        .not('current_artifact_version_id', 'is', null)
        .order('updated_at', { ascending: false }),
    ])
    if (websitesResult.error) {
      throw new Error(`Failed to load SiteForge websites: ${websitesResult.error.message}`)
    }
    ctx.logSuccess(200, { unitCount: units.length })
    return NextResponse.json(
      { units, websites: websitesResult.data || [] },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load manual floor plans' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
