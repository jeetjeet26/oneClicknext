import { z } from 'zod'
import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import type { DesignSystem } from '@/utils/siteforge/agents/design-agent'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

export const brandPublicationPackageSchema = z.object({
  schemaVersion: z.literal(1),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  logos: z.array(z.object({
    role: z.enum(['primary', 'secondary', 'monochrome', 'mark', 'favicon']),
    assetId: z.string().uuid().optional(),
    url: z.string().url().optional(),
    alt: z.string(),
    restrictions: z.array(z.string()),
  }).strict()),
  typography: z.array(z.object({
    role: z.enum(['headline', 'body', 'accent']),
    family: z.string().min(1),
    weights: z.array(z.number().int().min(100).max(900)).min(1),
    usage: z.string(),
    assetId: z.string().uuid().optional(),
    fallback: z.string().optional(),
  }).strict()),
  colors: z.array(z.object({
    role: z.enum([
      'primary',
      'secondary',
      'accent',
      'background',
      'surface',
      'text',
      'muted',
    ]),
    name: z.string(),
    hex: hexColorSchema,
    usage: z.string(),
  }).strict()),
  language: z.object({
    voice: z.array(z.string()),
    prohibitedVocabulary: z.array(z.string()),
  }).strict(),
  photography: z.object({
    approved: z.object({
      description: z.string(),
      criteria: z.array(z.string()),
      exampleAssetIds: z.array(z.string().uuid()),
    }).strict(),
    prohibited: z.object({
      description: z.string(),
      criteria: z.array(z.string()),
    }).strict(),
  }).strict(),
  designElements: z.object({
    elements: z.array(z.object({
      type: z.string(),
      name: z.string(),
      description: z.string(),
      assetId: z.string().uuid().optional(),
    }).passthrough()),
    usageNotes: z.string(),
  }).strict(),
  implementationLockedRules: z.array(z.string()),
}).strict()

export type BrandPublicationPackage = z.infer<
  typeof brandPublicationPackageSchema
>

export type BrandInheritanceValidation = {
  passed: boolean
  violations: string[]
}

const REQUIRED_COLOR_ROLES = [
  'primary',
  'secondary',
  'accent',
  'background',
] as const

const REQUIRED_FONT_ROLES = ['headline', 'body'] as const

function requiredRole<T extends { role: string }>(
  values: readonly T[],
  role: string,
  kind: string,
): T {
  const matches = values.filter(value => value.role === role)
  if (matches.length === 0) {
    throw new Error(
      `Brand publication requires a ${kind} role "${role}"`,
    )
  }
  return matches[0]
}

function publicationPayload(contract: BrandForgeContractV1) {
  const colors = contract.colors.roles.map(color => ({
    role: color.role,
    name: color.name,
    hex: color.hex,
    usage: color.usage,
  }))
  if (!colors.some(color => color.role === 'accent')) {
    const inheritedAccent =
      colors.find(color => color.role === 'secondary') ||
      colors.find(color => color.role === 'primary')
    if (inheritedAccent) {
      colors.push({
        ...inheritedAccent,
        role: 'accent',
        name: `${inheritedAccent.name} Accent`,
        usage: `${inheritedAccent.usage} Inherited as the accent role for legacy BrandForge compatibility.`,
      })
    }
  }
  for (const inferred of [
    { role: 'background' as const, pattern: /\bbackgrounds?\b/i },
    { role: 'text' as const, pattern: /\btext\b|\bcontrast\b/i },
  ]) {
    if (colors.some(color => color.role === inferred.role)) continue
    const source = colors.find(color => inferred.pattern.test(color.usage))
    if (source) {
      colors.push({
        ...source,
        role: inferred.role,
        name: `${source.name} ${
          inferred.role === 'background' ? 'Background' : 'Text'
        }`,
        usage: `${source.usage} Inherited as the ${inferred.role} role from explicit legacy BrandForge usage guidance.`,
      })
    }
  }
  return {
    logos: contract.logos.variants.map(logo => ({
      role: logo.role,
      assetId: logo.assetId,
      url: logo.url,
      alt: logo.alt,
      restrictions: [...logo.restrictions],
    })),
    typography: contract.typography.roles.map(font => ({
      role: font.role,
      family: font.family,
      weights: [...font.weights],
      usage: font.usage,
      assetId: font.assetId,
      fallback: font.fallback,
    })),
    colors,
    language: {
      voice: [...contract.positioning.voice],
      prohibitedVocabulary: [...contract.positioning.prohibitedVoice],
    },
    photography: {
      approved: {
        description: contract.photographyYes.description,
        criteria: [...contract.photographyYes.criteria],
        exampleAssetIds: [...contract.photographyYes.exampleAssetIds],
      },
      prohibited: {
        description: contract.photographyNo.description,
        criteria: [...contract.photographyNo.criteria],
      },
    },
    designElements: {
      elements: contract.designElements.elements.map(element => ({
        ...element,
      })),
      usageNotes: contract.designElements.usageNotes,
    },
    implementationLockedRules: [...contract.implementation.lockedRules],
  }
}

/**
 * Compiles generated and imported BrandForge contracts through the same
 * source-neutral path. Provenance metadata is deliberately excluded from the
 * publication identity; only inherited, publication-affecting rules are hashed.
 */
