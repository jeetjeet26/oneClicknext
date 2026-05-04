/**
 * PropertyAudit Run Purge API
 * Delete run history for a property (runs + cascaded answers/citations/scores)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { isSupportedSurface, type Surface } from '@/utils/propertyaudit/types'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, surfaces } = body as {
      propertyId?: string
      surfaces?: Surface[]
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const requestedSurfaces = Array.isArray(surfaces)
      ? surfaces.filter(
          (surface): surface is Surface =>
            typeof surface === 'string' && isSupportedSurface(surface)
        )
      : []

    if (Array.isArray(surfaces) && surfaces.length > 0 && requestedSurfaces.length === 0) {
      return NextResponse.json(
        { error: 'Invalid surfaces.' },
        { status: 400 }
      )
    }

    const service = createServiceClient()

    let del = service.from('geo_runs').delete().eq('property_id', propertyId)
    if (requestedSurfaces.length > 0) {
      del = del.in('surface', requestedSurfaces)
    }

    const { error: deleteError } = await del

    if (deleteError) {
      console.error('Error purging run history:', deleteError)
      return NextResponse.json({ error: 'Failed to purge run history' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      propertyId,
      surfaces: requestedSurfaces.length > 0 ? requestedSurfaces : 'all',
    })
  } catch (error) {
    console.error('PropertyAudit Purge Runs Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}










