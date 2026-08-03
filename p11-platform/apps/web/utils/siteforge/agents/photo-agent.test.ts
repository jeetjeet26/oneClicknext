import { describe, expect, it } from 'vitest'
import type { PhotoStrategy } from './photo-agent'
import { createSiteForgePlaceholderPhotos } from './photo-placeholders'

describe('createSiteForgePlaceholderPhotos', () => {
  it('creates explicit replaceable slots when property photography is absent', () => {
    const strategy: PhotoStrategy = {
      uploadedPhotoUsage: [],
      photosToGenerate: [],
      photoGuidelines: {
        lighting: 'natural',
        composition: 'editorial',
        subjects: 'property',
        mood: 'welcoming',
      },
    }

    const placeholders = createSiteForgePlaceholderPhotos(strategy)

    expect(placeholders.map((photo) => photo.category)).toEqual([
      'hero',
      'amenity',
      'lifestyle',
      'gallery',
    ])
    expect(
      placeholders.every(
        (photo) =>
        photo.url.startsWith('https://') &&
        photo.scene?.startsWith('Placeholder for future') === true
      )
    ).toBe(true)
  })
})
