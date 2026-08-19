import { describe, expect, it } from 'vitest'
import { compileSiteForgeRuntimeV3Descriptor } from './runtime-release-compiler'
import { hashSiteForgeContent } from './content-hash'
import { DEFAULT_SITE_CONFIGURATION } from './blueprint'

const legal = {
  sourceVersion: 1,
  sourceHash: 'a'.repeat(64),
  approvedAt: '2026-08-01T00:00:00.000Z',
  effectiveAt: '2026-08-01T00:00:00.000Z',
  policyBodies: {
    privacyPolicy: 'Approved privacy policy.',
    terms: 'Approved terms.',
    accessibility: 'Approved accessibility statement.',
    fairHousing: 'Approved fair housing statement.',
    pricingDisclaimer: 'Approved pricing disclaimer.',
    analyticsConsent: 'Approved analytics consent.',
    communicationsConsent: 'Approved communications consent.',
  },
}

describe('SiteForge runtime v3 release compiler', () => {
  it('deterministically compiles a complete materializable resource graph', () => {
    const input = {
      blueprint: {
        version: 3,
        pages: [
          {
            slug: 'home',
            title: 'Home',
            purpose: 'Introduce the property.',
            seo: {
              title: 'Property Home',
              description:
                'Review approved property details and contact the leasing team.',
              canonicalPath: '/',
              noIndex: false,
              structuredData: ['WebPage'],
            },
            sections: [
              {
                id: 'intro',
                type: 'intro',
                acfBlock: 'acf/text-section',
                order: 0,
                content: {
                  headline: 'Welcome',
                  content: 'Approved property copy.',
                  layout: 'center',
                  background: 'white',
                },
                presentation: {
                  containerMode: 'contained',
                  spacingPreset: 'spacious',
                  motionPreset: 'subtle',
                  breakpointOverrides: {
                    mobile: { spacingPreset: 'compact' },
                  },
                },
                evidenceIds: [],
              },
            ],
          },
        ],
        siteConfiguration: {
          ...structuredClone(DEFAULT_SITE_CONFIGURATION),
          header: {
            ...structuredClone(DEFAULT_SITE_CONFIGURATION.header),
            position: 'static',
          },
          footer: {
            ...structuredClone(DEFAULT_SITE_CONFIGURATION.footer),
            showSocial: false,
          },
        },
        legal,
        analytics: { consentMode: 'required', events: ['page_view'] },
      },
      assetManifest: [],
    }

    const first = compileSiteForgeRuntimeV3Descriptor(input)
    const second = compileSiteForgeRuntimeV3Descriptor(input)

    expect(hashSiteForgeContent(first)).toBe(hashSiteForgeContent(second))
    expect(first.resourceGraph).toMatchObject({
      homepagePageId: 'page:home',
      pages: [{ resourceId: 'page:home', seoId: 'seo:home' }],
      globalComponents: [
        { resourceId: 'component:header' },
        { resourceId: 'component:footer' },
        { resourceId: 'component:navigation' },
        { resourceId: 'component:site-configuration' },
      ],
    })
    expect(
      first.resourceGraph.globalComponents.find(
        component => component.resourceId === 'component:site-configuration'
      )?.data
    ).toEqual(input.blueprint.siteConfiguration)
    expect(first.resourceGraph.legal).toHaveLength(7)
    expect(first.resourceGraph.sections[0]?.data._siteforge_presentation).toEqual(
      input.blueprint.pages[0].sections[0].presentation
    )
    expect(first.operations).toHaveLength(1)
  })
})
