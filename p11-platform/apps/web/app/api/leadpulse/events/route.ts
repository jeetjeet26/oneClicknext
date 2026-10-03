import { NextRequest } from 'next/server'
import { z } from 'zod'
import { EVENT_WEIGHTS } from '@/utils/services/leadpulse-events'
import { leadPulseEventRequestSchema } from '@/utils/services/validation'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'
export async function POST(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const parsed = leadPulseEventRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return reply({ error: 'A request identity, lead and bounded event details are required.' }, 400)
  const { requestId, leadId, propertyId, eventType, metadata } = parsed.data
  if (!Object.hasOwn(EVENT_WEIGHTS, eventType)) return reply({ error: 'Invalid eventType' }, 400)
  const scope = await leadpulseScope(user.id, { leadId, propertyId }); if (scope.response) return scope.response
  const result = await leadpulseRpc('record_lead_engagement', { p_property_id: scope.propertyId, p_lead_id: leadId, p_event_type: eventType, p_metadata: metadata || {}, p_request_key: `operator/${requestId}`, p_origin: 'operator', p_actor_id: user.id })
  return resultReply(result)
 } catch { return unconfirmed() }
}
export async function GET(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const leadId = req.nextUrl.searchParams.get('leadId')
  const limit = Number(req.nextUrl.searchParams.get('limit') || 50), offset = Number(req.nextUrl.searchParams.get('offset') || 0)
  if (!leadId || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return reply({ error: 'A lead and valid event page are required.' }, 400)
  const scope = await leadpulseScope(user.id, { leadId }); if (scope.response) return scope.response
  return resultReply(await leadpulseRpc('read_leadpulse_events', { p_property_id: scope.propertyId, p_actor_id: user.id, p_lead_id: leadId, p_limit: limit, p_offset: offset }))
 } catch { return unconfirmed() }
}
const correctionSchema = z.object({ leadId: z.string().min(1).max(100), propertyId: z.string().min(1).max(100), eventId: z.string().uuid(), requestId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict()
export async function PATCH(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const parsed = correctionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return reply({ error: 'A saved event and correction reason are required.' }, 400)
  const body = parsed.data
  const scope = await leadpulseScope(user.id, body); if (scope.response) return scope.response
  return resultReply(await leadpulseRpc('correct_lead_engagement', { p_property_id: scope.propertyId, p_actor_id: user.id, p_lead_id: body.leadId, p_event_id: body.eventId, p_request_id: body.requestId, p_reason: body.reason }))
 } catch { return unconfirmed() }
}
