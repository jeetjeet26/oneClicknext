import { describe, expect, it } from 'vitest'
import { deriveImportJobState, normalizeImportJobRecord } from './import-job-state'

describe('import job state derivation', () => {
  it('keeps complete jobs without errors as complete', () => {
    expect(deriveImportJobState({ status: 'complete', error_message: null })).toBe('complete')
  })

  it('treats complete jobs with an error message as partial', () => {
    expect(deriveImportJobState({ status: 'complete', error_message: 'meta_ads failed' })).toBe('partial')
  })

  it('keeps failed and partial statuses explicit', () => {
    expect(deriveImportJobState({ status: 'failed', error_message: 'all channels failed' })).toBe('failed')
    expect(deriveImportJobState({ status: 'partial', error_message: 'google skipped' })).toBe('partial')
  })

  it('maps shared aliases to import states consistently', () => {
    expect(deriveImportJobState({ status: 'success', error_message: null })).toBe('complete')
    expect(deriveImportJobState({ status: 'pending', error_message: null })).toBe('pending')
    expect(deriveImportJobState({ status: 'canceled', error_message: null })).toBe('failed')
  })

  it('adds terminal and warning flags to normalized records', () => {
    expect(
      normalizeImportJobRecord({ status: 'partial', error_message: 'meta timeout' })
    ).toMatchObject({
      import_state: 'partial',
      has_warnings: true,
      is_terminal: true,
    })
  })
})
