import { describe, expect, it } from 'vitest'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import { getBuiltinThemeCapabilities } from '@/utils/siteforge/wordpress-discovery'
import {
  buildWordPressThemeArtifact,
  normalizeWordPressThemeArtifact,
  rebuildWordPressThemeArtifactFromDesignSystem,
  replaceWordPressThemeArtifactOverlay,
  validateWordPressThemeArtifact,
} from './theme-artifact'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const designSystem: DesignSystem = {
  colorSystem: {
    primary: '#1a1a1a',
    secondary: '#c9a96e',
    accent: '#8a6d3b',
    background: '#ffffff',
    strategy: 'hybrid',
    reasoning: 'Fixture',
  },
  typography: {
    headingFont: 'Cormorant Garamond, serif',
    headingWeight: 600,
    bodyFont: 'Inter, sans-serif',
    scale: 'luxury',
    strategy: 'use-theme',
    reasoning: 'Fixture',
  },
  spacing: {
    scale: 'luxury',
    containerMaxWidth: '1400px',
    sectionPadding: '8rem',
    reasoning: 'Fixture',
  },
  componentStyles: {
    hero: {
      layout: 'fullwidth',
      variant: 'cinematic',
      treatment: 'overlay',
      reasoning: 'Fixture',
    },
    amenityShowcase: {
      layout: 'grid',
      variant: 'amenity-grid',
      treatment: 'photo-heavy',
      reasoning: 'Fixture',
    },
    ctaSections: {
      layout: 'sticky',
      variant: 'sticky',
      treatment: 'banner',
      reasoning: 'Fixture',
    },
  },
  animations: { level: 'subtle', types: ['fadeIn'], reasoning: 'Fixture' },
}

describe('WordPress theme artifact', () => {
  it('builds a deterministic, checksummed theme contract', () => {
    const first = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    const second = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe(2)
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.themeOverlay.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.themeOverlay.files).toHaveLength(2)
    expect(first.siteConfiguration.motion).toEqual(first.motion)
    expect(Object.keys(first.acfSchemas)).toHaveLength(14)
    expect(validateWordPressThemeArtifact(first)).toEqual(first)
  })

  it('validates the stored payload before applying schema defaults', () => {
    const artifact = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    const { contentHash: _contentHash, fontAssets: _fontAssets, ...storedCore } =
      artifact
    const storedArtifact = {
      ...storedCore,
      contentHash: hashSiteForgeContent(storedCore),
    }

    expect(validateWordPressThemeArtifact(storedArtifact)).toMatchObject({
      ...storedArtifact,
      fontAssets: [],
    })
  })

  it('rebuilds stale theme tokens from the stored brand design system', () => {
    const stale = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    const brandedDesignSystem: DesignSystem = {
      ...designSystem,
      colorSystem: {
        ...designSystem.colorSystem,
        primary: '#c9a962',
        secondary: '#f5f1e8',
        accent: '#7d8b74',
        background: '#f5f1e8',
      },
      typography: {
        ...designSystem.typography,
        headingFont: 'Cormorant Garamond',
        headingWeight: 500,
        bodyFont: 'Montserrat',
      },
      spacing: {
        ...designSystem.spacing,
        containerMaxWidth: '1600px',
        sectionPadding: '8rem',
      },
    }

    const rebuilt = rebuildWordPressThemeArtifactFromDesignSystem(
      stale,
      brandedDesignSystem
    )

    expect(rebuilt.designTokens).toMatchObject({
      colors: {
        primary: '#c9a962',
        secondary: '#f5f1e8',
        accent: '#7d8b74',
        background: '#f5f1e8',
      },
      typography: {
        headingFont: 'Cormorant Garamond',
        headingWeight: 500,
        bodyFont: 'Montserrat',
      },
      spacing: {
        containerMaxWidth: '1600px',
        sectionPadding: '8rem',
      },
    })
    expect(validateWordPressThemeArtifact(rebuilt)).toEqual(rebuilt)
  })

  it('rejects unsupported model-invented component variants', () => {
    expect(() =>
      buildWordPressThemeArtifact(
        {
          ...designSystem,
          componentStyles: {
            ...designSystem.componentStyles,
            hero: {
              ...designSystem.componentStyles.hero,
              variant: 'model-invented-layout',
            },
          },
        },
        getBuiltinThemeCapabilities()
      )
    ).toThrow(/Unsupported hero component variant/)
  })

  it('normalizes object-shaped font records at the artifact boundary', () => {
    const artifact = buildWordPressThemeArtifact(
      {
        ...designSystem,
        typography: {
          ...designSystem.typography,
          headingFont: {
            name: 'Cormorant Garamond',
          } as unknown as string,
          bodyFont: {
            fontFamily: 'Montserrat',
          } as unknown as string,
        },
      },
      getBuiltinThemeCapabilities()
    )

    expect(artifact.designTokens.typography.headingFont).toBe(
      'Cormorant Garamond'
    )
    expect(artifact.designTokens.typography.bodyFont).toBe('Montserrat')
  })

  it('upgrades a checksummed v1 artifact before applying semantic edits', () => {
    const current = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    const legacyCore = {
      schemaVersion: 1 as const,
      theme: current.theme,
      acfSchemas: current.acfSchemas,
      themeJson: current.themeJson,
      designTokens: current.designTokens,
      componentVariants: current.componentVariants,
    }
    const upgraded = normalizeWordPressThemeArtifact(
      {
        ...legacyCore,
        contentHash: hashSiteForgeContent(legacyCore),
      },
      current.siteConfiguration
    )

    expect(upgraded.schemaVersion).toBe(2)
    expect(upgraded.siteConfiguration).toEqual(current.siteConfiguration)
    expect(upgraded.themeOverlay.files).toHaveLength(2)
    expect(validateWordPressThemeArtifact(upgraded)).toEqual(upgraded)
  })

  it('rejects a modified artifact whose checksum was not republished', () => {
    const artifact = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    expect(() =>
      validateWordPressThemeArtifact({
        ...artifact,
        theme: { ...artifact.theme, version: 'tampered' },
      })
    ).toThrow(/content hash/)
  })

  it('rejects malformed v2 site configuration and overlay manifests', () => {
    const artifact = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    expect(() =>
      validateWordPressThemeArtifact({
        ...artifact,
        motion: { ...artifact.motion, durationMs: -1 },
      })
    ).toThrow()
    expect(() =>
      validateWordPressThemeArtifact({
        ...artifact,
        themeOverlay: {
          ...artifact.themeOverlay,
          contentHash: 'not-content-addressed',
        },
      })
    ).toThrow()
  })

  it('repairs an invalid nested overlay manifest without weakening outer integrity', () => {
    const artifact = buildWordPressThemeArtifact(
      designSystem,
      getBuiltinThemeCapabilities()
    )
    const { contentHash: _contentHash, ...core } = artifact
    const brokenCore = {
      ...core,
      themeOverlay: {
        ...artifact.themeOverlay,
        contentHash: 'a'.repeat(64),
      },
    }
    const brokenArtifact = {
      ...brokenCore,
      contentHash: hashSiteForgeContent(brokenCore),
    }
    const repairedFiles = artifact.themeOverlay.files.map(file => ({
      ...file,
      path: `repaired/${file.path}`,
    }))
    const repaired = replaceWordPressThemeArtifactOverlay(brokenArtifact, {
      manifestVersion: 1,
      contentHash: hashSiteForgeContent(repairedFiles),
      files: repairedFiles,
    })

    expect(validateWordPressThemeArtifact(repaired)).toEqual(repaired)
  })
})
