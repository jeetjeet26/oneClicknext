import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { recordAttributionEvent } from '@/utils/forgestudio/attribution'

const attributionSchema = z.object({
  trackingToken: z.string().uuid(),
  eventType: z.enum(['lead', 'tour_booked', 'tour_completed', 'lease']),
  anonymousSubject: z.string().min(8).max(500),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  attributionWindowDays: z.number().int().min(1).max(90).optional(),
  metadata: z.object({
    sourceSystem: z.string().min(1).max(100),
    sourceEventId: z.string().min(1).max(200),
    attributionConfidence: z.number().min(0).max(1).optional(),
  }),
})

export async function POST(request: NextRequest) {
  if (!hasValidCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = attributionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid attribution event', details: parsed.error.issues },
      { status: 400 }
    )
  }
  try {
    const result = await recordAttributionEvent(parsed.data)
    return NextResponse.json(result, { status: result.recorded ? 201 : 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Attribution failed' },
      { status: 409 }
    )
  }
}
