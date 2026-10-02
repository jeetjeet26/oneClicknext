import { describe, expect, it } from 'vitest'
import { cronStatusFromOutcomes, toSharedLifecycleFromCronStatus } from './cron-job-runs'

describe('toSharedLifecycleFromCronStatus', () => {
  it('maps cron run statuses into shared lifecycle vocabulary', () => {
    expect(toSharedLifecycleFromCronStatus('running')).toBe('running')
    expect(toSharedLifecycleFromCronStatus('success')).toBe('succeeded')
    expect(toSharedLifecycleFromCronStatus('failed')).toBe('failed')
  })
})

describe('cronStatusFromOutcomes', () => {
  it('reports failed when every attempted action fails', () => {
    expect(cronStatusFromOutcomes({ succeeded: 0, failed: 2, errors: ['Provider unavailable'] })).toBe('failed')
  })

  it('reports partial when only some actions succeed', () => {
    expect(cronStatusFromOutcomes({ succeeded: 1, failed: 1 })).toBe('partial')
  })

  it('treats discovery errors as failures even before an action starts', () => {
    expect(cronStatusFromOutcomes({ succeeded: 0, failed: 0, errors: ['Database unavailable'] })).toBe('failed')
  })

  it('reports success for completed actions and a clean run with no work', () => {
    expect(cronStatusFromOutcomes({ succeeded: 2, failed: 0 })).toBe('success')
    expect(cronStatusFromOutcomes({ succeeded: 0, failed: 0, errors: [] })).toBe('success')
  })
})
