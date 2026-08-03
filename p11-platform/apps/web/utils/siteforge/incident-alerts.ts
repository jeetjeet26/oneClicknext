import { Resend } from 'resend'
import { createServiceClient } from '@/utils/supabase/admin'

type AlertSummary = {
  processed: number
  failed: number
  unhealthy: number
  degraded: number
  staleJobsRecovered: number
  restoreDrills: {
    failed: number
    awaitingOperator: number
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export async function sendSiteForgeIncidentAlert(input: {
  orgIds: string[]
  runId: string
  summary: AlertSummary
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    throw new Error('SiteForge incident email delivery is not configured')
  }
  const orgIds = [...new Set(input.orgIds)]
  if (orgIds.length === 0) {
    throw new Error('SiteForge incident alert has no affected organization')
  }
  const service = createServiceClient()
  const { data: profiles, error: profilesError } = await service
    .from('profiles')
    .select('id')
    .in('org_id', orgIds)
    .in('role', ['admin', 'manager'])
  if (profilesError) {
    throw new Error(
      `Failed to resolve SiteForge incident recipients: ${profilesError.message}`
    )
  }
  const users = await Promise.all(
    (profiles || []).map(profile => service.auth.admin.getUserById(profile.id))
  )
  const recipients = [
    ...new Set(
      users
        .map(result => result.data.user?.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    ),
  ]
  if (recipients.length === 0) {
    throw new Error('No manager email is available for SiteForge incident alerts')
  }

  const dashboardUrl = `${(
    process.env.NEXT_PUBLIC_APP_URL || 'https://hellop11.com'
  ).replace(/\/$/, '')}/dashboard/siteforge`
  const rows = [
    ['Health runs processed', input.summary.processed],
    ['Execution failures', input.summary.failed],
    ['Unhealthy websites', input.summary.unhealthy],
    ['Degraded websites', input.summary.degraded],
    ['Stale jobs recovered', input.summary.staleJobsRecovered],
    ['Restore drills failed', input.summary.restoreDrills.failed],
    [
      'Restores awaiting operator',
      input.summary.restoreDrills.awaitingOperator,
    ],
  ]
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>SiteForge production incident</title></head>
  <body>
    <main>
      <h1>SiteForge production needs attention</h1>
      <p>Automated production health or restore verification reported a blocker.</p>
      <table role="presentation">
        <tbody>
          ${rows
            .map(
              ([label, value]) =>
                `<tr><th scope="row" align="left">${escapeHtml(
                  String(label)
                )}</th><td>${escapeHtml(String(value))}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p><a href="${escapeHtml(dashboardUrl)}">Open SiteForge operations</a></p>
      <p>Run ID: ${escapeHtml(input.runId)}</p>
    </main>
  </body>
</html>`
  const resend = new Resend(apiKey)
  const { data, error } = await resend.batch.send(
    recipients.map(to => ({
      from,
      to,
      subject: 'Action required: SiteForge production incident',
      html,
      text: [
        'SiteForge production needs attention.',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        `Operations: ${dashboardUrl}`,
        `Run ID: ${input.runId}`,
      ].join('\n'),
    })),
    { idempotencyKey: `siteforge-health/${input.runId}` }
  )
  if (error) {
    throw new Error(`Failed to send SiteForge incident alert: ${error.message}`)
  }
  return { recipients: recipients.length, messageIds: data?.data.map(item => item.id) || [] }
}
