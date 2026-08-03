import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ACFBlockRenderer,
  getCriticalPreviewState,
} from './ACFBlockRenderer'

describe('ACFBlockRenderer critical preview state', () => {
  it('marks hero degraded when slides are missing', () => {
    expect(getCriticalPreviewState('acf/top-slides', {})).toEqual({
      degraded: true,
      reason: 'missing_hero_slides',
    })
  })

  it('marks map degraded when location data is missing', () => {
    expect(getCriticalPreviewState('acf/map', { zoom_level: 15 })).toEqual({
      degraded: true,
      reason: 'missing_map_location',
    })
  })

  it('marks plans degraded when floor-plan inventory is missing', () => {
    expect(getCriticalPreviewState('acf/plans-availability', { data_source: 'yardi' })).toEqual({
      degraded: true,
      reason: 'missing_floor_plan_inventory',
    })
  })

  it('keeps plans healthy when floor plans are provided', () => {
    expect(
      getCriticalPreviewState('acf/plans-availability', {
        floor_plans: [{ id: 'plan-a', bedrooms: 1 }],
      })
    ).toEqual({ degraded: false })
  })

  it('renders floor-plan images and reviewed inventory details', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/plans-availability',
        content: {
          floor_plans: [
            {
              id: 'aurora-a1',
              name: 'Aurora A1',
              bedrooms: 1,
              bathrooms: 1,
              sqft_min: 720,
              rent_min: 2400,
              available_count: 2,
              image_url: 'https://assets.example.com/aurora-a1.jpg',
              image_alt: 'Aurora A1 one-bedroom floor plan',
            },
          ],
          show_pricing: true,
          show_availability: true,
        },
      })
    )

    expect(markup).toContain('Aurora A1 one-bedroom floor plan')
    expect(markup).toContain('1 bedroom · 1 bath · 720 sq ft')
    expect(markup).toContain('From $2,400')
    expect(markup).toContain('2 available')
  })

  it.each([
    {
      blockType: 'acf/top-slides',
      content: {
        slides: [
          {
            headline: 'Welcome home',
            image: {
              url: 'https://assets.example.com/hero.jpg',
              alt: 'Apartment exterior',
            },
          },
        ],
      },
      expectedUrl: 'https://assets.example.com/hero.jpg',
    },
    {
      blockType: 'acf/feature-section',
      content: {
        headline: 'Amenities',
        image: {
          url: 'https://assets.example.com/amenity.jpg',
          alt: 'Rooftop pool',
        },
      },
      expectedUrl: 'https://assets.example.com/amenity.jpg',
    },
    {
      blockType: 'acf/gallery',
      content: {
        images: [
          {
            url: 'https://assets.example.com/gallery.jpg',
            alt: 'Fitness center',
          },
        ],
      },
      expectedUrl: 'https://assets.example.com/gallery.jpg',
    },
    {
      blockType: 'acf/image',
      content: {
        image: {
          url: 'https://assets.example.com/neighborhood.jpg',
          alt: 'Downtown neighborhood',
        },
      },
      expectedUrl: 'https://assets.example.com/neighborhood.jpg',
    },
  ])('renders approved asset URLs for $blockType', ({ blockType, content, expectedUrl }) => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, { blockType, content })
    )

    expect(markup).toContain(`src="${expectedUrl}"`)
  })
})
