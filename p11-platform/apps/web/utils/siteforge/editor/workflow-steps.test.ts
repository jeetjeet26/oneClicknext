import { describe, expect, it } from 'vitest'
import { immutableSnapshotChanged } from './immutable-snapshot'

describe('immutableSnapshotChanged', () => {
  it('accepts legacy artifacts where optional snapshots are absent', () => {
    expect(immutableSnapshotChanged({}, {}, 'brandSnapshot')).toBe(false)
    expect(immutableSnapshotChanged({}, {}, 'onboardingSnapshot')).toBe(false)
  })

  it('detects additions and content changes', () => {
    expect(
      immutableSnapshotChanged({ brandSnapshot: {} }, {}, 'brandSnapshot')
    ).toBe(true)
    expect(
      immutableSnapshotChanged(
        { brandSnapshot: { name: 'Aurora' } },
        { brandSnapshot: { name: 'Other' } },
        'brandSnapshot'
      )
    ).toBe(true)
  })
})
