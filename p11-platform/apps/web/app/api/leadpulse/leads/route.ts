import { NextRequest } from 'next/server'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'
export async function GET(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const scope = await leadpulseScope(user.id, { propertyId: req.nextUrl.searchParams.get('propertyId') || undefined }); if (scope.response) return scope.response
  const search = req.nextUrl.searchParams.get('search') || '', bucket = req.nextUrl.searchParams.get('bucket') || 'all', page = Number(req.nextUrl.searchParams.get('page') || 1)
  if (search.length > 200 || !Number.isInteger(page) || page < 1 || page > 100000 || !['all','hot','warm','cold','unqualified','unscored'].includes(bucket)) return reply({ error: 'Invalid lead page.' }, 400)
  return resultReply(await leadpulseRpc('list_leadpulse_leads', { p_property_id: scope.propertyId, p_actor_id: user.id, p_search: search, p_bucket: bucket, p_page: page }))
 } catch { return unconfirmed() }
}
