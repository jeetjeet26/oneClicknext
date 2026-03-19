import { describe, expect, it } from 'vitest'
import { toSharedLifecycleFromCronStatus } from './cron-job-runs'

describe('toSharedLifecycleFromCronStatus', () => {
  it('maps cron run statuses into shared lifecycle vocabulary', () => {
    expect(toSharedLifecycleFromCronStatus('running')).toBe('running')
    expect(toSharedLifecycleFromCronStatus('success')).toBe('succeeded')
    expect(toSharedLifecycleFromCronStatus('failed')).toBe('failed')
  })
})

