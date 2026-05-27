import { describe, expect, it } from 'vitest'
import { parseCompetitorIntakeText } from './competitor-intake-parser'

const SAMPLE = `Brookhaven by Century Communities (El Monte, CA 91733). Townhomes from $694,990, ranging 1,250 to 1,594 sq ft, 2 to 4 bedrooms. Positioned as "final opportunities, nearly sold out." Pushes "No Mello Roos" and Century Home Connect smart-home tech. School callouts to El Monte Valley Unified. SEO angle: heavy on "new homes El Monte" / "new construction San Gabriel Valley" plus the no-Mello-Roos hook.

Blossom by Trumark Homes (Covina, CA 91722). Mixed flats and townhomes from $445,990, 870 to 1,952 sq ft, 1 to 3 bedrooms across seven plans (one already sold out). Lowest entry price in the comp set. Currently running "up to 6% incentives" promo. Leans into proximity to downtown Covina and the Metrolink station. SEO angle: "affordable new townhomes Covina," "new homes near Metrolink," "Covina new construction."

Cadence by Melia Homes (Covina, CA 91722). Three-story townhomes from the low $600,000s, 1,290 to 1,940 sq ft, 2 to 4 bedrooms across six plans. Family-focused messaging with a community pool, walkability to a top-rated high school, and a heavy lifestyle pitch ("rhythm of living"). SEO angle: "3-story townhomes Covina," "family-friendly new homes San Gabriel Valley," school-district queries.

Belcourt Place by KB Home (El Monte). Highest price point in the comp set, from $838,490. KB's standard differentiator is buyer personalization and a 4 to 5 month build-to-order timeline. Gated, walkable, near transit and outdoor recreation. SEO angle: "customizable new homes Los Angeles," "personalize new home El Monte," "gated community new construction."`

describe('parseCompetitorIntakeText', () => {
  it('parses client-provided competitor notes into provenance seeds', () => {
    const seeds = parseCompetitorIntakeText(SAMPLE)

    expect(seeds).toHaveLength(4)
    expect(seeds[0]).toMatchObject({
      seedName: 'Brookhaven',
      seedLocation: 'El Monte, CA 91733',
      seedUrl: null,
    })
    expect(seeds[0].seedClaims).toMatchObject({
      builder: 'Century Communities',
      priceText: 'from $694,990',
      sqftText: '1,250 to 1,594 sq ft',
      bedroomText: '2 to 4 bedrooms',
    })
    expect(seeds[1].seedClaims.seoAngle).toContain('affordable new townhomes Covina')
    expect(seeds[3].seedClaims.builder).toBe('KB Home')
  })

  it('returns no candidates for empty content', () => {
    expect(parseCompetitorIntakeText('   ')).toEqual([])
  })
})
