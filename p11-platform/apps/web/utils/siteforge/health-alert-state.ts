import type { Json } from '@/types/supabase'

export function recordObject(value: unknown): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json | undefined> : {}
}
const priority: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/** Existing historical incidents are not enrolled in a delivery backlog. */
export function nextHealthAlertState(existing: { severity: string; evidence: unknown } | null, severity: string): Json {
  const prior = recordObject(recordObject(existing?.evidence).notification)
  const escalated = existing && priority[severity] > priority[existing.severity]
  const alreadyCovered = typeof prior.severity === 'string' && priority[prior.severity] >= priority[severity]
  if (!existing || (escalated && !alreadyCovered)) return { version: 1, state: 'pending', severity }
  return Object.keys(prior).length ? prior : { version: 1, state: 'historical', severity: existing.severity }
}


const failureMessages = {
  delivery_not_configured: 'Email alerts need sender setup. Ask your platform administrator to configure incident email delivery.',
  sender_domain_unverified: 'The email sender domain is not verified. Ask your platform administrator to verify the configured sender domain.',
  provider_access_denied: 'The email service rejected access. Ask your platform administrator to check the sending credentials and permissions.',
  recipients_unavailable: 'The manager recipient list could not be confirmed. Check the organization’s manager accounts before sending.',
  recipients_missing: 'No manager email is available for this organization. Add a manager with an email address before sending.',
  recipients_limit: 'The recipient list exceeds the email service’s batch limit. Ask your platform administrator to review delivery.',
  provider_rejected: 'The email service rejected this alert. Ask your platform administrator to review the sender and message settings.',
  acceptance_unconfirmed: 'Email acceptance is unconfirmed. Review provider delivery records before any retry.',
} as const
export type IncidentAlertFailureCode = keyof typeof failureMessages

/** Display only known messages, never provider-supplied text or recipient details. */
export function incidentAlertFailureMessage(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(failureMessages, code)
    ? failureMessages[code as IncidentAlertFailureCode]
    : failureMessages.acceptance_unconfirmed
}

export function healthAlertDescription(value: unknown): string {
  const notification = recordObject(value)
  const labels: Record<string, string> = {
    pending: 'Alert awaiting delivery.',
    claimed: 'Alert delivery in progress or unconfirmed; review before retrying.',
    unconfirmed: 'Alert delivery unconfirmed; review before retrying.',
    blocked: 'Alert not sent; delivery needs attention.',
    accepted: 'Email provider accepted the alert; recipient receipt is unverified.',
    historical: 'Historical incident; its alert has not been replayed.',
  }
  const state = typeof notification.state === 'string' ? notification.state : ''
  const label = Object.hasOwn(labels, state) ? labels[state] : 'Alert state unavailable.'
  if (state === 'blocked' || (state === 'unconfirmed' && notification.failureCode)) {
    return `${label} ${incidentAlertFailureMessage(notification.failureCode)} This alert will not be retried automatically.`
  }
  return label
}
