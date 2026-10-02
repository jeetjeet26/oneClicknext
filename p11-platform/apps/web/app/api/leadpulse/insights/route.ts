import { NextRequest } from 'next/server'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'
export interface ScoreDistribution {
  bucket: string
  count: number
  percentage: number
  avgScore: number
}

export interface ScoreInsights {
  totalLeads: number
  scoredLeads: number
  avgScore: number
  distribution: ScoreDistribution[]
  topFactors: {
    positive: { factor: string; count: number }[]
    negative: { factor: string; count: number }[]
  }
  recentTrend: {
    date: string
    avgScore: number
    hotLeads: number
  }[]
}

export async function GET(req: NextRequest) {
 try {
  const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
  const scope = await leadpulseScope(user.id, { propertyId: req.nextUrl.searchParams.get('propertyId') || undefined }); if (scope.response) return scope.response
  const days = Number(req.nextUrl.searchParams.get('days') || 30)
  if (!Number.isInteger(days) || days < 1 || days > 90) return reply({ error: 'Choose an insight period between 1 and 90 days.' }, 400)
  return resultReply(await leadpulseRpc('read_leadpulse_insights', { p_property_id: scope.propertyId, p_actor_id: user.id, p_days: days }))
 } catch { return unconfirmed() }
}
