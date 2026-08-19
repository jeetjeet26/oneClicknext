import { describe, expect, it } from 'vitest'
import {
  blueprintPatchOperationSchema,
  blueprintPatchOperationsSchema,
  sectionPresentationSchema,
  semanticBlueprintPatchOperationSchema,
  type SiteBlueprint,
} from '@/types/siteforge'
import {
  applyBlueprintPatch,
  DEFAULT_SITE_CONFIGURATION,
  ensureSectionIds,
} from '@/utils/siteforge/blueprint'

function blueprint(): SiteBlueprint {
  return {
    version: 2,
    updatedAt: '2026-07-30T20:00:00.000Z',
    pages: [],
    siteConfiguration: structuredClone(DEFAULT_SITE_CONFIGURATION),
  }
}

describe('SiteForge semantic blueprint operations', () => {
  it('persists explicit child identities once and preserves them across reorder', () => {
    const pages = ensureSectionIds([
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Introduce the property',
        sections: [
          {
            id: 'hero',
            type: 'hero',
            acfBlock: 'acf/top-slides',
            content: {
              slides: [
                { headline: 'First' },
                { headline: 'Second', target_id: 'slide:second' },
              ],
            },
            reasoning: 'Lead with property imagery',
            order: 0,
          },
        ],
      },
    ])
    const slides = pages[0].sections[0].content.slides as Array<{
      target_id: string
      headline: string
    }>
    const firstId = slides[0].target_id
    const reordered = ensureSectionIds([
      {
        ...pages[0],
        sections: [
          {
            ...pages[0].sections[0],
            content: { slides: [...slides].reverse() },
          },
        ],
      },
    ])
    const reorderedSlides = reordered[0].sections[0].content.slides as Array<{
      target_id: string
    }>

    expect(firstId).toMatch(/^hero:slides:/)
    expect(reorderedSlides.map(item => item.target_id)).toEqual([
      'slide:second',
      firstId,
    ])
  })

  it('applies site-wide design, navigation, motion, and behavior operations', () => {
    const updated = applyBlueprintPatch(blueprint(), [
      {
        version: 2,
        op: 'design.update',
        value: {
          colors: { primary: '#123456' },
          typography: { headingWeight: 700 },
        },
      },
      {
        version: 2,
        op: 'navigation.update',
        value: {
          style: 'drawer',
          items: [
            {
              id: 'amenities',
              label: 'Amenities',
              href: '/amenities/',
            },
          ],
        },
      },
      {
        version: 2,
        op: 'motion.update',
        value: { level: 'prominent', reducedMotion: 'respect' },
      },
      {
        version: 2,
        op: 'behavior.update',
        value: { backToTop: true },
      },
    ])

    expect(updated.siteConfiguration?.design.colors.primary).toBe('#123456')
    expect(updated.siteConfiguration?.design.colors.background).toBe('#ffffff')
    expect(updated.siteConfiguration?.navigation.items[0]?.id).toBe('amenities')
    expect(updated.siteConfiguration?.motion.level).toBe('prominent')
    expect(updated.siteConfiguration?.behavior.backToTop).toBe(true)
  })

  it('rejects unversioned, unknown, and malformed operations', () => {
    expect(() =>
      blueprintPatchOperationsSchema.parse([
        { op: 'design.update', value: { colors: { primary: '#123456' } } },
      ])
    ).toThrow()
    expect(() =>
      blueprintPatchOperationsSchema.parse([
        { version: 2, op: 'database.execute', value: {} },
      ])
    ).toThrow()
    expect(() =>
      blueprintPatchOperationsSchema.parse([
        {
          version: 2,
          op: 'motion.update',
          value: { durationMs: 100_000 },
        },
      ])
    ).toThrow()
  })
})

const legacyBlueprint: SiteBlueprint = {
  version: 1,
  pages: [{
    slug: 'home',
    title: 'Home',
    purpose: 'Introduce the property',
    sections: [{
      id: 'hero',
      type: 'hero',
      acfBlock: 'acf/top-slides',
      content: { headline: 'Welcome' },
      reasoning: 'Lead with the property',
      order: 1,
    }],
  }],
}

