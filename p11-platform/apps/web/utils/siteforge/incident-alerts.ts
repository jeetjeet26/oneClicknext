import { requireDeliveryEnabled } from '@/utils/services/delivery-guard'
import { Resend, type ErrorResponse } from 'resend'
import { incidentAlertFailureMessage, type IncidentAlertFailureCode } from './health-alert-state'
import { createServiceClient } from '@/utils/supabase/admin'

export class IncidentAlertDeliveryError extends Error {
  constructor(readonly state: 'blocked' | 'unconfirmed', readonly code: IncidentAlertFailureCode) {
    super(incidentAlertFailureMessage(code))
    this.name = 'IncidentAlertDeliveryError'
  }
}

// Only explicit non-acceptance responses may be called blocked. A timeout,
// server error or idempotency conflict can conceal an already accepted email.
function providerFailure(error: ErrorResponse): IncidentAlertDeliveryError {
  if (error.statusCode === 403 && error.name === 'validation_error' &&
      /domain.{0,300}(?:not verified|verify)|verify.{0,100}domain/i.test(error.message)) {
    return new IncidentAlertDeliveryError('blocked', 'sender_domain_unverified')
  }
  if ([401, 403].includes(error.statusCode || 0)) {
    return new IncidentAlertDeliveryError('blocked', 'provider_access_denied')
  }
  if ([400, 404, 405, 422].includes(error.statusCode || 0)) {
    return new IncidentAlertDeliveryError('blocked', 'provider_rejected')
  }
  return new IncidentAlertDeliveryError('unconfirmed', 'acceptance_unconfirmed')
}

type AlertSummary = {
  processed: number
  failed: number
  unhealthy: number
  degraded: number
  staleJobsRecovered: number | null
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
  requireDeliveryEnabled()
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    throw new IncidentAlertDeliveryError('blocked', 'delivery_not_configured')
  }
  const orgIds = [...new Set(input.orgIds)]
  if (orgIds.length === 0) {
    throw new IncidentAlertDeliveryError('blocked', 'recipients_unavailable')
  }
  const service = createServiceClient()
  const { data: profiles, error: profilesError } = await service
    .from('profiles')
    .select('id')
    .in('org_id', orgIds)
    .in('role', ['admin', 'manager'])
  if (profilesError) {
    throw new IncidentAlertDeliveryError('blocked', 'recipients_unavailable')
  }
  const users = await Promise.all(
    (profiles || []).map(profile => service.auth.admin.getUserById(profile.id))
  )
  if (users.some(result => result.error || !result.data.user)) {
    throw new IncidentAlertDeliveryError('blocked', 'recipients_unavailable')
  }
  const recipients = [
    ...new Set(
      users
        .map(result => result.data.user?.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    ),
  ]
  if (recipients.length === 0) {
    throw new IncidentAlertDeliveryError('blocked', 'recipients_missing')
  }

  if (recipients.length > 100) {
    throw new IncidentAlertDeliveryError('blocked', 'recipients_limit')
  }

  const dashboardUrl = `${(
    process.env.NEXT_PUBLIC_APP_URL || 'https://hellop11.com'
  ).replace(/\/$/, '')}/dashboard/siteforge`
  const rows = [
    ['Health runs processed', input.summary.processed],
    ['Execution failures', input.summary.failed],
    ['Unhealthy websites', input.summary.unhealthy],
    ['Degraded websites', input.summary.degraded],
    ['Stale jobs recovered', input.summary.staleJobsRecovered ?? 'Not measured for this organization'],
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
    { idempotencyKey: `siteforge-health/${input.runId}`, batchValidation: 'strict' }
  )
  if (error) {
    throw providerFailure(error)
  }
  const messageIds = data?.data?.map(item => item.id) || []
  if (messageIds.length !== recipients.length || new Set(messageIds).size !== recipients.length ||
      messageIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new IncidentAlertDeliveryError('unconfirmed', 'acceptance_unconfirmed')
  }
  return { recipients: recipients.length, messageIds }
}
