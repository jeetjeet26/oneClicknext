import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { subDays, format } from 'date-fns'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

type MetricTotals = {
  spend: number
  clicks: number
  conversions: number
  impressions: number
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/dashboard/overview')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const { searchParams } = new URL(request.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) {
    ctx.logSuccess(400, { reason: 'missing_property_id' })
    return badRequest('propertyId is required', ctx.responseHeaders)
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    ctx.logSuccess(403, {
      reason: 'forbidden_property_access',
      propertyId,
      userId: user.id,
    })
    return forbidden(ctx.responseHeaders)
  }

  const supabase = createServiceClient()
  
  const today = new Date()
  const thirtyDaysAgo = subDays(today, 30)
  const sixtyDaysAgo = subDays(today, 60)

  try {
    // Get marketing performance for current period (last 30 days)
    const { data: currentPeriodData } = await supabase
      .from('fact_marketing_performance')
      .select('spend, clicks, conversions, impressions')
      .eq('property_id', propertyId)
      .gte('date', format(thirtyDaysAgo, 'yyyy-MM-dd'))
      .lte('date', format(today, 'yyyy-MM-dd'))

    // Get marketing performance for previous period (30-60 days ago)
    const { data: previousPeriodData } = await supabase
      .from('fact_marketing_performance')
      .select('spend, clicks, conversions, impressions')
      .eq('property_id', propertyId)
      .gte('date', format(sixtyDaysAgo, 'yyyy-MM-dd'))
      .lt('date', format(thirtyDaysAgo, 'yyyy-MM-dd'))

    // Get leads count for current period
    const { count: currentLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .gte('created_at', thirtyDaysAgo.toISOString())

    // Get leads count for previous period
    const { count: previousLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .gte('created_at', sixtyDaysAgo.toISOString())
      .lt('created_at', thirtyDaysAgo.toISOString())

    // Get conversations/messages for AI response metrics
    const { count: totalMessages } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user')

    const { count: aiResponses } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'assistant')

    // Get documents count
    const { count: documentsCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)

    // Get recent activity (leads, conversations, etc.)
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('id, first_name, last_name, source, status, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(5)

    const { data: recentMessages } = await supabase
      .from('messages')
      .select(`
        id, 
        content, 
        role, 
        created_at,
        conversation:conversations!inner(
          property_id,
          lead:leads(first_name, last_name)
        )
      `)
      .eq('conversation.property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(5)

    // Calculate totals for current period
    const currentTotals = (currentPeriodData || []).reduce(
      (acc: MetricTotals, row) => ({
        spend: acc.spend + Number(row.spend || 0),
        clicks: acc.clicks + Number(row.clicks || 0),
        conversions: acc.conversions + Number(row.conversions || 0),
        impressions: acc.impressions + Number(row.impressions || 0),
      }),
      { spend: 0, clicks: 0, conversions: 0, impressions: 0 }
    )

    // Calculate totals for previous period
    const previousTotals = (previousPeriodData || []).reduce(
      (acc: MetricTotals, row) => ({
        spend: acc.spend + Number(row.spend || 0),
        clicks: acc.clicks + Number(row.clicks || 0),
        conversions: acc.conversions + Number(row.conversions || 0),
        impressions: acc.impressions + Number(row.impressions || 0),
      }),
      { spend: 0, clicks: 0, conversions: 0, impressions: 0 }
    )

    // Calculate metrics
    const totalLeads = currentLeads || 0
    const costPerLead = totalLeads > 0 ? currentTotals.spend / totalLeads : 0
    const previousCostPerLead = (previousLeads || 0) > 0 
      ? previousTotals.spend / (previousLeads || 1) 
      : 0

    // Calculate percentage changes
    const leadsChange = previousLeads 
      ? ((totalLeads - previousLeads) / previousLeads) * 100 
      : 0
    const cplChange = previousCostPerLead 
      ? ((costPerLead - previousCostPerLead) / previousCostPerLead) * 100 
      : 0
    const aiResponseRate = totalMessages 
      ? ((aiResponses || 0) / totalMessages) * 100 
      : 100

    // Format recent activity
    const recentActivity = [
      ...(recentLeads || []).map(lead => ({
        id: lead.id,
        type: 'lead' as const,
        title: `New lead: ${lead.first_name} ${lead.last_name || ''}`.trim(),
        subtitle: `Source: ${lead.source || 'Direct'} • Status: ${lead.status}`,
        timestamp: lead.created_at || new Date(0).toISOString(),
      })),
      ...(recentMessages || []).map(msg => ({
        id: msg.id,
        type: msg.role === 'user' ? 'message_in' as const : 'message_out' as const,
        title: msg.role === 'user' ? 'New message received' : 'AI responded',
        subtitle:
          (msg.content || '').slice(0, 60) +
          ((msg.content || '').length > 60 ? '...' : ''),
        timestamp: msg.created_at || new Date(0).toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10)

    ctx.logSuccess(200, {
      propertyId,
      totalLeads,
      documentsCount: documentsCount || 0,
    })

    return NextResponse.json(
      {
        metrics: {
          totalLeads: {
            value: totalLeads,
            change: leadsChange,
            period: '30d',
          },
          costPerLead: {
            value: costPerLead,
            change: cplChange,
            period: '30d',
          },
          aiResponseRate: {
            value: aiResponseRate,
            change: 0, // Would need historical data
            period: '30d',
          },
          totalSpend: {
            value: currentTotals.spend,
            change: previousTotals.spend 
              ? ((currentTotals.spend - previousTotals.spend) / previousTotals.spend) * 100 
              : 0,
            period: '30d',
          },
          conversions: {
            value: currentTotals.conversions,
            change: previousTotals.conversions
              ? ((currentTotals.conversions - previousTotals.conversions) / previousTotals.conversions) * 100
              : 0,
            period: '30d',
          },
          documentsCount: documentsCount || 0,
        },
        recentActivity,
        summary: {
          impressions: currentTotals.impressions,
          clicks: currentTotals.clicks,
          ctr: currentTotals.impressions > 0 
            ? (currentTotals.clicks / currentTotals.impressions) * 100 
            : 0,
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'dashboard_overview' })
    return serverError(error, ctx.responseHeaders)
  }
}



























