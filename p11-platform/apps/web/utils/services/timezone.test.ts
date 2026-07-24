import { describe, expect, it } from 'vitest'
import { normalizeTimezoneToIana } from './timezone'

describe('normalizeTimezoneToIana', () => {
  it('maps Windows timezone names from Microsoft Graph to IANA', () => {
    expect(normalizeTimezoneToIana('Pacific Standard Time')).toBe('America/Los_Angeles')
    expect(normalizeTimezoneToIana('Central Standard Time')).toBe('America/Chicago')
    expect(normalizeTimezoneToIana('Eastern Standard Time')).toBe('America/New_York')
    expect(normalizeTimezoneToIana('GMT Standard Time')).toBe('Europe/London')
  })

  it('passes valid IANA identifiers through unchanged', () => {
    expect(normalizeTimezoneToIana('America/Los_Angeles')).toBe('America/Los_Angeles')
    expect(normalizeTimezoneToIana('UTC')).toBe('UTC')
    expect(normalizeTimezoneToIana('Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('returns null for unusable values', () => {
    expect(normalizeTimezoneToIana('Not A Timezone')).toBe(null)
    expect(normalizeTimezoneToIana('')).toBe(null)
    expect(normalizeTimezoneToIana(null)).toBe(null)
    expect(normalizeTimezoneToIana(undefined)).toBe(null)
    expect(normalizeTimezoneToIana('   ')).toBe(null)
  })

  it('trims surrounding whitespace before resolving', () => {
    expect(normalizeTimezoneToIana(' Pacific Standard Time ')).toBe('America/Los_Angeles')
  })
})
