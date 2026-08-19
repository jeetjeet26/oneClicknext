import { describe, expect, it } from 'vitest'
import type { GeneratedPage, SiteBlueprint } from '@/types/siteforge'
import {
  inspectSiteForgeManagedPages,
  planSiteForgePageManagerAction,
  siteForgePageManagerActionSchema,
} from './page-manager'

function page(slug: string, title: string, link?: string): GeneratedPage {
  return {
    slug,
    title,
    purpose: `${title} page purpose`,
    seo: {
      title,
      description: `${title} provides clear information and useful next steps for prospective visitors.`,
      canonicalPath: slug === 'home' ? '/' : `/${slug}/`,
      noIndex: false,
      structuredData: ['WebPage'],
    },
    sections: [
      {
        id: `${slug}-overview`,
        type: 'overview',
        acfBlock: 'acf/text-section',
        order: 1,
        reasoning: 'Test section',
        content: {
          headline: title,
          content: `${title} information`,
          layout: 'center',
          background: 'white',
          ...(link ? { link } : {}),
        },
      },
    ],
  }
}

function blueprint(): SiteBlueprint {
  return {
    version: 1,
    updatedAt: '2026-08-18T00:00:00.000Z',
    pages: [
      page('home', 'Home', '/amenities/'),
      page('amenities', 'Amenities'),
      page('privacy', 'Privacy'),
      page('terms', 'Terms'),
      page('accessibility', 'Accessibility'),
    ],
    runtimeRedirects: [],
    siteConfiguration: {
      design: {
        colors: {
          primary: '#111111',
          secondary: '#222222',
          accent: '#333333',
          background: '#ffffff',
          text: '#111111',
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          headingWeight: 600,
        },
        spacing: { containerMaxWidth: '1200px', sectionPadding: '4rem' },
      },
      header: {
        layout: 'logo-left',
        position: 'sticky',
        announcement: {
          enabled: true,
          text: 'Explore',
          link: '/amenities/',
        },
        cta: {
          enabled: true,
          label: 'Amenities',
          href: '/amenities/',
        },
      },
      navigation: {
        style: 'horizontal',
        items: [
          { id: 'home', label: 'Home', href: '/' },
          { id: 'amenities', label: 'Amenities', href: '/amenities/' },
        ],
      },
      footer: {
        layout: 'columns',
        showNavigation: true,
        showContact: true,
        showSocial: true,
      },
      media: { imageTreatment: 'natural' },
      motion: {
        level: 'subtle',
        reducedMotion: 'respect',
        reveal: 'fade',
        durationMs: 300,
        easing: 'ease-out',
      },
      behavior: {
        smoothScroll: true,
        externalLinksNewTab: false,
        backToTop: false,
        cookieConsent: 'required',
      },
    },
    legal: {
      privacyPath: '/privacy',
      termsPath: '/terms',
      accessibilityPath: '/accessibility',
    },
  } as SiteBlueprint
}

describe('SiteForge deterministic page manager', () => {
  it('composes a governed page from structured visitor intent', () => {
    const result = planSiteForgePageManagerAction({
      blueprint: blueprint(),
      action: siteForgePageManagerActionSchema.parse({
        type: 'add',
        slug: 'resident-resources',
        title: 'Resident Resources',
        purpose: 'Help residents find useful community resources.',
        visitorIntent:
          'Residents need one clear place to understand available resources and next steps.',
        navigation: { visible: true, label: 'Resources', order: 2 },
      }),
    })

    expect(result.model).toBe('siteforge-deterministic-page-manager-v1')
    expect(result.operations[0]).toMatchObject({
      op: 'page.upsert',
      page: {
        slug: 'resident-resources',
        sections: [
          { acfBlock: 'acf/text-section' },
          { acfBlock: 'acf/text-section' },
        ],
      },
    })
    expect(result.operations).toContainEqual(
      expect.objectContaining({
        op: 'navigation.update',
        value: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'resident-resources',
              label: 'Resources',
            }),
          ]),
        }),
      })
    )
  })

  it('rejects duplicate slugs and required legal removal', () => {
    expect(() =>
      planSiteForgePageManagerAction({
        blueprint: blueprint(),
        action: {
          type: 'add',
          slug: 'amenities',
          title: 'Other Amenities',
          purpose: 'Explain a different visitor goal in a clear way.',
          visitorIntent:
            'Visitors need another amenities page with the same public URL.',
        },
      })
    ).toThrow(/already uses the slug/)

    expect(() =>
      planSiteForgePageManagerAction({
        blueprint: blueprint(),
        action: {
          type: 'remove',
          pageSlug: 'privacy',
          redirectToSlug: 'home',
        },
      })
    ).toThrow(/required legal pages/)
  })

  it('removes a page with link repair, navigation repair, and redirect plan', () => {
    const result = planSiteForgePageManagerAction({
      blueprint: blueprint(),
      action: {
        type: 'remove',
        pageSlug: 'amenities',
        redirectToSlug: 'home',
      },
    })

    expect(result.operations.map(operation => operation.op)).toEqual(
      expect.arrayContaining([
        'page.remove',
        'section.update',
        'header.update',
        'navigation.update',
        'redirect.upsert',
      ])
    )
    expect(result.operations).toContainEqual(
      expect.objectContaining({
        op: 'redirect.upsert',
        redirect: {
          sourcePath: '/amenities/',
          destination: '/',
          statusCode: 301,
          preserveQuery: true,
        },
      })
    )
  })

  it('renames by stable structured operations and preserves page order', () => {
    const result = planSiteForgePageManagerAction({
      blueprint: blueprint(),
      action: {
        type: 'update',
        pageSlug: 'amenities',
        slug: 'features',
        title: 'Features',
        purpose: 'Present the community features visitors want to understand.',
        navigation: { visible: true, label: 'Features' },
      },
    })

    expect(result.operations.map(operation => operation.op)).toEqual(
      expect.arrayContaining([
        'page.upsert',
        'page.remove',
        'page.move',
        'navigation.update',
        'redirect.upsert',
      ])
    )
    expect(
      result.operations.find(operation => operation.op === 'page.move')
    ).toMatchObject({ pageSlug: 'features', toOrder: 2 })
  })

  it('inspects order, navigation, and protected identities', () => {
    const inspected = inspectSiteForgeManagedPages(blueprint())
    expect(inspected[0]).toMatchObject({
      slug: 'home',
      order: 1,
      required: true,
      navigation: { visible: true },
    })
    expect(inspected.find(page => page.slug === 'privacy')).toMatchObject({
      legal: true,
      required: true,
    })
  })
})
