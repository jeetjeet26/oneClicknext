import { createClient } from '@/utils/supabase/server'
import type { Json } from '@/types/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns'
import { validateCronAuth } from '@/utils/services/api-helpers'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

interface ReportTotals {
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpa: number
}

interface ReportChannel extends ReportTotals {
  channel: string
}

interface ReportAnalyticsData {
  totals: ReportTotals
  channels: ReportChannel[]
  rowCount: number
}

// Initialize Resend client
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[Reports] Resend API key not configured')
    return null
  }
  return new Resend(apiKey)
}

// Calculate date range based on type
function getDateRange(dateRangeType: string, scheduleType: string): { start: Date; end: Date } {
  const now = new Date()
  
  switch (dateRangeType) {
    case 'last_7_days':
      return {
        start: subDays(now, 7),
        end: subDays(now, 1),
      }
    
    case 'last_30_days':
      return {
        start: subDays(now, 30),
        end: subDays(now, 1),
      }
    
    case 'month_to_date':
      return {
        start: startOfMonth(now),
        end: subDays(now, 1),
      }
    
    case 'previous_period':
    default:
      // For daily: yesterday
      // For weekly: previous week
      // For monthly: previous month
      if (scheduleType === 'daily') {
        const yesterday = subDays(now, 1)
        return { start: yesterday, end: yesterday }
      } else if (scheduleType === 'weekly') {
        const lastWeek = subWeeks(now, 1)
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: 1 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 1 }),
        }
      } else {
        // monthly
        const lastMonth = subMonths(now, 1)
        return {
          start: startOfMonth(lastMonth),
          end: endOfMonth(lastMonth),
        }
      }
  }
}

// Fetch analytics data for a property
async function fetchAnalyticsData(
  supabase: SupabaseClient,
  propertyId: string,
  startDate: string,
  endDate: string,
  _includeComparison: boolean
): Promise<ReportAnalyticsData | null> {
  // Reserved for comparison-period support in follow-up implementation.
  void _includeComparison

  const { data: currentData, error } = await supabase
    .from('fact_marketing_performance')
    .select('*')
    .eq('property_id', propertyId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error || !currentData) {
    return null
  }

  // Aggregate data
  const totals = {
    impressions: 0,
    clicks: 0,
    spend: 0,
    conversions: 0,
    ctr: 0,
    cpa: 0,
  }

  const channelMap = new Map<string, typeof totals>()

  for (const row of currentData) {
    totals.impressions += Number(row.impressions) || 0
    totals.clicks += Number(row.clicks) || 0
    totals.spend += Number(row.spend) || 0
    totals.conversions += Number(row.conversions) || 0

    const channel = row.channel_id || 'unknown'
    const existing = channelMap.get(channel) || {
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      ctr: 0,
      cpa: 0,
    }
    existing.impressions += Number(row.impressions) || 0
    existing.clicks += Number(row.clicks) || 0
    existing.spend += Number(row.spend) || 0
    existing.conversions += Number(row.conversions) || 0
    channelMap.set(channel, existing)
  }

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  totals.cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0

  const channels = Array.from(channelMap.entries()).map(([name, data]) => ({
    channel: name,
    ...data,
    ctr: data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0,
    cpa: data.conversions > 0 ? data.spend / data.conversions : 0,
  }))

  return { totals, channels, rowCount: currentData.length }
}

