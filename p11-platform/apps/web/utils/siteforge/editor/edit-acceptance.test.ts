import { describe, expect, it } from 'vitest'
import type { BlueprintPatchOperation, SiteBlueprint } from '@/types/siteforge'
import {
  deriveSiteForgeEditAcceptanceContract,
  evaluateSiteForgeRenderedEditEvidence,
  type SiteForgeRenderedEditObservation,
} from './edit-acceptance'

const parentArtifact = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  contentHash: 'a'.repeat(64),
}
const editedArtifact = {
  artifactId: '22222222-2222-4222-8222-222222222222',
  contentHash: 'b'.repeat(64),
}

function blueprint(headline = 'Original', color = '#111111'): SiteBlueprint {
  return {
    version: 1,
    updatedAt: '2026-08-18T00:00:00.000Z',
    pages: [
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Convert',
        sections: [
          {
            id: 'home-hero',
            type: 'hero',
            acfBlock: 'acf/top-slides',
            content: { headline },
            reasoning: 'Lead',
            order: 1,
          },
          {
            id: 'home-story',
            type: 'text',
            acfBlock: 'acf/text-section',
            content: { headline: 'Unchanged story' },
            reasoning: 'Story',
            order: 2,
          },
        ],
      },
    ],
    siteConfiguration: {
      design: {
        colors: {
          primary: color,
          secondary: '#222222',
          accent: '#333333',
          background: '#ffffff',
          text: '#111111',
        },
        typography: {
          headingFont: 'Inter, sans-serif',
          bodyFont: 'Inter, sans-serif',
          headingWeight: 600,
        },
        spacing: {
          containerMaxWidth: '1200px',
          sectionPadding: '4rem',
        },
      },
      header: {
        layout: 'logo-left',
        position: 'sticky',
        announcement: { enabled: false, text: '' },
        cta: { enabled: true, label: 'Tour', href: '/tour/' },
      },
      navigation: { style: 'horizontal', items: [] },
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
  }
}

describe('SiteForge edit acceptance contracts', () => {
  it('derives changed selectors, rendered expectations, viewports, and unchanged regions', () => {
    const before = blueprint()
    const after = blueprint('A warmer welcome', '#884422')
    const operations = [
      {
        version: 2,
        op: 'section.update',
        sectionId: 'home-hero',
        value: { content: { headline: 'A warmer welcome' } },
        reasoning: 'Update the exact hero',
      },
      {
        version: 2,
        op: 'design.update',
        value: { colors: { primary: '#884422' } },
        reasoning: 'Warm the palette',
      },
    ] as BlueprintPatchOperation[]

    const contract = deriveSiteForgeEditAcceptanceContract({
      before,
      after,
      operations,
      parentArtifact,
      editedArtifact,
    })

    expect(contract.changedResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/pages/home/sections/home-hero',
          selector:
            '[id="home-hero"],[data-siteforge-section-id="home-hero"]',
        }),
      ])
    )
    expect(contract.expectedText).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'A warmer welcome' }),
      ])
    )
    expect(contract.expectedComputedStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: '--color-primary',
          value: '#884422',
          mustDifferFromParent: true,
        }),
      ])
    )
    expect(contract.requiredViewports).toEqual([
      'desktop',
      'tablet',
      'mobile',
    ])
    expect(contract.unchangedRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/pages/home/sections/home-story',
        }),
      ])
    )
  })

  it('fails with repair-ready details for ineffective CSS and unmatched selectors', () => {
    const contract = deriveSiteForgeEditAcceptanceContract({
      before: blueprint(),
      after: blueprint('A warmer welcome', '#884422'),
      operations: [
        {
          version: 2,
          op: 'design.update',
          value: { colors: { primary: '#884422' } },
          reasoning: 'Warm the palette',
        },
      ] as BlueprintPatchOperation[],
      parentArtifact,
      editedArtifact,
    })
    const observations: SiteForgeRenderedEditObservation[] =
      contract.requiredViewports.flatMap(viewport => [
        {
          phase: 'parent',
          viewport,
          pageSlug: 'home',
          selector: ':root',
          matched: 1,
          text: '',
          attributes: {},
          computedStyles: { '--color-primary': '#884422' },
          interactionAttributes: {},
          regionHash: 'c'.repeat(64),
        },
        {
          phase: 'edited',
          viewport,
          pageSlug: 'home',
          selector: ':root',
          matched: 1,
          text: '',
          attributes: {},
          computedStyles: { '--color-primary': '#884422' },
          interactionAttributes: {},
          regionHash: 'c'.repeat(64),
        },
        ...contract.unchangedRegions.flatMap(region => [
          {
            phase: 'parent' as const,
            viewport,
            pageSlug: region.pageSlug,
            selector: region.selector,
            matched: 1,
            text: 'Unchanged story',
            attributes: {},
            computedStyles: {},
            interactionAttributes: {},
            regionHash: 'd'.repeat(64),
          },
          {
            phase: 'edited' as const,
            viewport,
            pageSlug: region.pageSlug,
            selector: region.selector,
            matched: 1,
            text: 'Unchanged story',
            attributes: {},
            computedStyles: {},
            interactionAttributes: {},
            regionHash: 'd'.repeat(64),
          },
        ]),
      ])
    const evidence = evaluateSiteForgeRenderedEditEvidence({
      contract,
      parentTargetUrl: 'https://parent.example.com/',
      editedTargetUrl: 'https://edited.example.com/',
      observations,
    })

    expect(evidence.passed).toBe(false)
    expect(evidence.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ineffective_style_change',
          repairHint: expect.stringContaining('ineffective CSS'),
        }),
      ])
    )
  })
})
