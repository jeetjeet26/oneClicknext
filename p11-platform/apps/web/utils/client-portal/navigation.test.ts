import { describe, expect, it } from 'vitest'
import { clientPortalHref } from './navigation'

describe('client reporting navigation', () => {
  it('preserves the selected property and period when moving to explanations', () => {
    const href = clientPortalHref('/client/insights', new URLSearchParams('propertyId=community-a&days=90&reportOffset=20'))
    expect(href).toBe('/client/insights?propertyId=community-a&days=90')
  })
  it('returns to all assigned properties without dropping the reporting period', () => {
    expect(clientPortalHref('/client/performance', new URLSearchParams('propertyId=community-a&days=7'), { propertyId: '' })).toBe('/client/performance?days=7')
  })
  it('updates the reporting period without mutating the current URL parameters', () => {
    const params = new URLSearchParams('propertyId=community-b&days=30')
    expect(clientPortalHref('/client/reports', params, { days: '90' })).toBe('/client/reports?propertyId=community-b&days=90')
    expect(params.get('days')).toBe('30')
  })
})
