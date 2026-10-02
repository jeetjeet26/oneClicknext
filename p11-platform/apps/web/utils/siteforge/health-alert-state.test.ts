import { expect, it } from 'vitest'
import { healthAlertDescription, nextHealthAlertState } from './health-alert-state'
it('shows an actionable sender-domain explanation without trusting stored free text', () => {
  const text = healthAlertDescription({ state: 'blocked', failureCode: 'sender_domain_unverified', error: 'secret provider response' })
  expect(text).toContain('sender domain is not verified')
  expect(text).toContain('will not be retried automatically')
  expect(text).not.toContain('secret')
})
it('does not render unknown fields or inherited object properties as explanations', () => {
  for (const state of ['toString', '__proto__', 'unknown']) expect(healthAlertDescription({ state })).toBe('Alert state unavailable.')
  expect(healthAlertDescription({ state: 'blocked', failureCode: 'secret-token' })).not.toContain('secret-token')
  expect(healthAlertDescription({ state: 'unconfirmed', error: 'private@example.test' })).not.toContain('private')
})
it('retains a blocked alert on repeated checks without enrolling historical incidents', () => {
  const notification = { version: 1, state: 'blocked', severity: 'high', failureCode: 'sender_domain_unverified' }
  expect(nextHealthAlertState({ severity: 'high', evidence: { notification } }, 'high')).toEqual(notification)
  expect(nextHealthAlertState({ severity: 'high', evidence: {} }, 'high')).toMatchObject({ state: 'historical' })
  expect(healthAlertDescription({ state: 'accepted' })).toContain('recipient receipt is unverified')
})
