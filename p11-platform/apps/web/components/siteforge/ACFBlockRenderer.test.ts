import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ACFBlockRenderer,
  EXPLICIT_ACF_PREVIEW_BLOCK_TYPES,
  accessibleTextColor,
  getCriticalPreviewState,
} from './ACFBlockRenderer'
import { ACF_BLOCK_TYPES } from '@/types/siteforge'
import {
  maliciousHtmlPreviewFixtures,
  registeredBlockPreviewFixtures,
} from './fixtures/preview-parity.fixture'

describe('ACFBlockRenderer critical preview state', () => {
  it('isolates generated previews from the app theme', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/text-section',
        blockIdentity: 'light-preview',
        content: {
          background: 'light',
          headline: 'A light generated surface',
          content: '<p>Readable in either app theme.</p>',
        },
      })
    )

    expect(markup).toContain('siteforge-preview-light')
    expect(markup).not.toContain('dark:')
  })

  it('chooses readable foregrounds for generated brand colors', () => {
    expect(accessibleTextColor('#ffffff')).toBe('#111827')
    expect(accessibleTextColor('#fef08a')).toBe('#111827')
    expect(accessibleTextColor('#111827')).toBe('#ffffff')
    expect(accessibleTextColor('#4338ca')).toBe('#ffffff')
  })

  it('keeps explicit renderer coverage aligned with every registered ACF block', () => {
    expect([...EXPLICIT_ACF_PREVIEW_BLOCK_TYPES].sort()).toEqual(
      [...ACF_BLOCK_TYPES].sort()
    )
  })

  it.each(ACF_BLOCK_TYPES)(
    'renders an explicit approximation or degraded state for %s',
    blockType => {
      const markup = renderToStaticMarkup(
        React.createElement(ACFBlockRenderer, {
          blockType,
          blockIdentity: `fixture-${blockType}`,
          content: registeredBlockPreviewFixtures[blockType],
        })
      )

      expect(markup).toContain(`data-acf-block="${blockType}"`)
      expect(markup).not.toContain('Unsupported block type')
      expect(markup.length).toBeGreaterThan(80)
    }
  )

  it('renders the actual governed-component render_plan tree with field resolution', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/governed-component',
        blockIdentity: 'governed-tree',
        content: {
          component_key: 'property-highlight@1.0.0',
          descriptor_hash: 'd'.repeat(64),
          render_plan: {
            nodeId: 'root',
            primitive: 'section',
            classes: ['property-highlight'],
            properties: {},
            accessibility: {
              role: 'region',
              name: { field: 'headline' },
              description: null,
              keyboard: [],
              focusPolicy: 'none',
              liveRegion: 'off',
            },
            children: [
              {
                nodeId: 'root-title',
                primitive: 'text',
                classes: [],
                properties: { value: { field: 'headline' } },
                accessibility: {
                  role: null,
                  name: null,
                  description: null,
                  keyboard: [],
                  focusPolicy: 'none',
                  liveRegion: 'off',
                },
                children: [],
              },
              {
                nodeId: 'root-cta',
                primitive: 'button',
                classes: ['cta'],
                properties: {
                  label: { field: 'cta-label' },
                  href: { field: 'cta-url' },
                },
                accessibility: {
                  role: null,
                  name: null,
                  description: null,
                  keyboard: ['Enter'],
                  focusPolicy: 'natural',
                  liveRegion: 'off',
                },
                children: [],
              },
            ],
          },
          component_values: {
            headline: 'Rooftop lounge',
            'cta-label': 'Book a tour',
            'cta-url': '/tour',
          },
        },
      })
    )

    // Same tag mapping and field resolution as blocks/governed-component.php.
    expect(markup).toContain('data-siteforge-component="property-highlight@1.0.0"')
    expect(markup).toContain('governed-section property-highlight')
    expect(markup).toContain('<p class="governed-text"')
    expect(markup).toContain('Rooftop lounge')
    expect(markup).toContain('href="/tour"')
    expect(markup).toContain('Book a tour')
    expect(markup).toContain('aria-label="Rooftop lounge"')
  })

  it('degrades clearly when a governed component has no valid render plan', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/governed-component',
        blockIdentity: 'governed-broken',
        content: {
          component_key: 'property-highlight@1.0.0',
          descriptor_hash: 'd'.repeat(64),
          render_plan: { nodeId: 'root', primitive: 'unknown-primitive' },
          component_values: {},
        },
      })
    )

    expect(markup).toContain('data-preview-state="degraded"')
    expect(markup).toContain('Governed component preview unavailable')
  })

  it('marks hero degraded when slides are missing', () => {
    expect(getCriticalPreviewState('acf/top-slides', {})).toEqual({
      degraded: true,
      reason: 'missing_hero_slides',
    })
  })

  it('tightens the existing minimal hero without changing slide content', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/top-slides',
        blockIdentity: 'minimal-hero',
        variant: 'minimal',
        content: registeredBlockPreviewFixtures['acf/top-slides'],
      })
    )

    expect(markup).toContain('data-siteforge-variant="minimal"')
    expect(markup).toContain('min-h-[360px] md:min-h-[440px]')
    expect(markup).toContain(
      'text-[clamp(2.25rem,10vw,3.4rem)] md:text-[clamp(2.75rem,5.2vw,5.4rem)]'
    )
    expect(markup.match(/Rooted in the city/g)).toHaveLength(1)
  })

  it('marks map degraded when location data is missing', () => {
    expect(getCriticalPreviewState('acf/map', { zoom_level: 15 })).toEqual({
      degraded: true,
      reason: 'missing_map_location',
    })
  })

  it('keeps a map healthy with a sourced address and renders keyless directions', () => {
    const content = {
      address: '120 Juniper Street, Portland, OR 97205',
      show_directions: true,
      zoom_level: 15,
    }
    expect(getCriticalPreviewState('acf/map', content)).toEqual({
      degraded: false,
    })

    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/map',
        blockIdentity: 'neighborhood-map',
        content,
      })
    )

    expect(markup).toContain('120 Juniper Street, Portland, OR 97205')
    expect(markup).toContain('Get directions')
    expect(markup).toContain('https://www.google.com/maps/dir/?api=1')
    expect(markup).toContain('keyless location fallback')
  })

  it('marks unsupported form providers degraded', () => {
    expect(
      getCriticalPreviewState('acf/form', {
        provider: 'csv_export',
      })
    ).toEqual({
      degraded: true,
      reason: 'unsupported_form_provider',
    })
  })

  it('derives duplicate-safe form control IDs from each section identity', () => {
    const content = registeredBlockPreviewFixtures['acf/form']
    const markup = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ACFBlockRenderer, {
          blockType: 'acf/form',
          blockIdentity: 'contact-primary',
          content,
        }),
        React.createElement(ACFBlockRenderer, {
          blockType: 'acf/form',
          blockIdentity: 'contact-secondary',
          content,
        })
      )
    )
    const ids = [...markup.matchAll(/id="([^"]+-(?:name|email|phone|message))"/g)].map(
      match => match[1]
    )

    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    for (const id of ids) {
      expect(markup).toContain(`for="${id}"`)
    }
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
        blockIdentity: 'floor-plans',
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
      React.createElement(ACFBlockRenderer, {
        blockType,
        blockIdentity: `asset-${blockType}`,
        content,
      })
    )

    expect(markup).toContain(`src="${expectedUrl}"`)
  })

  it('preserves external links with safe new-tab attributes', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ACFBlockRenderer, {
        blockType: 'acf/links',
        blockIdentity: 'apply-links',
        content: {
          links: [
            {
              text: 'Apply',
              url: 'https://leasing.example.com/apply',
              style: 'primary',
            },
          ],
        },
      })
    )

    expect(markup).toContain('href="https://leasing.example.com/apply"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
  })

  it('sanitizes every HTML-bearing preview field with the shared allowlist', () => {
    const markup = [
      ['acf/text-section', maliciousHtmlPreviewFixtures.text],
      ['acf/feature-section', maliciousHtmlPreviewFixtures.feature],
      ['acf/accordion-section', maliciousHtmlPreviewFixtures.accordion],
    ]
      .map(([blockType, content], index) =>
        renderToStaticMarkup(
          React.createElement(ACFBlockRenderer, {
            blockType: String(blockType),
            blockIdentity: `malicious-${index}`,
            content,
          })
        )
      )
      .join('')

    expect(markup).toContain('<strong>home</strong>')
    expect(markup).toContain('Learn more')
    expect(markup).toContain('Reviewed answer.')
    expect(markup).not.toMatch(/<script|<iframe|<img/i)
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i)
    expect(markup).not.toMatch(/javascript:/i)
    expect(markup).not.toContain('alert(&quot;unsafe&quot;)')
  })
})
