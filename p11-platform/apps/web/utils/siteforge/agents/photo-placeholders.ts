import type { Photo, PhotoStrategy } from './photo-agent'

const PLACEHOLDER_CATEGORIES: PhotoStrategy['photosToGenerate'][number]['category'][] = [
  'hero',
  'amenity',
  'lifestyle',
  'gallery',
]

export function createSiteForgePlaceholderPhotos(
  strategy: PhotoStrategy
): Photo[] {
  const requestedCategories = strategy.photosToGenerate.map(
    (photo) => photo.category
  )
  const categories = [
    ...new Set([...requestedCategories, ...PLACEHOLDER_CATEGORIES]),
  ]
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://hellop11.com'
  ).replace(/\/$/, '')

  return categories.map((category) => ({
    id: `siteforge-placeholder-${category}`,
    url: `${appUrl}/siteforge/property-placeholder.png`,
    type: 'generated' as const,
    category,
    quality: 1,
    scene: `Placeholder for future ${category} property photography`,
    prompt:
      'Deterministic SiteForge placeholder; replace with approved property photography.',
  }))
}
