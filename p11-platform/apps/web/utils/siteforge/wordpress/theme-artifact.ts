import { z } from 'zod'
import {
  ACF_BLOCK_TYPES,
  siteConfigurationSchema,
  type SiteConfiguration,
} from '@/types/siteforge'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import { normalizeFontFamily } from '@/utils/siteforge/agents/brand-typography'
import type { WordPressCapabilities } from '@/utils/mcp/wordpress-client'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { DEFAULT_SITE_CONFIGURATION } from '@/utils/siteforge/blueprint'

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)
const cssDimensionSchema = z.string().regex(/^\d+(?:\.\d+)?(?:px|rem|em|vw|%)$/)

const themeJsonSchema = z
  .object({
    $schema: z.literal('https://schemas.wp.org/trunk/theme.json'),
    version: z.literal(3),
    settings: z
      .object({
        appearanceTools: z.literal(true),
        color: z.object({
          palette: z.array(
            z.object({
              slug: z.string().min(1),
              name: z.string().min(1),
              color: hexColorSchema,
            })
          ).min(4),
        }),
        typography: z.object({
          fontFamilies: z.array(
            z.object({
              slug: z.string().min(1),
              name: z.string().min(1),
              fontFamily: z.string().min(1),
            })
          ).min(2),
        }),
        spacing: z.object({
          spacingSizes: z.array(
            z.object({
              slug: z.string().min(1),
              name: z.string().min(1),
              size: cssDimensionSchema,
            })
          ).min(3),
        }),
        layout: z.object({
          contentSize: cssDimensionSchema,
          wideSize: cssDimensionSchema,
        }),
      })
      .strict(),
    styles: z
      .object({
        color: z.object({
          background: hexColorSchema,
          text: hexColorSchema,
        }),
        typography: z.object({
          fontFamily: z.string().min(1),
          lineHeight: z.string().min(1),
        }),
        elements: z.object({
          heading: z.object({
            typography: z.object({
              fontFamily: z.string().min(1),
              fontWeight: z.string().regex(/^[1-9]00$/),
            }),
          }),
          button: z.object({
            color: z.object({
              background: hexColorSchema,
              text: hexColorSchema,
            }),
          }),
        }),
      })
      .strict(),
  })
  .strict()

