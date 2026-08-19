import { describe, expect, it } from 'vitest'
import type {
  BlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import {
  assertSiteForgeEditorDiffInScope,
  assertSiteForgeEditorOperationsInScope,
  deriveSiteForgeEditorScopeForOperations,
  resolveSiteForgeEditorScope,
  siteForgeEditorAffectedPaths,
  siteForgeEditorResourcePathSchema,
} from './scope'

function blueprint(): SiteBlueprint {
  return {
    version: 1,
    updatedAt: '2026-08-17T00:00:00.000Z',
    pages: [
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Home',
        seo: {
          title: 'Home',
          description: 'Home page',
          canonicalPath: '/',
          noIndex: false,
          structuredData: ['WebPage'],
        },
        sections: [
          {
            id: 'home-hero',
            type: 'Hero',
            acfBlock: 'acf/top-slides',
            order: 1,
            content: {
              slides: [
                {
                  headline: 'Original',
                  subheadline: 'Original subtitle',
                  cta_text: 'Contact',
                  cta_link: '/contact',
                },
              ],
              autoplay: false,
              overlay_style: 'gradient',
            },
            reasoning: 'Hero',
          },
          {
            id: 'home-story',
            type: 'Story',
            acfBlock: 'acf/text-section',
            order: 2,
            content: {
              headline: 'Story',
              content: 'Story copy',
              layout: 'center',
              background: 'white',
            },
            reasoning: 'Story',
          },
        ],
      },
      {
        slug: 'contact',
        title: 'Contact',
        purpose: 'Contact',
        seo: {
          title: 'Contact',
          description: 'Contact page',
          canonicalPath: '/contact',
          noIndex: false,
          structuredData: ['WebPage'],
        },
        sections: [],
      },
    ],
  }
}

