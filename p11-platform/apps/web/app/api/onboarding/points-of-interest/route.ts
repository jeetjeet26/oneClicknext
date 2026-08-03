import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import type { Json } from '@/types/supabase'

const propertySchema = z.guid()
const poiSchema = z.object({
  id: z.guid().optional(),
  name: z.string().min(1).max(300),
  category: z.string().min(1).max(100),
  address: z.record(z.string(), z.unknown()).default({}),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  distanceMiles: z.number().min(0).optional(),
  travelTimeMinutes: z.number().int().min(0).optional(),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).default('pending'),
})
const saveSchema = z.object({
  propertyId: propertySchema,
  pointsOfInterest: z.array(poiSchema).max(200),
})

async function currentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/points-of-interest')
  ctx.logStart()
  const parsed = propertySchema.safeParse(request.nextUrl.searchParams.get('propertyId'))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid property ID' }, { status: 400, headers: ctx.responseHeaders })
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })

  const service = createServiceClient()
  const { data, error } = await service
    .from('property_points_of_interest')
    .select('*')
    .eq('property_id', parsed.data)
    .order('name')
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Could not load points of interest' }, { status: 500, headers: ctx.responseHeaders })
  }
  ctx.logSuccess(200, { count: data?.length || 0 })
  return NextResponse.json({ pointsOfInterest: data || [] }, { headers: ctx.responseHeaders })
}

export async function PUT(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/points-of-interest')
  ctx.logStart()
  const parsed = saveSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid points of interest', details: parsed.error.flatten() }, { status: 400, headers: ctx.responseHeaders })
  }
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const access = await validatePropertyManagerAccess(user.id, parsed.data.propertyId)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  }

  const now = new Date().toISOString()
  const rows = parsed.data.pointsOfInterest.map(point => ({
    ...(point.id ? { id: point.id } : {}),
    org_id: access.orgId!,
    property_id: parsed.data.propertyId,
    name: point.name,
    category: point.category,
    address: point.address as Json,
    latitude: point.latitude,
    longitude: point.longitude,
    distance_miles: point.distanceMiles,
    travel_time_minutes: point.travelTimeMinutes,
    source_url: point.sourceUrl,
    captured_at: point.capturedAt,
    confidence: point.confidence,
    approval_status: point.approvalStatus,
    approved_by: point.approvalStatus === 'approved' ? user.id : null,
    approved_at: point.approvalStatus === 'approved' ? now : null,
  }))
  const service = createServiceClient()
  const { data, error } = await service
    .from('property_points_of_interest')
    .upsert(rows)
    .select('*')
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Could not save points of interest' }, { status: 500, headers: ctx.responseHeaders })
  }
  ctx.logSuccess(200, { count: data?.length || 0 })
  return NextResponse.json({ pointsOfInterest: data || [] }, { headers: ctx.responseHeaders })
}
