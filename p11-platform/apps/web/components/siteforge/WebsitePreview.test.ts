import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SiteConfiguration } from '@/types/siteforge'
import {
  buildPreviewNavigation,
  buildSiteChromeModel,
  SitePreviewFooter,
  SitePreviewHeader,
} from './WebsitePreview'
import { previewParitySiteConfiguration } from './fixtures/preview-parity.fixture'

describe('WebsitePreview shared site chrome', () => {
  it('builds the configured navigation hierarchy without changing hrefs', () => {
    const navigation = buildPreviewNavigation(
      previewParitySiteConfiguration.navigation.items
    )

    expect(navigation.map(item => item.id)).toEqual([
      'home',
      'living',
      'resident',
    ])
    expect(navigation[1]?.children).toEqual([
      expect.objectContaining({
        id: 'amenities',
        href: '/amenities/',
      }),
    ])
  })

  it('extracts configured brand, contact, social, legal, and footer content', () => {
    expect(buildSiteChromeModel(previewParitySiteConfiguration)).toEqual({
      brandName: 'Juniper House',
      phone: '(555) 010-2020',
      email: 'hello@juniper.example',
      address: '120 Juniper Street, Portland, OR, 97205',
      socialLinks: [
        {
          label: 'Instagram',
          href: 'https://instagram.com/juniperhouse',
          external: true,
        },
        {
          label: 'Facebook',
          href: 'https://facebook.com/juniperhouse',
          external: true,
        },
      ],
      legalLinks: [
        { label: 'Privacy', href: '/privacy/', external: false },
        {
          label: 'Accessibility',
          href: 'https://legal.example.com/accessibility',
          external: true,
        },
      ],
      footerText: 'Equal Housing Opportunity.',
    })
  })

  it('does not invent missing shared chrome fields or legal URLs', () => {
    const configuration = structuredClone(
      previewParitySiteConfiguration
    ) as Partial<typeof previewParitySiteConfiguration>
    delete configuration.brandName
    delete configuration.contact
    delete configuration.socialLinks
    delete configuration.legalLinks
    delete (configuration.footer as unknown as Record<string, unknown>).text

    const chrome = buildSiteChromeModel(configuration as SiteConfiguration)

    expect(chrome).toEqual({
      brandName: undefined,
      phone: undefined,
      email: undefined,
      address: undefined,
      socialLinks: [],
      legalLinks: [],
      footerText: undefined,
    })
  })

  it('renders complete source-driven header and footer chrome with safe targets', () => {
    const chrome = buildSiteChromeModel(previewParitySiteConfiguration)
    const markup = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SitePreviewHeader, {
          configuration: previewParitySiteConfiguration,
          chrome,
        }),
        React.createElement(SitePreviewFooter, {
          configuration: previewParitySiteConfiguration,
          chrome,
        })
      )
    )

    expect(markup).toContain('Juniper House')
    expect(markup).toContain('src="https://assets.example.com/juniper-house.svg"')
    expect(markup).toContain('href="/amenities/"')
    expect(markup).toContain('href="tel:5550102020"')
    expect(markup).toContain('href="mailto:hello@juniper.example"')
    expect(markup).toContain('120 Juniper Street, Portland, OR, 97205')
    expect(markup).toContain('Equal Housing Opportunity.')
    expect(markup).toContain('href="/privacy/"')
    expect(markup).not.toContain('href="/terms/"')
    expect(markup).toContain(
      'href="https://resident.example.com" target="_blank" rel="noopener noreferrer"'
    )
    expect(markup).toContain(
      'href="https://legal.example.com/accessibility" target="_blank" rel="noopener noreferrer"'
    )
  })
})