describe('SiteForge editor scope', () => {
  it('resolves legacy element context as an exact section scope', () => {
    expect(
      resolveSiteForgeEditorScope({
        elementContext: {
          pageSlug: 'home',
          sectionId: 'home-hero',
          blockType: 'acf/top-slides',
        },
      })
    ).toEqual({
      kind: 'section',
      pageSlug: 'home',
      sectionId: 'home-hero',
      blockType: 'acf/top-slides',
    })
  })

  it('derives the effective scope from the accepted operations without asking for authorization', () => {
    const sectionOperations = [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-hero',
        value: { purpose: 'Updated purpose' },
      },
    ] as BlueprintPatchOperation[]
    expect(
      deriveSiteForgeEditorScopeForOperations({
        blueprint: blueprint(),
        operations: sectionOperations,
      })
    ).toMatchObject({
      kind: 'section',
      pageSlug: 'home',
      sectionId: 'home-hero',
    })

    expect(
      deriveSiteForgeEditorScopeForOperations({
        blueprint: blueprint(),
        operations: [
          ...sectionOperations,
          {
            version: 2,
            op: 'design.update',
            value: { colors: { primary: '#123456' } },
          },
        ] as BlueprintPatchOperation[],
      })
    ).toEqual({ kind: 'site' })
  })

  it('allows only the exact selected section', () => {
    const operations = [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-hero',
        value: { purpose: 'Updated purpose' },
      },
    ] as BlueprintPatchOperation[]
    const scope = {
      kind: 'section' as const,
      pageSlug: 'home',
      sectionId: 'home-hero',
      blockType: 'acf/top-slides',
    }
    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations,
        scope,
      })
    ).not.toThrow()
    const after = applyBlueprintPatch(blueprint(), operations)
    expect(() =>
      assertSiteForgeEditorDiffInScope({
        before: blueprint(),
        after,
        scope,
      })
    ).not.toThrow()
    expect(siteForgeEditorAffectedPaths(operations)).toEqual([
      '/sections/by-id/home-hero/purpose',
    ])
  })

  it('does not renumber unrelated legacy sections during a targeted content edit', () => {
    const before = blueprint()
    before.pages[0].sections[0].order = 0
    before.pages[0].sections[1].order = 7
    before.pages[1].sections = [
      {
        id: 'contact-form',
        type: 'Form',
        acfBlock: 'acf/form',
        order: 12,
        content: {
          form_type: 'contact',
          provider: 'p11_lumaleasing',
          heading: 'Contact',
          subheading: '',
          consent_text: '',
        },
        reasoning: 'Contact form',
      },
    ]
    const operations = [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-hero',
        value: {
          content: {
            slides: [
              {
                headline: 'Resort-caliber living, made for family life.',
                subheadline: 'Long positioning statement',
                cta_text: 'Contact',
                cta_link: '/contact',
              },
            ],
            autoplay: false,
            overlay_style: 'gradient',
          },
        },
      },
    ] as BlueprintPatchOperation[]
    const scope = {
      kind: 'section' as const,
      pageSlug: 'home',
      sectionId: 'home-hero',
      blockType: 'acf/top-slides',
    }

    const after = applyBlueprintPatch(before, operations)

    expect(after.pages[0].sections.map(section => section.order)).toEqual([0, 7])
    expect(after.pages[1].sections[0].order).toBe(12)
    expect(() =>
      assertSiteForgeEditorDiffInScope({ before, after, scope })
    ).not.toThrow()
  })

  it('rejects cross-section and global operations for a section target', () => {
    const scope = {
      kind: 'section' as const,
      pageSlug: 'home',
      sectionId: 'home-hero',
    }
    for (const operation of [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-story',
        value: { purpose: 'Wrong section' },
      },
      {
        version: 2,
        op: 'design.update',
        value: { colors: { text: '#111111' } },
      },
    ] as BlueprintPatchOperation[]) {
      expect(() =>
        assertSiteForgeEditorOperationsInScope({
          blueprint: blueprint(),
          operations: [operation],
          scope,
        })
      ).toThrow(/edit_scope_violation/)
    }
  })

  it('rejects synthetic or mismatched immutable section identities', () => {
    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations: [
          {
            version: 2,
            op: 'section.update',
            sectionId: 'home-section-1',
            value: { purpose: 'Synthetic target' },
          },
        ],
        scope: {
          kind: 'section',
          pageSlug: 'home',
          sectionId: 'home-section-1',
        },
      })
    ).toThrow(/edit_scope_invalid/)
  })

  it('allows page-local operations and rejects cross-page changes', () => {
    const scope = { kind: 'page' as const, pageSlug: 'home' }
    const local = {
      version: 2,
      op: 'section.update',
      sectionId: 'home-story',
      value: { purpose: 'Updated' },
    } as BlueprintPatchOperation
    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations: [local],
        scope,
      })
    ).not.toThrow()
    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations: [
          {
            version: 2,
            op: 'page.remove',
            pageSlug: 'contact',
          },
        ],
        scope,
      })
    ).toThrow(/edit_scope_violation/)
  })

  it('allows page metadata updates and page moves only for the selected page', () => {
    const scope = { kind: 'page' as const, pageSlug: 'home' }
    const operations = [
      {
        version: 2,
        op: 'page.update',
        pageSlug: 'home',
        value: {
          title: 'Welcome home',
          seo: { canonicalPath: '/welcome/' },
        },
      },
      {
        version: 2,
        op: 'page.move',
        pageSlug: 'home',
        toOrder: 2,
      },
    ] as BlueprintPatchOperation[]

    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations,
        scope,
      })
    ).not.toThrow()
    const after = applyBlueprintPatch(blueprint(), operations)
    expect(() =>
      assertSiteForgeEditorDiffInScope({
        before: blueprint(),
        after,
        scope,
      })
    ).not.toThrow()
    expect(siteForgeEditorAffectedPaths(operations)).toEqual([
      '/pages/by-slug/home/title',
      '/pages/by-slug/home/seo/canonicalPath',
      '/pages/by-slug/home/@position',
    ])

    expect(() =>
      assertSiteForgeEditorOperationsInScope({
        blueprint: blueprint(),
        operations: [
          {
            version: 2,
            op: 'page.move',
            pageSlug: 'contact',
            toOrder: 1,
          },
        ],
        scope,
      })
    ).toThrow(/edit_scope_violation/)
  })

  it('emits validated stable nested resource paths', () => {
    const paths = siteForgeEditorAffectedPaths([
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-hero',
        value: {
          content: {
            slides: [{ headline: 'Updated' }],
          },
          presentation: {
            breakpointOverrides: {
              mobile: { alignment: 'center' },
            },
          },
        },
      },
    ])

    expect(paths).toEqual([
      '/sections/by-id/home-hero/content/slides',
      '/sections/by-id/home-hero/presentation/breakpointOverrides/mobile/alignment',
    ])
    expect(
      paths.every(path => siteForgeEditorResourcePathSchema.safeParse(path).success)
    ).toBe(true)
    expect(
      siteForgeEditorResourcePathSchema.safeParse(
        '/pages/*/sections/home-hero'
      ).success
    ).toBe(false)
  })
})
