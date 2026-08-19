import { describe, expect, it } from 'vitest'
import { SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1 } from '@/fixtures/siteforge-vertical-matrix.v1'
import { composeVerticalPacks } from './composition'
import { legacyPropertyTypeToPackSelection } from './legacy-adapter'

describe('SiteForge vertical legacy adapter', () => {
  it.each([
    ['multifamily', 'rental_multifamily', []],
    ['affordable', 'rental_multifamily', ['affordable']],
    ['student', 'rental_multifamily', ['student']],
    ['townhome', 'for_sale_community', ['condo_townhome']],
    ['condo', 'for_sale_community', ['condo_townhome']],
    ['single_family', 'for_sale_community', []],
    ['master_planned', 'for_sale_community', ['master_planned']],
  ] as const)(
    'maps unambiguous legacy %s without a generic fallback',
    (propertyType, archetype, modifiers) => {
      const result = legacyPropertyTypeToPackSelection(propertyType)
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved') return

      expect(result.request.archetype).toBe(archetype)
      expect(result.request.modifiers).toEqual(modifiers)
      expect(() => composeVerticalPacks(result.request)).not.toThrow()
    }
  )

  it.each(
    SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1.filter(
      fixture => fixture.kind === 'legacy'
    )
  )('defers $id instead of guessing', fixture => {
    if (fixture.kind !== 'legacy') return
    const result = legacyPropertyTypeToPackSelection(fixture.propertyType)

    expect(result.status).toBe('needs_review')
    if (result.status !== 'needs_review') return
    expect(result.questionIds).toEqual(fixture.expectedQuestionIds)
    expect(result.reason).not.toContain('default')
  })

  it('does not treat senior as multifamily or active-adult by default', () => {
    const result = legacyPropertyTypeToPackSelection('senior')

    expect(result.status).toBe('needs_review')
    expect(JSON.stringify(result)).not.toContain('rental_multifamily')
    expect(JSON.stringify(result)).not.toContain('active_adult_55_plus')
  })

  it('does not resolve portfolio subjects from a legacy property type', () => {
    const result = legacyPropertyTypeToPackSelection(
      'multifamily',
      'real_estate_portfolio'
    )

    expect(result.status).toBe('needs_review')
    expect(result.reason).toContain('portfolio')
  })
})