describe('semantic blueprint operations', () => {
  it('validates and applies versioned page, section, and site operations', () => {
    const operations = [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'hero',
        value: { content: { headline: 'Live exceptionally' } },
      },
      {
        version: 2,
        op: 'header.update',
        value: {
          position: 'overlay',
          cta: { label: 'Book a tour', href: '/tour/', enabled: true },
        },
      },
      {
        version: 2,
        op: 'motion.update',
        value: { level: 'prominent', reveal: 'slide', durationMs: 450 },
      },
    ] as const

    for (const operation of operations) {
      expect(semanticBlueprintPatchOperationSchema.safeParse(operation).success).toBe(true)
    }
    const result = applyBlueprintPatch(legacyBlueprint, [...operations])

    expect(result.pages[0].sections[0].content).toEqual({ headline: 'Live exceptionally' })
    expect(result.siteConfiguration?.header.position).toBe('overlay')
    expect(result.siteConfiguration?.header.cta.label).toBe('Book a tour')
    expect(result.siteConfiguration?.motion).toMatchObject({
      level: 'prominent',
      reveal: 'slide',
      durationMs: 450,
    })
  })

  it('deep-merges partial section content and presentation', () => {
    const source = structuredClone(legacyBlueprint)
    source.pages[0].sections[0].content = {
      headline: 'Welcome',
      copy: {
        eyebrow: 'Now leasing',
        body: 'Original body',
      },
    }
    source.pages[0].sections[0].presentation = {
      containerMode: 'contained',
      alignment: 'left',
      breakpointOverrides: {
        mobile: { spacingPreset: 'compact', alignment: 'center' },
      },
    }

    const result = applyBlueprintPatch(source, [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'hero',
        value: {
          content: { copy: { body: 'Updated body' } },
          presentation: {
            widthPreset: 'wide',
            breakpointOverrides: {
              mobile: { spacingPreset: 'spacious' },
            },
          },
        },
      },
    ])

    expect(result.pages[0].sections[0].content).toEqual({
      headline: 'Welcome',
      copy: {
        eyebrow: 'Now leasing',
        body: 'Updated body',
      },
    })
    expect(result.pages[0].sections[0].presentation).toEqual({
      containerMode: 'contained',
      alignment: 'left',
      widthPreset: 'wide',
      breakpointOverrides: {
        mobile: { spacingPreset: 'spacious', alignment: 'center' },
      },
    })
  })

  it('updates page metadata partially and moves pages by stable slug', () => {
    const source = structuredClone(legacyBlueprint)
    source.pages.push({
      slug: 'contact',
      title: 'Contact',
      purpose: 'Make contact',
      sections: [],
      seo: {
        title: 'Contact us',
        description: 'Contact the property team to learn more about available homes.',
        canonicalPath: '/contact/',
        noIndex: false,
        structuredData: ['WebPage'],
      },
    })

    const result = applyBlueprintPatch(source, [
      {
        version: 2,
        op: 'page.update',
        pageSlug: 'contact',
        value: {
          title: 'Connect',
          seo: { canonicalPath: '/connect/' },
        },
      },
      {
        version: 2,
        op: 'page.move',
        pageSlug: 'contact',
        toOrder: 1,
      },
    ])

    expect(result.pages.map(page => page.slug)).toEqual(['contact', 'home'])
    expect(result.pages[0]).toMatchObject({
      title: 'Connect',
      seo: {
        title: 'Contact us',
        canonicalPath: '/connect/',
        noIndex: false,
      },
    })
  })

  it('upserts deterministic runtime redirects by source path', () => {
    const source = structuredClone(legacyBlueprint)
    const first = applyBlueprintPatch(source, [
      {
        version: 2,
        op: 'redirect.upsert',
        redirect: {
          sourcePath: '/old-page/',
          destination: '/home/',
          statusCode: 301,
          preserveQuery: true,
        },
      },
    ])
    const updated = applyBlueprintPatch(first, [
      {
        version: 2,
        op: 'redirect.upsert',
        redirect: {
          sourcePath: '/old-page/',
          destination: '/',
          statusCode: 308,
          preserveQuery: false,
        },
      },
    ])

    expect(updated.runtimeRedirects).toEqual([
      {
        sourcePath: '/old-page/',
        destination: '/',
        statusCode: 308,
        preserveQuery: false,
      },
    ])
  })

  it('validates the complete merged section after a partial update', () => {
    const source = structuredClone(legacyBlueprint)
    source.pages[0].sections[0].variant = 'cinematic'

    expect(() =>
      applyBlueprintPatch(source, [
        {
          version: 2,
          op: 'section.update',
          sectionId: 'hero',
          value: { acfBlock: 'acf/text-section' },
        },
      ])
    ).toThrow(/Unsupported acf\/text-section variant/)
  })

  it('validates typed section presentation presets and overrides', () => {
    expect(
      sectionPresentationSchema.parse({
        containerMode: 'full-bleed',
        alignment: 'center',
        widthPreset: 'full',
        spacingPreset: 'spacious',
        typographyPreset: 'display',
        motionPreset: 'expressive',
        breakpointOverrides: {
          mobile: {
            containerMode: 'contained',
            spacingPreset: 'compact',
          },
        },
      })
    ).toMatchObject({ motionPreset: 'expressive' })
    expect(
      sectionPresentationSchema.safeParse({
        breakpointOverrides: { mobile: { spacingPreset: 'giant' } },
      }).success
    ).toBe(false)
  })

  it.each([
    { version: 1, op: 'motion.update', value: { level: 'subtle' } },
    { version: 2, op: 'motion.update', value: { durationMs: -1 } },
    { version: 2, op: 'header.update', value: { position: 'floating' } },
    { version: 2, op: 'navigation.update', value: { items: [{ label: 'Home' }] } },
    { version: 2, op: 'section.update', sectionId: '', value: {} },
  ])('rejects malformed semantic operation %#', operation => {
    expect(semanticBlueprintPatchOperationSchema.safeParse(operation).success).toBe(false)
  })

  it('accepts legacy section operations at the compatibility boundary', () => {
    expect(blueprintPatchOperationSchema.safeParse({
      op: 'update_section',
      sectionId: 'hero',
      content: { headline: 'Legacy edit' },
    }).success).toBe(true)
  })

  it.each([
    {
      version: 2,
      op: 'section.update',
      sectionId: 'missing',
      value: { label: 'Missing' },
    },
    { version: 2, op: 'section.remove', sectionId: 'missing' },
    {
      version: 2,
      op: 'section.move',
      sectionId: 'missing',
      toOrder: 1,
    },
    { version: 2, op: 'page.remove', pageSlug: 'missing' },
    {
      version: 2,
      op: 'section.upsert',
      pageSlug: 'missing',
      section: {
        type: 'text',
        acfBlock: 'acf/text-section',
        content: {},
        reasoning: 'Test',
      },
    },
  ] as const)('throws when $op targets missing structure', operation => {
    expect(() =>
      applyBlueprintPatch(legacyBlueprint, [operation])
    ).toThrow(/target .* was not found/)
  })

  it('rejects empty and no-effect updates explicitly', () => {
    expect(() =>
      applyBlueprintPatch(legacyBlueprint, [
        {
          version: 2,
          op: 'section.update',
          sectionId: 'hero',
          value: {},
        },
      ])
    ).toThrow(/requires at least one field/)

    expect(() =>
      applyBlueprintPatch(legacyBlueprint, [
        {
          version: 2,
          op: 'section.update',
          sectionId: 'hero',
          value: { content: { headline: 'Welcome' } },
        },
      ])
    ).toThrow('had no effect')
  })

  it('rejects unsupported variants after applying a section update', () => {
    expect(() =>
      applyBlueprintPatch(legacyBlueprint, [
        {
          version: 2,
          op: 'section.update',
          sectionId: 'hero',
          value: { variant: 'invented-layout' },
        },
      ])
    ).toThrow(/Unsupported acf\/top-slides variant/)
  })
})
