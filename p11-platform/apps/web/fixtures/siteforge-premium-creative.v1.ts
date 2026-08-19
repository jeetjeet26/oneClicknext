import type {
  PremiumCreativeCandidate,
  PremiumCreativeVertical,
} from '../evals/forge/contracts'

type CaseSeed = {
  pairId: string
  vertical: PremiumCreativeVertical
  brandName: string
  brandTerms: [string, string, string]
  place: string
  inventoryLabel: string
}

function premium(seed: CaseSeed): PremiumCreativeCandidate {
  const [idea, ritual, landmark] = seed.brandTerms
  return {
    id: `${seed.pairId}.premium`,
    pairId: seed.pairId,
    quality: 'premium',
    vertical: seed.vertical,
    brandName: seed.brandName,
    brandTerms: seed.brandTerms,
    sections: [
      {
        id: 'arrival',
        kind: 'hero',
        headline: `${idea}, drawn from ${seed.place}`,
        copy: `${seed.brandName} opens with a precise promise: daily life shaped by ${landmark}, not a catalog of amenities.`,
        layout: 'cinematic-overlap',
        emphasis: 'primary',
        imageDirection:
          'Wide dawn exterior with human-scale foreground, long shadows, restrained warm grain.',
        mobileTreatment:
          'Crop to the arrival gesture; keep headline above the primary action.',
      },
      {
        id: 'story',
        kind: 'story',
        headline: `A day organized around ${ritual}`,
        copy: `Follow one lived rhythm from first coffee through the evening return, using details specific to ${seed.place}.`,
        layout: 'editorial-split',
        emphasis: 'secondary',
        imageDirection:
          'Close observational portrait with tactile materials, side light, and unscripted movement.',
        mobileTreatment:
          'Stack copy before imagery and preserve a short, readable narrative measure.',
      },
      {
        id: 'amenities',
        kind: 'amenities',
        headline: 'Spaces with a reason to exist',
        copy: `Frame each shared space by the ritual it supports, from focused mornings to slow weekends.`,
        layout: 'asymmetric-mosaic',
        emphasis: 'supporting',
        imageDirection:
          'Alternating detail and room-scale frames with occupied spaces and natural transitions.',
        mobileTreatment:
          'Use a swipeable sequence with captions visible without opening a modal.',
      },
      {
        id: 'inventory',
        kind: 'inventory',
        headline: `Find your ${seed.inventoryLabel}`,
        copy: 'Compare real choices without leaving the story or losing selected filters.',
        layout: 'filter-and-cards',
        emphasis: 'secondary',
        mobileTreatment:
          'Pin compact filters above a single-column result list with persistent actions.',
        inventory: {
          filters: ['type', 'move-in date', 'price'],
          showsPricing: true,
          showsStatus: true,
          cardCta: 'View details',
          mobileColumns: 1,
        },
      },
      {
        id: 'place',
        kind: 'neighborhood',
        headline: `${landmark} in every direction`,
        copy: `Map a useful fifteen-minute orbit around ${seed.place}, prioritizing named routes and everyday destinations.`,
        layout: 'map-story-rail',
        emphasis: 'supporting',
        imageDirection:
          'Street-level sequence of recognizable corners, local texture, and directional movement.',
        mobileTreatment:
          'Turn the map rail into ordered stops with distance and travel mode.',
      },
      {
        id: 'signature',
        kind: 'signature',
        headline: `Build your ${idea} itinerary`,
        copy: `A branded planner turns ${ritual} into a personalized visit through the places that matter most.`,
        layout: 'interactive-canvas',
        emphasis: 'secondary',
        imageDirection:
          'Layered illustrated route using brand geometry, restrained motion, and place markers.',
        mobileTreatment:
          'Convert the canvas into a thumb-friendly stepper with a fixed progress cue.',
        signatureInteraction: `${seed.brandName} itinerary composer`,
      },
      {
        id: 'close',
        kind: 'cta',
        headline: `See ${seed.place} on your terms`,
        copy: 'Choose a time and arrive with a visit already shaped around your priorities.',
        layout: 'focused-conversion',
        emphasis: 'secondary',
        mobileTreatment:
          'Keep one action full-width and expose scheduling context before submission.',
      },
    ],
  }
}

function bland(seed: CaseSeed): PremiumCreativeCandidate {
  const repeated =
    'Discover luxury living with thoughtfully designed spaces, resort-style amenities, and something for everyone.'
  return {
    id: `${seed.pairId}.bland`,
    pairId: seed.pairId,
    quality: 'bland',
    vertical: seed.vertical,
    brandName: seed.brandName,
    brandTerms: seed.brandTerms,
    sections: [
      {
        id: 'hero',
        kind: 'hero',
        headline: 'Live your best life',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
      },
      {
        id: 'story',
        kind: 'story',
        headline: 'The perfect place to call home',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
      },
      {
        id: 'amenities',
        kind: 'amenities',
        headline: 'Resort-style amenities',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
      },
      {
        id: 'inventory',
        kind: 'inventory',
        headline: 'Explore your options',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
        inventory: {
          filters: [],
          showsPricing: false,
          showsStatus: false,
          cardCta: '',
          mobileColumns: 4,
        },
      },
      {
        id: 'signature',
        kind: 'signature',
        headline: 'Something for everyone',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
      },
      {
        id: 'cta',
        kind: 'cta',
        headline: 'Contact us today',
        copy: repeated,
        layout: 'centered',
        emphasis: 'primary',
      },
    ],
  }
}

const seeds: readonly CaseSeed[] = [
  {
    pairId: 'multifamily.harbor-thread',
    vertical: 'multifamily',
    brandName: 'Harbor Thread',
    brandTerms: ['harbor rhythm', 'porch hour', 'working waterfront'],
    place: 'Port Mason',
    inventoryLabel: 'apartment',
  },
  {
    pairId: 'lease-up.first-light',
    vertical: 'lease_up',
    brandName: 'First Light',
    brandTerms: ['first light', 'opening season', 'east garden'],
    place: 'Eastline',
    inventoryLabel: 'first home',
  },
  {
    pairId: 'for-sale.copper-row',
    vertical: 'for_sale',
    brandName: 'Copper Row',
    brandTerms: ['crafted edge', 'front-door ritual', 'copper trail'],
    place: 'North Foundry',
    inventoryLabel: 'home',
  },
  {
    pairId: 'master-planned.wildmere',
    vertical: 'master_planned',
    brandName: 'Wildmere',
    brandTerms: ['wild commons', 'trail morning', 'mere loop'],
    place: 'Wildmere Valley',
    inventoryLabel: 'neighborhood',
  },
  {
    pairId: 'homebuilder.fieldworks',
    vertical: 'homebuilder',
    brandName: 'Fieldworks Homes',
    brandTerms: ['useful beauty', 'making table', 'field line'],
    place: 'Piedmont Workshop Country',
    inventoryLabel: 'plan',
  },
]

export const SITEFORGE_PREMIUM_CREATIVE_CASES_V1 = seeds.map(seed => ({
  pairId: seed.pairId,
  premium: premium(seed),
  bland: bland(seed),
}))
