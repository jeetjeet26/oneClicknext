import { describe, expect, it } from 'vitest'
import {
  blueprintPatchOperationSchema,
  blueprintPatchOperationsSchema,
  semanticBlueprintPatchOperationSchema,
  type SiteBlueprint,
} from '@/types/siteforge'
import {
  applyBlueprintPatch,
  DEFAULT_SITE_CONFIGURATION,
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
})
