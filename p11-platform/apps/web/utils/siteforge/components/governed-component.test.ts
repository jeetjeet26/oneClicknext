import { describe, expect, it } from 'vitest'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { runtimeV3SectionSchema } from '@/utils/siteforge/runtime-contract-v3'
import {
  compileGovernedComponent,
  registerGovernedComponentPackage,
} from './governed-component'
import { buildSignedGovernedComponentPackage } from './governed-component-repository'

function descriptor() {
  return {
    schemaVersion: 1 as const,
    componentId: 'property-highlight',
    version: '1.0.0',
    displayName: 'Property highlight',
    fields: [
      {
        fieldId: 'headline',
        label: 'Headline',
        type: 'string' as const,
        required: true,
      },
      {
        fieldId: 'image',
        label: 'Image',
        type: 'image_asset' as const,
        required: true,
      },
    ],
    root: {
      nodeId: 'root',
      primitive: 'section' as const,
      classes: ['property-highlight'],
      properties: {},
      accessibility: {
        role: 'region',
        name: { field: 'headline' },
        description: null,
        keyboard: [],
        focusPolicy: 'none' as const,
        liveRegion: 'off' as const,
      },
      children: [
        {
          nodeId: 'content',
          primitive: 'stack' as const,
          classes: ['property-highlight-content'],
          properties: { gap: '1rem' },
          accessibility: {
            role: null,
            name: null,
            description: null,
            keyboard: [],
            focusPolicy: 'none' as const,
            liveRegion: 'off' as const,
          },
          children: [
            {
              nodeId: 'headline',
              primitive: 'text' as const,
              classes: ['property-highlight-headline'],
              properties: { value: { field: 'headline' } },
              accessibility: {
                role: 'heading',
                name: { field: 'headline' },
                description: null,
                keyboard: [],
                focusPolicy: 'none' as const,
                liveRegion: 'off' as const,
              },
              children: [],
            },
            {
              nodeId: 'image',
              primitive: 'image' as const,
              classes: ['property-highlight-image'],
              properties: { asset: { field: 'image' } },
              accessibility: {
                role: 'img',
                name: { field: 'headline' },
                description: null,
                keyboard: [],
                focusPolicy: 'none' as const,
                liveRegion: 'off' as const,
              },
              children: [],
            },
          ],
        },
      ],
    },
    responsiveRules: [
      {
        ruleId: 'mobile-stack',
        nodeId: 'content',
        minWidthPx: null,
        maxWidthPx: 767,
        declarations: { gap: '0.75rem' },
      },
    ],
    accessibilityContract: {
      standard: 'WCAG-2.2-AA' as const,
      headingPolicy: 'section-heading' as const,
      landmarkPolicy: 'required' as const,
      requiresVisibleFocus: true as const,
      supportsReducedMotion: true as const,
    },
    certificationScenarios: [
      {
        scenarioId: 'desktop',
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light' as const,
        reducedMotion: false,
        interactions: [],
        assertions: [
          { rule: 'axe' as const, nodeId: null },
          { rule: 'selection_map_exact' as const, nodeId: 'headline' },
        ],
      },
      {
        scenarioId: 'mobile-reduced-motion',
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark' as const,
        reducedMotion: true,
        interactions: [],
        assertions: [
          { rule: 'reduced_motion' as const, nodeId: null },
          { rule: 'no_overflow' as const, nodeId: 'root' },
        ],
      },
    ],
  }
}

describe('governed reusable component compiler', () => {
  it('compiles deterministic safe render, selection, a11y, and certification plans', () => {
    const first = compileGovernedComponent(descriptor())
    const second = compileGovernedComponent(descriptor())

    expect(hashSiteForgeContent(first)).toBe(hashSiteForgeContent(second))
    expect(first.selectionMap.headline).toMatchObject({
      primitive: 'text',
      selector:
        '[data-siteforge-target-id="component:property-highlight@1.0.0/node:headline"]',
    })
    expect(first.catalogs).toEqual({
      v2: {
        blockName: 'acf/governed-component',
        componentKey: 'property-highlight@1.0.0',
      },
      v3: {
        blockName: 'acf/governed-component',
        componentKey: 'property-highlight@1.0.0',
        descriptorHash: first.descriptorHash,
      },
    })
    expect(Object.isFrozen(first.renderPlan)).toBe(true)
  })

  it('registers only an exact data-only package in both catalogs', () => {
    const compiled = compileGovernedComponent(descriptor())
    const registered = registerGovernedComponentPackage({
      compiled,
      package: {
        format: 'siteforge-governed-component-package-v1',
        componentId: compiled.componentId,
        componentVersion: compiled.componentVersion,
        compilerVersion: compiled.compilerVersion,
        descriptorSha256: compiled.descriptorHash,
        packageSha256: 'b'.repeat(64),
        files: [
          {
            path: 'component.json',
            mediaType: 'application/json',
            byteSha256: compiled.descriptorHash,
          },
        ],
      },
    })

    expect(registered.v3.packageSha256).toBe('b'.repeat(64))
    expect(registered.v2).toEqual({
      blockName: 'acf/governed-component',
      componentKey: 'property-highlight@1.0.0',
    })
    expect(
      runtimeV3SectionSchema.parse({
        resourceId: 'section:governed',
        contentHash: 'a'.repeat(64),
        pageId: 'page:home',
        sectionType: 'type:governed',
        blockName: registered.v3.blockName,
        order: 0,
        variant: 'governed',
        anchor: null,
        cssClasses: [],
        data: {
          component_key: registered.v3.componentKey,
          descriptor_hash: registered.v3.descriptorHash,
          render_plan: compiled.renderPlan,
        },
        assetIds: [],
        formId: null,
        integrationIds: [],
      }).blockName
    ).toBe('acf/governed-component')
    expect(() =>
      registerGovernedComponentPackage({
        compiled,
        package: {
          format: 'siteforge-governed-component-package-v1',
          componentId: compiled.componentId,
          componentVersion: compiled.componentVersion,
          compilerVersion: compiled.compilerVersion,
          descriptorSha256: 'c'.repeat(64),
          packageSha256: 'b'.repeat(64),
          files: [
            {
              path: 'component.json',
              mediaType: 'application/json',
              byteSha256: 'c'.repeat(64),
            },
          ],
        },
      })
    ).toThrow('exact compiled descriptor')
  })

  it('fails closed for arbitrary primitives and unknown field bindings', () => {
    const unsafe = descriptor()
    unsafe.root.children[0].children[0].primitive = 'script' as never
    expect(() => compileGovernedComponent(unsafe)).toThrow()

    const unknown = descriptor()
    unknown.root.children[0].children[0].properties = {
      value: { field: 'missing' },
    }
    expect(() => compileGovernedComponent(unknown)).toThrow(
      'Property references unknown field'
    )
  })

  it('builds deterministic signed package identities', () => {
    const input = {
      descriptor: descriptor(),
      signingSecret: 'component-signing-secret-at-least-32-characters',
      signingKeyId: 'siteforge-components-v1',
    }
    const first = buildSignedGovernedComponentPackage(input)
    const second = buildSignedGovernedComponentPackage(input)

    expect(first.package.packageSha256).toBe(second.package.packageSha256)
    expect(first.package.signature).toBe(second.package.signature)
    expect(first.package.signature).toMatch(/^[a-f0-9]{64}$/)
  })
})
