import { describe, expect, it } from 'vitest'
import { connectionState, importNeedsReview, pipelineState, type PipelineConnection, type PipelineImport } from './monitor'

describe('truthful pipeline states', () => {
  it.each([null, '', 'unexpected'])('does not turn unknown status %s into running or success', status => {
    expect(pipelineState({ status, error_message: null })).toBe('unknown')
  })
  it('preserves an active job even when it has warnings', () => {
    expect(pipelineState({ status: 'running', error_message: 'One channel failed; another is still importing' })).toBe('running')
  })
  it('distinguishes completed, partial and failed results', () => {
    expect(pipelineState({ status: 'complete', error_message: null })).toBe('complete')
    expect(pipelineState({ status: 'complete', error_message: 'No ad accounts configured' })).toBe('partial')
    expect(pipelineState({ status: 'partial', error_message: null })).toBe('partial')
    expect(pipelineState({ status: 'failed', error_message: 'Provider refused' })).toBe('failed')
  })
  it('flags old active records for review without inventing a terminal state', () => {
    const run = { status: 'running', error_message: null, created_at: '2026-09-14T10:00:00Z', started_at: null } as PipelineImport
    expect(importNeedsReview(run, Date.parse('2026-09-14T10:31:00Z'))).toBe(true)
    expect(importNeedsReview(run, Date.parse('2026-09-14T10:10:00Z'))).toBe(false)
    expect(importNeedsReview({ ...run, status: 'complete' }, Date.parse('2026-09-14T12:00:00Z'))).toBe(false)
    expect(importNeedsReview({ ...run, created_at: 'invalid' }, Date.now())).toBe(false)
    expect(pipelineState(run)).toBe('running')
  })
  it('does not infer successful sync from an active connection', () => {
    const connection = { is_active: true, last_synced_at: null, last_error: null, error_count: 0 } as PipelineConnection
    expect(connectionState(connection)).toBe('No sync recorded')
    expect(connectionState({ ...connection, is_active: null })).toBe('Activation unknown')
    expect(connectionState({ ...connection, is_active: false })).toBe('Inactive')
    expect(connectionState({ ...connection, last_synced_at: '2026-09-01', last_error: 'Token expired' })).toBe('Needs attention')
  })
})
