import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InventoryRevisionPreview } from './InventoryRevisionPreview'

describe('InventoryRevisionPreview', () => {
  it('renders the exact floor-plan block content for operator review', () => {
    const markup = renderToStaticMarkup(
      <InventoryRevisionPreview
        blocks={[
          {
            pageSlug: 'floor-plans',
            pageTitle: 'Floor Plans',
            sectionId: 'plans',
            variant: 'cards',
            content: {
              data_source: 'manual',
              floor_plans: [
                {
                  id: 'aspen',
                  name: 'Aspen',
                  bedrooms: 1,
                  bathrooms: 1,
                  rent_min: 1750,
                  available_count: 2,
                },
              ],
              display_style: 'cards',
              filter_options: ['bedrooms'],
              show_pricing: true,
              show_availability: true,
              freshness_hours: 168,
            },
          },
        ]}
      />
    )

    expect(markup).toContain('Exact SiteForge block preview')
    expect(markup).toContain('Aspen')
    expect(markup).toContain('From $1,750')
    expect(markup).toContain('2 available')
  })
})