// Generate HTML email content
function generateEmailHtml(
  propertyName: string,
  dateRange: { start: string; end: string },
  data: { totals: ReportTotals; channels: ReportChannel[] },
  reportName: string
): string {
  const formatCurrency = (val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const formatNumber = (val: number) => val.toLocaleString('en-US')
  const formatChannelName = (channel: string) => {
    const names: Record<string, string> = {
      'meta': 'Meta Ads',
      'google_ads': 'Google Ads',
      'ga4': 'Analytics',
    }
    return names[channel] || channel.charAt(0).toUpperCase() + channel.slice(1)
  }

  const channelRows = data.channels.map(c => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${formatChannelName(c.channel)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency(c.spend)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatNumber(c.clicks)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatNumber(c.conversions)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${c.ctr.toFixed(2)}%</td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${reportName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 24px; text-align: center;">
      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
        ${reportName}
      </h1>
      <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
        ${propertyName}
      </p>
    </div>
    
    <!-- Date Range -->
    <div style="background-color: #f8fafc; padding: 16px 24px; border-bottom: 1px solid #e2e8f0;">
      <p style="margin: 0; color: #64748b; font-size: 14px;">
        📅 <strong>Report Period:</strong> ${dateRange.start} — ${dateRange.end}
      </p>
    </div>
    
    <!-- Summary Metrics -->
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 18px; font-weight: 600;">
        Performance Summary
      </h2>
      
      <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Total Spend</p>
          <p style="margin: 4px 0 0 0; color: #1e293b; font-size: 24px; font-weight: 700;">${formatCurrency(data.totals.spend)}</p>
        </div>
        <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Impressions</p>
          <p style="margin: 4px 0 0 0; color: #1e293b; font-size: 24px; font-weight: 700;">${formatNumber(data.totals.impressions)}</p>
        </div>
        <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Clicks</p>
          <p style="margin: 4px 0 0 0; color: #1e293b; font-size: 24px; font-weight: 700;">${formatNumber(data.totals.clicks)}</p>
        </div>
        <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Conversions</p>
          <p style="margin: 4px 0 0 0; color: #1e293b; font-size: 24px; font-weight: 700;">${formatNumber(data.totals.conversions)}</p>
        </div>
      </div>
      
      <!-- Additional Metrics -->
      <div style="display: flex; gap: 24px; margin-top: 16px; padding: 16px; background-color: #f0fdf4; border-radius: 12px;">
        <div>
          <p style="margin: 0; color: #166534; font-size: 12px;">Click-Through Rate</p>
          <p style="margin: 4px 0 0 0; color: #166534; font-size: 20px; font-weight: 600;">${data.totals.ctr.toFixed(2)}%</p>
        </div>
        <div>
          <p style="margin: 0; color: #166534; font-size: 12px;">Cost Per Acquisition</p>
          <p style="margin: 4px 0 0 0; color: #166534; font-size: 20px; font-weight: 600;">${formatCurrency(data.totals.cpa)}</p>
        </div>
      </div>
    </div>
    
    ${data.channels.length > 0 ? `
    <!-- Channel Breakdown -->
    <div style="padding: 0 24px 24px 24px;">
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 18px; font-weight: 600;">
        Channel Breakdown
      </h2>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Channel</th>
            <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Spend</th>
            <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Clicks</th>
            <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Conv.</th>
            <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">CTR</th>
          </tr>
        </thead>
        <tbody>
          ${channelRows}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    <!-- Footer -->
    <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px;">
        This report was automatically generated by P11 Platform
      </p>
      <p style="margin: 0; color: #94a3b8; font-size: 11px;">
        Generated on ${format(new Date(), 'MMMM d, yyyy')} at ${format(new Date(), 'h:mm a')} UTC
      </p>
    </div>
  </div>
</body>
</html>
`
}

// POST - Process and send due reports (CRON endpoint)
export async function POST(request: NextRequest) {
  const authError = validateCronAuth(request)
  if (authError) return authError

  const supabase = await createClient()
  const resend = getResendClient()
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'reports@resend.dev'

  try {
    // Find reports that are due (next_run_at <= now)
    const { data: dueReports, error: fetchError } = await supabase
      .from('scheduled_reports')
      .select(`
        *,
        property:properties(id, name)
      `)
      .eq('is_active', true)
      .lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true })
      .limit(10) // Process up to 10 at a time

    if (fetchError) {
      console.error('[Reports CRON] Error fetching due reports:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!dueReports || dueReports.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No reports due for sending',
        processed: 0 
      })
    }

    console.log(`[Reports CRON] Processing ${dueReports.length} due reports`)

    const results = []

    for (const report of dueReports) {
      const propertyName = report.property?.name || 'All Properties'
      
      // Create history record
      const { data: historyRecord, error: historyError } = await supabase
        .from('report_send_history')
        .insert({
          scheduled_report_id: report.id,
          status: 'pending',
          recipients_count: report.recipients.length,
        })
        .select()
        .single()

      if (historyError) {
        console.error(`[Reports CRON] Error creating history for report ${report.id}:`, historyError)
        continue
      }

      try {
        // Calculate date range
        const dateRange = getDateRange(report.date_range_type, report.schedule_type)
        const startDate = format(dateRange.start, 'yyyy-MM-dd')
        const endDate = format(dateRange.end, 'yyyy-MM-dd')

        // Fetch analytics data
        let analyticsData = null
        if (report.property_id) {
          analyticsData = await fetchAnalyticsData(
            supabase,
            report.property_id,
            startDate,
            endDate,
            report.include_comparison
          )
        }

        // Generate email content
        const emailHtml = generateEmailHtml(
          propertyName,
          { 
            start: format(dateRange.start, 'MMM d, yyyy'), 
            end: format(dateRange.end, 'MMM d, yyyy') 
          },
          analyticsData || { 
            totals: { impressions: 0, clicks: 0, spend: 0, conversions: 0, ctr: 0, cpa: 0 },
            channels: [] 
          },
          report.name
        )

        // Send emails
        let sentCount = 0
        const errors: string[] = []

        if (resend) {
          for (const recipient of report.recipients) {
            try {
              await resend.emails.send({
                from: fromEmail,
                to: recipient,
                subject: `${report.name} - ${format(dateRange.end, 'MMM d, yyyy')}`,
                html: emailHtml,
              })
              sentCount++
            } catch (emailError) {
              const errorMsg = emailError instanceof Error ? emailError.message : 'Unknown error'
              errors.push(`${recipient}: ${errorMsg}`)
              console.error(`[Reports CRON] Error sending to ${recipient}:`, emailError)
            }
          }
        } else {
          // Dev mode - just log
          console.log(`[Reports CRON] Dev mode - would send to: ${report.recipients.join(', ')}`)
          sentCount = report.recipients.length
        }

        // Update history record
        await supabase
          .from('report_send_history')
          .update({
            status: errors.length === 0 ? 'sent' : 'failed',
            error_message: errors.length > 0 ? errors.join('; ') : null,
            report_date_start: startDate,
            report_date_end: endDate,
            metrics_snapshot: (analyticsData?.totals || null) as Json | null,
            completed_at: new Date().toISOString(),
          })
          .eq('id', historyRecord.id)

        // Update report's last_sent_at (next_run_at is auto-calculated by trigger)
        await supabase
          .from('scheduled_reports')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', report.id)

        results.push({
          reportId: report.id,
          reportName: report.name,
          success: errors.length === 0,
          sentCount,
          errors: errors.length > 0 ? errors : undefined,
        })

        console.log(`[Reports CRON] Processed report ${report.id}: ${sentCount}/${report.recipients.length} sent`)

      } catch (reportError) {
        const errorMsg = reportError instanceof Error ? reportError.message : 'Unknown error'
        
        // Update history with error
        await supabase
          .from('report_send_history')
          .update({
            status: 'failed',
            error_message: errorMsg,
            completed_at: new Date().toISOString(),
          })
          .eq('id', historyRecord.id)

        results.push({
          reportId: report.id,
          reportName: report.name,
          success: false,
          error: errorMsg,
        })

        console.error(`[Reports CRON] Error processing report ${report.id}:`, reportError)
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    })

  } catch (err) {
    console.error('[Reports CRON] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - Check status of scheduled reports (for manual testing)
export async function GET(request: NextRequest) {
  const authError = validateCronAuth(request)
  if (authError) return authError

  const supabase = await createClient()

  try {
    const { data: reports, error } = await supabase
      .from('scheduled_reports')
      .select(`
        id,
        name,
        schedule_type,
        is_active,
        next_run_at,
        last_sent_at,
        recipients
      `)
      .eq('is_active', true)
      .order('next_run_at', { ascending: true })
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const now = new Date()
    const isDue = (nextRunAt: string | null) => !!nextRunAt && new Date(nextRunAt) <= now
    const dueCount = (reports || []).filter(r => isDue(r.next_run_at)).length

    return NextResponse.json({
      totalActive: reports?.length || 0,
      dueNow: dueCount,
      reports: reports?.map(r => ({
        ...r,
        isDue: isDue(r.next_run_at),
        recipientCount: r.recipients?.length || 0,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

