import { describe, expect, it } from 'vitest'
import { formatPropertyAddress } from './property-address'

describe('formatPropertyAddress', () => {
  it('composes the full address from structured parts', () => {
    expect(
      formatPropertyAddress({
        street: '420 Acacia Avenue',
        city: 'Palo Alto',
        state: 'CA',
        zip: '94306',
      })
    ).toBe('420 Acacia Avenue, Palo Alto, CA 94306')
  })

  it('prefers an explicit full address string when present', () => {
    expect(
      formatPropertyAddress({ full: '1 Main St, Springfield, IL 62701', street: '1 Main St' })
    ).toBe('1 Main St, Springfield, IL 62701')
  })

  it('skips missing parts without dangling separators', () => {
    expect(formatPropertyAddress({ street: '1700 Lincoln St', city: 'Denver' })).toBe(
      '1700 Lincoln St, Denver'
    )
    expect(formatPropertyAddress({ street: '1700 Lincoln St', zip: '80203' })).toBe(
      '1700 Lincoln St, 80203'
    )
    expect(formatPropertyAddress({ city: 'Denver', state: 'CO' })).toBe('Denver, CO')
  })

  it('returns undefined for empty or non-object input', () => {
    expect(formatPropertyAddress(null)).toBeUndefined()
    expect(formatPropertyAddress(undefined)).toBeUndefined()
    expect(formatPropertyAddress('420 Acacia Avenue')).toBeUndefined()
    expect(formatPropertyAddress([])).toBeUndefined()
    expect(formatPropertyAddress({})).toBeUndefined()
    expect(formatPropertyAddress({ street: '  ' })).toBeUndefined()
  })
})
