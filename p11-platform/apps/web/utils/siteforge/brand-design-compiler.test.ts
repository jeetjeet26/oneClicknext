import { describe, expect, it } from 'vitest'
import { normalizeBrandForgeContract } from '@/utils/brandforge/normalize'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import {
  assertBrandPublicationPackageUnchanged,
  assertDesignSystemBrandInheritance,
  compileBrandPublicationPackage,
  enforceBrandPublicationDesignSystem,
} from './brand-design-compiler'

const source = {
  positioning: {
    voice: ['warm', 'precise'],
    prohibitedVoice: ['cheap', 'generic'],
  },
  logos: {
    variants: [{
      role: 'primary',
      assetId: '11111111-1111-4111-8111-111111111111',
      url: 'https://cdn.example.com/aurora-logo.svg',
      alt: 'Aurora',
      restrictions: ['Do not recolor'],
    }],
    usageRules: ['Keep clear space'],
  },
  typography: {
    roles: [
      {
        role: 'headline',
        family: 'Cormorant Garamond',
        weights: [500],
        usage: 'Headlines',
        fallback: 'Georgia, serif',
      },
      {
        role: 'body',
        family: 'Montserrat',
        weights: [400],
        usage: 'Body copy',
        fallback: 'Arial, sans-serif',
      },
    ],
  },
  colors: {
    roles: [
      { role: 'primary', name: 'Gold', hex: '#c9a962', usage: 'Actions' },
      { role: 'secondary', name: 'Ivory', hex: '#f5f1e8', usage: 'Panels' },
      { role: 'accent', name: 'Sage', hex: '#7d8b74', usage: 'Accents' },
      { role: 'background', name: 'White', hex: '#ffffff', usage: 'Canvas' },
      { role: 'text', name: 'Ink', hex: '#202020', usage: 'Copy' },
    ],
    usageGuidelines: 'Use exact semantic roles.',
  },
  designElements: {
    elements: [{
      type: 'pattern',
      name: 'Aurora arc',
      description: 'Use behind section transitions.',
      assetId: '22222222-2222-4222-8222-222222222222',
    }],
    usageNotes: 'Never distort the arc.',
  },
  photographyYes: {
    description: 'Natural, resident-led photography.',
    criteria: ['Natural light', 'Authentic composition'],
    exampleAssetIds: ['33333333-3333-4333-8333-333333333333'],
  },
  photographyNo: {
    description: 'No artificial stock scenes.',
    criteria: ['No heavy filters'],
  },
  implementation: {
    lockedRules: ['Never substitute logo or semantic color roles.'],
  },
}

const candidate: DesignSystem = {
  colorSystem: {
    primary: '#000000',
    secondary: '#111111',
    accent: '#222222',
    background: '#333333',
    strategy: 'custom',
    reasoning: 'Candidate',
  },
  typography: {
    headingFont: 'Inter',
    headingWeight: 700,
    bodyFont: 'Inter',
    scale: 'balanced',
    strategy: 'custom',
    reasoning: 'Candidate',
  },
  spacing: {
    scale: 'balanced',
    containerMaxWidth: '1200px',
    sectionPadding: '6rem',
    reasoning: 'Candidate',
  },
  componentStyles: {
    hero: { layout: 'split', variant: 'split', treatment: 'split', reasoning: 'Candidate' },
    amenityShowcase: { layout: 'grid', variant: 'editorial', treatment: 'mixed', reasoning: 'Candidate' },
    ctaSections: { layout: 'inline', variant: 'inline', treatment: 'button', reasoning: 'Candidate' },
  },
  animations: { level: 'subtle', types: ['fadeIn'], reasoning: 'Candidate' },
}

describe('BrandForge → SiteForge design compiler', () => {
  it('compiles equivalent generated and imported contracts to one package', () => {
    const generated = normalizeBrandForgeContract(source, {
      origin: 'generated',
      approvalStatus: 'approved',
      confidence: 0.95,
    })
    const imported = normalizeBrandForgeContract(source, {
      origin: 'imported',
      approvalStatus: 'approved',
      confidence: 0.8,
    })

    const generatedPackage = compileBrandPublicationPackage(generated)
    const importedPackage = compileBrandPublicationPackage(imported)

    expect(generatedPackage).toEqual(importedPackage)
    expect(generatedPackage.contractHash).toMatch(/^[a-f0-9]{64}$/)
    expect(generatedPackage).toMatchObject({
      language: {
        voice: ['warm', 'precise'],
        prohibitedVocabulary: ['cheap', 'generic'],
      },
      photography: {
        approved: { criteria: ['Natural light', 'Authentic composition'] },
        prohibited: { criteria: ['No heavy filters'] },
      },
      implementationLockedRules: [
        'Never substitute logo or semantic color roles.',
      ],
    })
  })

  it('rejects changed locked tokens and assets', () => {
    const brand = compileBrandPublicationPackage(
      normalizeBrandForgeContract(source, {
        origin: 'generated',
        approvalStatus: 'approved',
      }),
    )
    const enforced = enforceBrandPublicationDesignSystem(candidate, brand)
    expect(() =>
      assertDesignSystemBrandInheritance({
        ...enforced,
        colorSystem: { ...enforced.colorSystem, primary: '#000000' },
      }, brand),
    ).toThrow('Locked brand color "primary" changed')

    const changedAsset = structuredClone(brand)
    changedAsset.logos[0].url = 'https://cdn.example.com/substitute.svg'
    expect(() =>
      assertBrandPublicationPackageUnchanged(brand, changedAsset),
    ).toThrow('Locked brand publication tokens or assets changed')
  })

  it('fails closed when a required semantic role is absent', () => {
    const contract = normalizeBrandForgeContract({
      ...source,
      colors: {
        ...source.colors,
        roles: source.colors.roles.filter(color => color.role !== 'background'),
      },
    }, {
      origin: 'imported',
      approvalStatus: 'approved',
    })

    expect(() => compileBrandPublicationPackage(contract)).toThrow(
      'requires a color role "background"',
    )
  })
})
