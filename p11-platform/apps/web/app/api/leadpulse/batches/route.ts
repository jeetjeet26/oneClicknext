import { NextRequest } from 'next/server'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'
export async function GET(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const propertyId = req.nextUrl.searchParams.get('propertyId') || undefined
  const scope = await leadpulseScope(user.id, { propertyId }); if (scope.response) return scope.response
  const result = await leadpulseRpc('lead_score_batch_status', { p_property_id: scope.propertyId, p_actor_id: user.id, p_batch_id: req.nextUrl.searchParams.get('requestId') || null })
  return result.state === 'not_found' ? reply({ batch: null }) : result.state === 'forbidden' ? resultReply(result) : reply({ batch: result })
 } catch { return unconfirmed() }
}