const wordpressThemeArtifactCoreSchema = z
  .object({
    schemaVersion: z.literal(2),
    theme: z
      .object({
        slug: z.literal('oneclick-siteforge'),
        version: z.string().min(1),
      })
      .strict(),
    acfSchemas: z.record(z.string(), z.unknown()),
    themeJson: themeJsonSchema,
    designTokens: z
      .object({
        colors: z.record(z.string(), hexColorSchema),
        typography: z.object({
          headingFont: z.string().min(1),
          headingWeight: z.number().int().min(100).max(900),
          bodyFont: z.string().min(1),
          scale: z.enum(['compact', 'balanced', 'luxury']),
        }),
        spacing: z.object({
          scale: z.enum(['tight', 'balanced', 'luxury']),
          containerMaxWidth: cssDimensionSchema,
          sectionPadding: cssDimensionSchema,
        }),
      })
      .strict(),
    fontAssets: z.array(z.object({
      role: z.enum(['headline', 'body', 'accent']),
      family: z.string().min(1),
      weights: z.array(z.number().int().min(100).max(900)).min(1),
      source: z.enum(['asset', 'fallback']),
      assetId: z.string().uuid().optional(),
      url: z.string().url().optional(),
      fallback: z.string().min(1),
      preload: z.boolean(),
    }).strict()).default([]),
    componentVariants: z.record(
      z.string(),
      z.object({
        selected: z.string().min(1),
        supported: z.array(z.string()),
      })
    ),
    siteConfiguration: siteConfigurationSchema,
    motion: siteConfigurationSchema.shape.motion,
    themeOverlay: z.object({
      manifestVersion: z.literal(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      files: z.array(z.object({
        path: z.string().min(1),
        mediaType: z.enum(['text/css', 'application/javascript', 'text/x-php']),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().nonnegative(),
      }).strict()).min(1),
    }).strict(),
  })
  .strict()

const legacyWordPressThemeArtifactSchema = wordpressThemeArtifactCoreSchema
  .omit({
    schemaVersion: true,
    siteConfiguration: true,
    motion: true,
    themeOverlay: true,
    fontAssets: true,
  })
  .extend({
    schemaVersion: z.literal(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const wordpressThemeArtifactSchema =
  wordpressThemeArtifactCoreSchema.extend({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })

export type WordPressThemeArtifact = z.infer<typeof wordpressThemeArtifactSchema>
export type WordPressFontAsset = WordPressThemeArtifact['fontAssets'][number]

const COMPONENT_VARIANTS = {
  hero: [
    'cinematic',
    'editorial',
    'split',
    'panoramic',
    'immersive',
    'minimal',
  ],
  amenityShowcase: [
    'amenity-grid',
    'tabs',
    'editorial',
    'bento',
    'icon-list',
    'carousel',
  ],
  ctaSections: ['inline', 'banner', 'sticky'],
} as const

function palette(designSystem: DesignSystem) {
  return [
    { slug: 'primary', name: 'Primary', color: designSystem.colorSystem.primary },
    { slug: 'secondary', name: 'Secondary', color: designSystem.colorSystem.secondary },
    { slug: 'accent', name: 'Accent', color: designSystem.colorSystem.accent },
    { slug: 'background', name: 'Background', color: designSystem.colorSystem.background },
  ]
}

export function buildWordPressThemeArtifact(
  designSystem: DesignSystem,
  capabilities: WordPressCapabilities,
  siteConfiguration?: SiteConfiguration,
  fontAssets: WordPressFontAsset[] = [],
  // Fresh generations must cover the full current catalog; semantic-edit
  // rebuilds pass the artifact's own catalog so blocks added to the platform
  // after an artifact was generated never invalidate that artifact (add-only
  // compatibility guarantee).
  requiredBlocks: readonly string[] = ACF_BLOCK_TYPES,
): WordPressThemeArtifact {
  const missingBlocks = requiredBlocks.filter(
    (block) =>
      !capabilities.availableBlocks.includes(block) ||
      !capabilities.blockSchemas[block]
  )
  if (missingBlocks.length) {
    throw new Error(
      `WordPress theme contract is missing required blocks: ${missingBlocks.join(', ')}`
    )
  }
  const selections = {
    hero: designSystem.componentStyles.hero.variant,
    amenityShowcase: designSystem.componentStyles.amenityShowcase.variant,
    ctaSections: designSystem.componentStyles.ctaSections.variant,
  }
  for (const [component, selected] of Object.entries(selections)) {
    const supported =
      COMPONENT_VARIANTS[component as keyof typeof COMPONENT_VARIANTS]
    if (!(supported as readonly string[]).includes(selected)) {
      throw new Error(
        `Unsupported ${component} component variant "${selected}"; expected one of ${supported.join(', ')}`
      )
    }
  }
  const headingFont = normalizeFontFamily(
    designSystem.typography.headingFont,
    'Inter, sans-serif'
  )
  const bodyFont = normalizeFontFamily(
    designSystem.typography.bodyFont,
    'Inter, sans-serif'
  )
  const configuration = siteConfigurationSchema.parse(
    siteConfiguration || configurationFromDesignSystem(designSystem, headingFont, bodyFont)
  )
  const fontFaceCss = fontAssets.flatMap(font =>
    font.source === 'asset' && font.url
      ? font.weights.map(weight => `@font-face{font-family:"${font.family.replace(/"/g, '')}";src:url("${font.url}") format("woff2");font-style:normal;font-weight:${weight};font-display:swap;}`)
      : [],
  ).join('\n')
  const overlaySources = {
    'assets/css/siteforge-overlay.css': `${fontFaceCss}\n${buildOverlayCss(configuration)}`,
    'assets/js/siteforge-runtime.js': buildOverlayRuntime(configuration),
  }
  const overlayFiles = Object.entries(overlaySources).map(([path, content]) => ({
    path,
    mediaType: path.endsWith('.css') ? 'text/css' as const : 'application/javascript' as const,
    contentHash: hashSiteForgeContent(content),
    bytes: Buffer.byteLength(content, 'utf8'),
  }))
  const themeOverlay = {
    manifestVersion: 1 as const,
    contentHash: hashSiteForgeContent(overlayFiles),
    files: overlayFiles,
  }

  const core = wordpressThemeArtifactCoreSchema.parse({
    schemaVersion: 2,
    theme: {
      slug: 'oneclick-siteforge',
      version: capabilities.theme.version,
    },
    acfSchemas: Object.fromEntries(
      [...requiredBlocks]
        .sort()
        .map((block) => [block, capabilities.blockSchemas[block]])
    ),
    themeJson: {
      $schema: 'https://schemas.wp.org/trunk/theme.json',
      version: 3,
      settings: {
        appearanceTools: true,
        color: { palette: palette(designSystem) },
        typography: {
          fontFamilies: [
            {
              slug: 'heading',
              name: 'Heading',
              fontFamily: headingFont,
            },
            {
              slug: 'body',
              name: 'Body',
              fontFamily: bodyFont,
            },
          ],
        },
        spacing: {
          spacingSizes: [
            { slug: 'small', name: 'Small', size: '1rem' },
            { slug: 'medium', name: 'Medium', size: '2rem' },
            {
              slug: 'section',
              name: 'Section',
              size: designSystem.spacing.sectionPadding,
            },
          ],
        },
        layout: {
          contentSize: designSystem.spacing.containerMaxWidth,
          wideSize: designSystem.spacing.containerMaxWidth,
        },
      },
      styles: {
        color: {
          background: designSystem.colorSystem.background,
          text: designSystem.colorSystem.primary,
        },
        typography: {
          fontFamily: bodyFont,
          lineHeight: '1.6',
        },
        elements: {
          heading: {
            typography: {
              fontFamily: headingFont,
              fontWeight: String(designSystem.typography.headingWeight),
            },
          },
          button: {
            color: {
              background: designSystem.colorSystem.primary,
              text: designSystem.colorSystem.background,
            },
          },
        },
      },
    },
    designTokens: {
      colors: {
        primary: designSystem.colorSystem.primary,
        secondary: designSystem.colorSystem.secondary,
        accent: designSystem.colorSystem.accent,
        background: designSystem.colorSystem.background,
      },
      typography: {
        headingFont,
        headingWeight: designSystem.typography.headingWeight,
        bodyFont,
        scale: designSystem.typography.scale,
      },
      spacing: {
        scale: designSystem.spacing.scale,
        containerMaxWidth: designSystem.spacing.containerMaxWidth,
        sectionPadding: designSystem.spacing.sectionPadding,
      },
    },
    fontAssets,
    componentVariants: {
      hero: {
        selected: selections.hero,
        supported: [...COMPONENT_VARIANTS.hero],
      },
      amenityShowcase: {
        selected: selections.amenityShowcase,
        supported: [...COMPONENT_VARIANTS.amenityShowcase],
      },
      ctaSections: {
        selected: selections.ctaSections,
        supported: [...COMPONENT_VARIANTS.ctaSections],
      },
    },
    siteConfiguration: configuration,
    motion: configuration.motion,
    themeOverlay,
  })

  return wordpressThemeArtifactSchema.parse({
    ...core,
    contentHash: hashSiteForgeContent(core),
  })
}

export function rebuildWordPressThemeArtifactFromDesignSystem(
  artifact: unknown,
  designSystem: DesignSystem,
  siteConfiguration?: SiteConfiguration
): WordPressThemeArtifact {
  const existing = validateWordPressThemeArtifact(artifact)
  const capabilities: WordPressCapabilities = {
    availableBlocks: Object.keys(existing.acfSchemas),
    blockSchemas:
      existing.acfSchemas as WordPressCapabilities['blockSchemas'],
    designTokens: {
      colors: {
        primary: existing.designTokens.colors.primary,
        secondary: existing.designTokens.colors.secondary,
        availableVariants: [],
      },
      typography: {
        availableFonts: [
          existing.designTokens.typography.headingFont,
          existing.designTokens.typography.bodyFont,
        ],
        headingScales: [],
      },
      spacing: {
        availableScales: [existing.designTokens.spacing.scale],
        presets: {},
      },
    },
    theme: {
      name: existing.theme.slug,
      version: existing.theme.version,
      supports: {},
    },
    plugins: [],
    capabilities: {
      canCreatePages: true,
      canUploadMedia: true,
      canModifyTheme: true,
      canInstallPlugins: false,
      maxUploadSizeMb: 0,
    },
  }

  return buildWordPressThemeArtifact(
    designSystem,
    capabilities,
    siteConfiguration,
    existing.fontAssets,
    Object.keys(existing.acfSchemas),
  )
}

export function validateWordPressThemeArtifact(
  artifact: unknown
): WordPressThemeArtifact {
  const raw = z.record(z.string(), z.unknown()).parse(artifact)
  const { contentHash: rawContentHash, ...rawCore } = raw
  const parsed = wordpressThemeArtifactSchema.parse(artifact)
  if (
    rawContentHash !== parsed.contentHash ||
    hashSiteForgeContent(rawCore) !== parsed.contentHash
  ) {
    throw new Error('WordPress theme artifact content hash does not match its contents')
  }
  if (hashSiteForgeContent(parsed.themeOverlay.files) !== parsed.themeOverlay.contentHash) {
    throw new Error('WordPress theme overlay manifest hash does not match its files')
  }
  return parsed
}

export function replaceWordPressThemeArtifactOverlay(
  artifact: unknown,
  themeOverlay: WordPressThemeArtifact['themeOverlay']
): WordPressThemeArtifact {
  const current = wordpressThemeArtifactSchema.parse(artifact)
  const { contentHash, ...currentCore } = current
  if (hashSiteForgeContent(currentCore) !== contentHash) {
    throw new Error('WordPress theme artifact content hash does not match its contents')
  }
  const nextOverlay = wordpressThemeArtifactCoreSchema.shape.themeOverlay.parse(
    themeOverlay
  )
  if (hashSiteForgeContent(nextOverlay.files) !== nextOverlay.contentHash) {
    throw new Error('WordPress theme overlay manifest hash does not match its files')
  }
  const nextCore = wordpressThemeArtifactCoreSchema.parse({
    ...currentCore,
    themeOverlay: nextOverlay,
  })
  return wordpressThemeArtifactSchema.parse({
    ...nextCore,
    contentHash: hashSiteForgeContent(nextCore),
  })
}

export function normalizeWordPressThemeArtifact(
  artifact: unknown,
  siteConfiguration?: SiteConfiguration
): WordPressThemeArtifact {
  if (wordpressThemeArtifactSchema.safeParse(artifact).success) {
    return validateWordPressThemeArtifact(artifact)
  }

  const legacy = legacyWordPressThemeArtifactSchema.parse(artifact)
  const { contentHash, ...legacyCore } = legacy
  if (hashSiteForgeContent(legacyCore) !== contentHash) {
    throw new Error('Legacy WordPress theme artifact content hash does not match its contents')
  }
  const configuration = siteConfigurationSchema.parse(
    siteConfiguration || {
      ...DEFAULT_SITE_CONFIGURATION,
      design: {
        colors: {
          ...DEFAULT_SITE_CONFIGURATION.design.colors,
          ...legacy.designTokens.colors,
          text: legacy.themeJson.styles.color.text,
        },
        typography: {
          headingFont: legacy.designTokens.typography.headingFont,
          headingWeight: legacy.designTokens.typography.headingWeight,
          bodyFont: legacy.designTokens.typography.bodyFont,
        },
        spacing: {
          containerMaxWidth: legacy.designTokens.spacing.containerMaxWidth,
          sectionPadding: legacy.designTokens.spacing.sectionPadding,
        },
      },
    }
  )
  const overlaySources = {
    'assets/css/siteforge-overlay.css': buildOverlayCss(configuration),
    'assets/js/siteforge-runtime.js': buildOverlayRuntime(configuration),
  }
  const overlayFiles = Object.entries(overlaySources).map(([path, content]) => ({
    path,
    mediaType: path.endsWith('.css')
      ? ('text/css' as const)
      : ('application/javascript' as const),
    contentHash: hashSiteForgeContent(content),
    bytes: Buffer.byteLength(content, 'utf8'),
  }))
  const core = wordpressThemeArtifactCoreSchema.parse({
    ...legacyCore,
    schemaVersion: 2,
    siteConfiguration: configuration,
    motion: configuration.motion,
    themeOverlay: {
      manifestVersion: 1,
      contentHash: hashSiteForgeContent(overlayFiles),
      files: overlayFiles,
    },
  })
  return wordpressThemeArtifactSchema.parse({
    ...core,
    contentHash: hashSiteForgeContent(core),
  })
}

export function updateWordPressThemeArtifactConfiguration(
  artifact: unknown,
  siteConfiguration: SiteConfiguration,
  themeOverlay?: WordPressThemeArtifact['themeOverlay']
): WordPressThemeArtifact {
  const current = normalizeWordPressThemeArtifact(artifact, siteConfiguration)
  const configuration = siteConfigurationSchema.parse(siteConfiguration)
  const colors = configuration.design.colors
  const paletteBySlug: Record<string, string> = {
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    background: colors.background,
  }
  const { contentHash, ...currentCore } = current
  void contentHash
  const core = wordpressThemeArtifactCoreSchema.parse({
    ...currentCore,
    themeJson: {
      ...current.themeJson,
      settings: {
        ...current.themeJson.settings,
        color: {
          palette: current.themeJson.settings.color.palette.map(entry => ({
            ...entry,
            color: paletteBySlug[entry.slug] || entry.color,
          })),
        },
        typography: {
          fontFamilies: current.themeJson.settings.typography.fontFamilies.map(
            entry => ({
              ...entry,
              fontFamily:
                entry.slug === 'heading'
                  ? configuration.design.typography.headingFont
                  : entry.slug === 'body'
                    ? configuration.design.typography.bodyFont
                    : entry.fontFamily,
            })
          ),
        },
        spacing: current.themeJson.settings.spacing,
        layout: {
          contentSize: configuration.design.spacing.containerMaxWidth,
          wideSize: configuration.design.spacing.containerMaxWidth,
        },
        appearanceTools: true,
      },
      styles: {
        ...current.themeJson.styles,
        color: {
          background: colors.background,
          text: colors.text,
        },
        typography: {
          ...current.themeJson.styles.typography,
          fontFamily: configuration.design.typography.bodyFont,
        },
        elements: {
          ...current.themeJson.styles.elements,
          heading: {
            typography: {
              fontFamily: configuration.design.typography.headingFont,
              fontWeight: String(configuration.design.typography.headingWeight),
            },
          },
          button: {
            color: {
              background: colors.primary,
              text: colors.background,
            },
          },
        },
      },
    },
    designTokens: {
      colors,
      typography: {
        ...current.designTokens.typography,
        headingFont: configuration.design.typography.headingFont,
        headingWeight: configuration.design.typography.headingWeight,
        bodyFont: configuration.design.typography.bodyFont,
      },
      spacing: {
        ...current.designTokens.spacing,
        containerMaxWidth: configuration.design.spacing.containerMaxWidth,
        sectionPadding: configuration.design.spacing.sectionPadding,
      },
    },
    siteConfiguration: configuration,
    motion: configuration.motion,
    themeOverlay: themeOverlay || current.themeOverlay,
  })
  return wordpressThemeArtifactSchema.parse({
    ...core,
    contentHash: hashSiteForgeContent(core),
  })
}

function configurationFromDesignSystem(
  designSystem: DesignSystem,
  headingFont: string,
  bodyFont: string
): SiteConfiguration {
  return siteConfigurationSchema.parse({
    ...DEFAULT_SITE_CONFIGURATION,
    design: {
      colors: {
        primary: designSystem.colorSystem.primary,
        secondary: designSystem.colorSystem.secondary,
        accent: designSystem.colorSystem.accent,
        background: designSystem.colorSystem.background,
        text: designSystem.colorSystem.primary,
      },
      typography: {
        headingFont,
        bodyFont,
        headingWeight: designSystem.typography.headingWeight,
      },
      spacing: {
        containerMaxWidth: designSystem.spacing.containerMaxWidth,
        sectionPadding: designSystem.spacing.sectionPadding,
      },
    },
    motion: {
      ...DEFAULT_SITE_CONFIGURATION.motion,
      level: designSystem.animations.level,
      reveal: designSystem.animations.level === 'none' ? 'none' : 'fade',
    },
  })
}

function buildOverlayCss(configuration: SiteConfiguration): string {
  const { design, motion, header, footer, media } = configuration
  return [
    ':root{',
    `--color-primary:${design.colors.primary};`,
    `--color-secondary:${design.colors.secondary};`,
    `--color-accent:${design.colors.accent};`,
    `--color-background:${design.colors.background};`,
    `--color-text:${design.colors.text};`,
    `--font-heading:${design.typography.headingFont};`,
    `--font-body:${design.typography.bodyFont};`,
    `--container-max-width:${design.spacing.containerMaxWidth};`,
    `--section-padding:${design.spacing.sectionPadding};`,
    `--siteforge-motion-duration:${motion.durationMs}ms;`,
    `--siteforge-motion-easing:${motion.easing};`,
    '}',
    `body{scroll-behavior:${configuration.behavior.smoothScroll ? 'smooth' : 'auto'};}`,
    `.site-header{position:${header.position === 'overlay' ? 'absolute' : header.position};}`,
    `.site-footer[data-layout="${footer.layout}"]{--siteforge-footer-layout:${footer.layout};}`,
    `.site-content img{border-radius:${media.imageTreatment === 'rounded' ? '1rem' : '0'};}`,
  ].join('')
}

function buildOverlayRuntime(configuration: SiteConfiguration): string {
  return `window.oneClickSiteConfiguration=${JSON.stringify({
    motion: configuration.motion,
    behavior: configuration.behavior,
  })};`
}
