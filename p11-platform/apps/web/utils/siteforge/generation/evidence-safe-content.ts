import type { ACFBlockType } from '@/types/siteforge'

export const SITEFORGE_PLACEHOLDER_EVIDENCE_ID =
  'siteforge-unverified-content-placeholder-v1'

const FACT_BEARING_BLOCKS = new Set<ACFBlockType>([
  'acf/text-section',
  'acf/content-grid',
  'acf/feature-section',
  'acf/plans-availability',
  'acf/poi',
])

const SAFE_PROPERTY_OVERVIEW =
  'Thoughtful design, everyday comfort, and room to make each day your own come together in a place created to feel like home.'
const SAFE_LIFESTYLE_COPY =
  'From quiet mornings to lively evenings, each day offers space to settle in, connect, and enjoy life at your own pace.'
const SAFE_RESIDENCE_COPY =
  'Discover spaces imagined for comfort, flexibility, and the moments that turn an address into a home.'
const SAFE_NEIGHBORHOOD_COPY =
  'Discover the character, energy, and everyday possibilities of the neighborhood around home.'
const PENDING_FLOOR_PLANS =
  'Reviewed layouts, pricing, and availability will be added here when available.'

function getSafeHeading(label: string, sectionId?: string): string {
  const context = `${sectionId || ''} ${label}`.toLowerCase()
  if (context.includes('lifestyle')) return 'Made for Every Part of Your Day'
  if (context.includes('residence')) return 'Spaces That Feel Like Home'
  if (context.includes('floor') || context.includes('fp-')) {
    return 'Find the Space That Fits'
  }
  if (context.includes('gallery') || context.includes('gal-')) {
    return 'Picture Life Here'
  }
  if (
    context.includes('neighborhood') ||
    context.includes('poi') ||
    context.includes('nb-')
  ) {
    return 'Connected to What Matters'
  }
  if (context.includes('amenit') || context.includes('am-')) {
    return 'Designed Around Your Day'
  }
  if (context.includes('tour')) return 'Come See It for Yourself'
  if (
    context.includes('welcome') ||
    context.includes('intro') ||
    context.includes('feature')
  ) {
    return 'A More Considered Way to Live'
  }
  return label.trim() || 'Designed for Everyday Living'
}

function getSafeBody(sectionId?: string): string {
  const context = (sectionId || '').toLowerCase()
  if (context.includes('lifestyle')) return SAFE_LIFESTYLE_COPY
  if (context.includes('residence')) return SAFE_RESIDENCE_COPY
  if (
    context.includes('neighborhood') ||
    context.includes('poi') ||
    context.includes('nb-')
  ) {
    return SAFE_NEIGHBORHOOD_COPY
  }
  return SAFE_PROPERTY_OVERVIEW
}

export function createEvidenceSafePlaceholder(
  block: ACFBlockType,
  label: string,
  sectionId?: string
): Record<string, unknown> | null {
  if (!FACT_BEARING_BLOCKS.has(block)) return null

  const heading = getSafeHeading(label, sectionId)
  const body = getSafeBody(sectionId)

  switch (block) {
    case 'acf/content-grid':
      return {
        headline: heading,
        items: [
          {
            headline: 'Space to Settle In',
            description: SAFE_RESIDENCE_COPY,
          },
          {
            headline: 'Room to Connect',
            description: SAFE_LIFESTYLE_COPY,
          },
          {
            headline: 'Designed for Daily Life',
            description: SAFE_PROPERTY_OVERVIEW,
          },
        ],
      }
    case 'acf/plans-availability':
      return {
        headline: 'Floor plans coming soon',
        content: PENDING_FLOOR_PLANS,
        display_style: 'cards',
        show_pricing: false,
        show_availability: false,
      }
    case 'acf/poi':
      return {
        headline: heading,
        intro_text: SAFE_NEIGHBORHOOD_COPY,
        categories: ['restaurants', 'shopping', 'entertainment', 'transit'],
        radius_miles: 1,
      }
    default:
      return {
        headline: heading,
        content: body,
      }
  }
}

export function isEvidenceSafePlaceholder(
  block: ACFBlockType,
  content: Record<string, unknown>
): boolean {
  if (block === 'acf/content-grid') {
    return Array.isArray(content.items) &&
      content.items.some(
        (item) =>
          Boolean(item) &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          [
            SAFE_PROPERTY_OVERVIEW,
            SAFE_LIFESTYLE_COPY,
            SAFE_RESIDENCE_COPY,
          ].includes(
            (item as Record<string, unknown>).description as string
          )
      )
  }
  if (block === 'acf/plans-availability') {
    return (
      content.content === PENDING_FLOOR_PLANS ||
      (content.data_source === 'siteforge' &&
        content.show_pricing === false &&
        content.show_availability === false)
    )
  }
  if (block === 'acf/poi') {
    return (
      content.content === SAFE_NEIGHBORHOOD_COPY ||
      content.intro_text === SAFE_NEIGHBORHOOD_COPY
    )
  }
  return [
    SAFE_PROPERTY_OVERVIEW,
    SAFE_LIFESTYLE_COPY,
    SAFE_RESIDENCE_COPY,
    SAFE_NEIGHBORHOOD_COPY,
  ].includes(content.content as string)
}