export function compileBrandPublicationPackage(
  contract: BrandForgeContractV1,
): BrandPublicationPackage {
  const payload = publicationPayload(contract)
  for (const role of REQUIRED_COLOR_ROLES) {
    requiredRole(payload.colors, role, 'color')
  }
  for (const role of REQUIRED_FONT_ROLES) {
    const font = requiredRole(payload.typography, role, 'typography')
    if (!font.weights.length) {
      throw new Error(`Brand typography role "${role}" has no approved weights`)
    }
  }
  if (!payload.logos.length) {
    throw new Error('Brand publication requires at least one locked logo variant')
  }

  return brandPublicationPackageSchema.parse({
    schemaVersion: 1,
    contractHash: hashSiteForgeContent(payload),
    ...payload,
  })
}

function expectedDesignTokens(brand: BrandPublicationPackage) {
  return {
    colors: Object.fromEntries(
      REQUIRED_COLOR_ROLES.map(role => [
        role,
        requiredRole(brand.colors, role, 'color').hex,
      ]),
    ) as Record<(typeof REQUIRED_COLOR_ROLES)[number], string>,
    headline: requiredRole(brand.typography, 'headline', 'typography'),
    body: requiredRole(brand.typography, 'body', 'typography'),
  }
}

export function enforceBrandPublicationDesignSystem(
  designSystem: DesignSystem,
  brand: BrandPublicationPackage,
): DesignSystem {
  const expected = expectedDesignTokens(brand)
  return {
    ...designSystem,
    colorSystem: {
      ...designSystem.colorSystem,
      ...expected.colors,
      strategy: 'brandforge',
      reasoning: `${designSystem.colorSystem.reasoning} Locked BrandForge publication ${brand.contractHash} enforced without token substitution.`,
    },
    typography: {
      ...designSystem.typography,
      headingFont: expected.headline.family,
      headingWeight: expected.headline.weights[0],
      bodyFont: expected.body.family,
      strategy: 'brandforge',
      reasoning: `${designSystem.typography.reasoning} Locked BrandForge publication ${brand.contractHash} enforced without font substitution.`,
    },
  }
}

export function validateDesignSystemBrandInheritance(
  designSystem: DesignSystem,
  brand: BrandPublicationPackage,
): BrandInheritanceValidation {
  const expected = expectedDesignTokens(
    brandPublicationPackageSchema.parse(brand),
  )
  const actualColors = designSystem.colorSystem
  const violations = REQUIRED_COLOR_ROLES.flatMap(role =>
    actualColors[role].toLowerCase() === expected.colors[role].toLowerCase()
      ? []
      : [`Locked brand color "${role}" changed`],
  )
  if (designSystem.typography.headingFont !== expected.headline.family) {
    violations.push('Locked brand headline font changed')
  }
  if (designSystem.typography.headingWeight !== expected.headline.weights[0]) {
    violations.push('Locked brand headline weight changed')
  }
  if (designSystem.typography.bodyFont !== expected.body.family) {
    violations.push('Locked brand body font changed')
  }
  return { passed: violations.length === 0, violations }
}

export function assertDesignSystemBrandInheritance(
  designSystem: DesignSystem,
  brand: BrandPublicationPackage,
): void {
  const result = validateDesignSystemBrandInheritance(designSystem, brand)
  if (!result.passed) {
    throw new Error(
      `Brand inheritance validation failed: ${result.violations.join('; ')}`,
    )
  }
}

export function assertBrandPublicationPackageUnchanged(
  approved: unknown,
  candidate: unknown,
): void {
  if (!approved) return
  const parsedApproved = brandPublicationPackageSchema.parse(approved)
  const parsedCandidate = brandPublicationPackageSchema.safeParse(candidate)
  if (
    !parsedCandidate.success
    || hashSiteForgeContent(parsedCandidate.data) !== hashSiteForgeContent(parsedApproved)
  ) {
    throw new Error(
      'Locked brand publication tokens or assets changed; approve a new BrandForge revision first',
    )
  }
}

export function validateRenderedBrandInheritance(
  renderSurface: string,
  brand: BrandPublicationPackage,
): BrandInheritanceValidation {
  const normalized = renderSurface.toLowerCase()
  const requiredColors = REQUIRED_COLOR_ROLES.map(role =>
    requiredRole(brand.colors, role, 'color'),
  )
  const violations = requiredColors.flatMap(color =>
    normalized.includes(color.hex.toLowerCase())
      ? []
      : [`Rendered output is missing brand color "${color.role}"`],
  )
  for (const font of brand.typography) {
    if (!normalized.includes(font.family.toLowerCase())) {
      violations.push(`Rendered output is missing brand font "${font.role}"`)
    }
  }
  const lockedAssetUrls = brand.logos.flatMap(logo =>
    (logo.role === 'primary' || logo.role === 'favicon') && logo.url
      ? [logo.url]
      : [],
  )
  for (const url of lockedAssetUrls) {
    if (!renderSurface.includes(url)) {
      violations.push(`Rendered output is missing locked brand asset "${url}"`)
    }
  }
  return { passed: violations.length === 0, violations }
}
