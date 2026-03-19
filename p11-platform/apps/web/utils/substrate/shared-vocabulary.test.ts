import { describe, expect, it } from 'vitest'
import {
  SHARED_STATE_SEMANTICS,
  deriveSharedLifecycleStatus,
} from './shared-vocabulary'

describe('shared substrate vocabulary', () => {
  it('normalizes lifecycle aliases to one canonical status set', () => {
    expect(deriveSharedLifecycleStatus('pending').status).toBe('queued')
    expect(deriveSharedLifecycleStatus('completed').status).toBe('succeeded')
    expect(deriveSharedLifecycleStatus('canceled').status).toBe('cancelled')
    expect(deriveSharedLifecycleStatus('retry').status).toBe('retrying')
  })

  it('flags succeeded states with warnings as degraded', () => {
    expect(deriveSharedLifecycleStatus('complete', { hasWarnings: true })).toMatchObject({
      status: 'succeeded',
      isDegraded: true,
    })
  })

  it('keeps proposal and execution semantics defined', () => {
    expect(SHARED_STATE_SEMANTICS.proposalDecision.modified).toContain('changes')
    expect(SHARED_STATE_SEMANTICS.execution.reversed).toContain('rollback')
  })
})

