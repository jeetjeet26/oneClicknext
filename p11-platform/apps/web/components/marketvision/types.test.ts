import { describe, expect, it } from 'vitest'
import {
  deriveJobResult,
  isTerminalJobStatus,
  toCanonicalJobStatus,
} from './types'

describe('toCanonicalJobStatus', () => {
  it('maps data-engine raw states to canonical vocabulary', () => {
    expect(toCanonicalJobStatus('pending')).toBe('queued')
    expect(toCanonicalJobStatus('processing')).toBe('running')
    expect(toCanonicalJobStatus('completed')).toBe('succeeded')
    expect(toCanonicalJobStatus('failed')).toBe('failed')
    expect(toCanonicalJobStatus('cancelled')).toBe('cancelled')
  })

  it('passes canonical states through', () => {
    expect(toCanonicalJobStatus('queued')).toBe('queued')
    expect(toCanonicalJobStatus('running')).toBe('running')
    expect(toCanonicalJobStatus('succeeded')).toBe('succeeded')
    expect(toCanonicalJobStatus('retrying')).toBe('retrying')
  })

  it('defaults unknown/missing states to queued', () => {
    expect(toCanonicalJobStatus(undefined)).toBe('queued')
    expect(toCanonicalJobStatus(null)).toBe('queued')
    expect(toCanonicalJobStatus('weird-state')).toBe('queued')
  })
})

describe('isTerminalJobStatus', () => {
  it('treats succeeded, failed, and cancelled as terminal', () => {
    expect(isTerminalJobStatus('succeeded')).toBe(true)
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('cancelled')).toBe(true)
  })

  it('treats queued, running, and retrying as non-terminal', () => {
    expect(isTerminalJobStatus('queued')).toBe(false)
    expect(isTerminalJobStatus('running')).toBe(false)
    expect(isTerminalJobStatus('retrying')).toBe(false)
  })
})

describe('deriveJobResult', () => {
  it('derives partial when a succeeded run has mixed outcomes', () => {
    expect(deriveJobResult('succeeded', 5, 2)).toBe('partial')
  })

  it('derives success when nothing failed', () => {
    expect(deriveJobResult('succeeded', 5, 0)).toBe('success')
  })

  it('derives failure when everything failed despite terminal success state', () => {
    expect(deriveJobResult('succeeded', 0, 5)).toBe('failure')
  })

  it('derives failure for failed and cancelled jobs', () => {
    expect(deriveJobResult('failed', 3, 1)).toBe('failure')
    expect(deriveJobResult('cancelled', 0, 0)).toBe('failure')
  })

  it('returns null while non-terminal', () => {
    expect(deriveJobResult('running', 2, 1)).toBe(null)
    expect(deriveJobResult('queued', 0, 0)).toBe(null)
  })
})
