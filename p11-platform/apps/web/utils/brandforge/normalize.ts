import { createHash } from 'node:crypto'
import {
  BRAND_FORGE_CONTRACT_VERSION,
  brandForgeContractV1Schema,
  type BrandForgeContractV1,
  type BrandSectionMeta,
} from './contracts'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(string).filter(Boolean)
  const scalar = string(value)
  return scalar ? [scalar] : []
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function validUrl(value: unknown): string | undefined {
  const candidate = string(value)
  try {
    return candidate ? new URL(candidate).toString() : undefined
  } catch {
    return undefined
  }
}

function validUuid(value: unknown): string | undefined {
  const candidate = string(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined
}

function hex(value: unknown): string {
  const candidate = string(value)
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate.toUpperCase()}`
  return '#000000'
}

function isoDatetime(value: unknown): string | undefined {
  const candidate = string(value)
  if (!candidate) return undefined
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function sectionMeta(
  section: JsonRecord,
  options: NormalizeBrandOptions,
): BrandSectionMeta {
  const existing = record(section._meta)
  const approval = record(existing.approval)
  const provenance = record(existing.provenance)
  const confidence = number(existing.confidence) ?? options.confidence ?? 1
  const status = string(approval.status || section.status || options.approvalStatus)

  return {
    schemaVersion: BRAND_FORGE_CONTRACT_VERSION,
    origin: options.origin,
    confidence: Math.max(0, Math.min(1, confidence)),
    provenance: Object.fromEntries(
      Object.entries(provenance).map(([field, entries]) => [
        field,
        array(entries).map(record).flatMap(entry => {
          const sourceType = string(entry.sourceType)
          if (!sourceType) return []
          return [{
            sourceType,
            ...(string(entry.sourceId) ? { sourceId: string(entry.sourceId) } : {}),
            ...(validUrl(entry.sourceUrl) ? { sourceUrl: validUrl(entry.sourceUrl) } : {}),
            ...(isoDatetime(entry.capturedAt)
              ? { capturedAt: isoDatetime(entry.capturedAt) }
              : {}),
            ...(string(entry.excerpt) ? { excerpt: string(entry.excerpt) } : {}),
          }]
        }),
      ]),
    ),
    approval: {
      status: status === 'approved' || status === 'reviewing' || status === 'rejected'
        ? status
        : 'draft',
      ...(validUuid(approval.approvedBy || section.approved_by || options.approvedBy)
        ? { approvedBy: validUuid(approval.approvedBy || section.approved_by || options.approvedBy) }
        : {}),
      ...(isoDatetime(approval.approvedAt || section.approved_at || options.approvedAt)
        ? { approvedAt: isoDatetime(approval.approvedAt || section.approved_at || options.approvedAt) }
        : {}),
    },
  }
}

export type NormalizeBrandOptions = {
  origin: 'generated' | 'imported' | 'hybrid'
  approvalStatus?: 'draft' | 'reviewing' | 'approved' | 'rejected'
  approvedBy?: string
  approvedAt?: string
  confidence?: number
}

export function normalizeBrandForgeContract(
  source: JsonRecord,
  options: NormalizeBrandOptions,
): BrandForgeContractV1 {
  const introduction = record(source.introduction ?? source.section_1_introduction)
  const positioning = record(source.positioning ?? source.section_2_positioning)
  const audience = record(source.audience ?? source.targetAudience ?? source.section_3_target_audience)
  const personas = record(source.personas ?? source.section_4_personas)
  const identity = record(source.identity ?? source.nameStory ?? source.section_5_name_story)
  const logos = record(source.logos ?? source.logo ?? source.section_6_logo)
  const typography = record(source.typography ?? source.section_7_typography)
  const colors = record(source.colors ?? source.section_8_colors)
  const designElements = record(source.designElements ?? source.section_9_design_elements)
  const photographyYes = record(source.photographyYes ?? source.photoYep ?? source.section_10_photo_yep)
  const photographyNo = record(source.photographyNo ?? source.photoNope ?? source.section_11_photo_nope)
  const implementation = record(source.implementation ?? source.section_12_implementation)

  const logoVariants = array(logos.variants).map(record)
  const legacyLogoUrls = [
    logos.primary_url,
    logos.logoUrl,
    ...array(logos.logoVariations),
    ...array(logos.variations).filter(value => validUrl(value)),
  ].flatMap(value => validUrl(value) ? [validUrl(value)!] : [])

  if (!logoVariants.length) {
    legacyLogoUrls.forEach((url, index) => {
      logoVariants.push({
        role: index === 0 ? 'primary' : 'secondary',
        url,
        alt: string(identity.name || source.brandName) || 'Property logo',
        restrictions: [],
      })
    })
  }

  const typographyRoles = array(typography.roles).map(record)
  if (!typographyRoles.length) {
    const aliases = [
      ['headline', typography.headline ?? typography.primaryFont],
      ['body', typography.body ?? typography.secondaryFont],
      ['accent', typography.accent],
    ] as const
    for (const [role, raw] of aliases) {
      const item = record(raw)
      const family = string(item.family || item.font || item.name)
      if (!family) continue
      typographyRoles.push({
        role,
        family,
        weights: array(item.weights ?? item.weight).map(number).filter((weight): weight is number => Boolean(weight)),
        usage: string(item.usage),
        fallback: string(item.fallback) || undefined,
      })
    }
  }

  const colorRoles = array(colors.roles).map(record)
  if (!colorRoles.length) {
    for (const role of ['primary', 'secondary', 'accent'] as const) {
      const raw = role === 'accent' ? colors.accents ?? colors.accent : colors[role]
      for (const itemValue of array(raw)) {
        const item = record(itemValue)
        const colorValue = string(item.hex || item.value || item.color || itemValue)
        if (!colorValue) continue
        colorRoles.push({
          role,
          name: string(item.name) || role,
          hex: hex(colorValue),
          usage: string(item.usage || item.description),
        })
      }
    }
    for (const itemValue of array(colors.palette)) {
      const item = record(itemValue)
      if (!string(item.hex || item.value)) continue
      colorRoles.push({
        role: colorRoles.length ? 'accent' : 'primary',
        name: string(item.name) || 'Brand color',
        hex: hex(item.hex || item.value),
        usage: string(item.usage || item.description),
      })
    }
  }

  const contract = {
    contractVersion: BRAND_FORGE_CONTRACT_VERSION,
    origin: options.origin,
    introduction: {
      ...introduction,
      _meta: sectionMeta(introduction, options),
      content: string(introduction.content),
      marketInsights: strings(introduction.marketInsights),
    },
    positioning: {
      ...positioning,
      _meta: sectionMeta(positioning, options),
      statement: string(positioning.statement),
      rationale: string(positioning.rationale),
      voice: strings(positioning.voice || positioning.brandVoice),
      prohibitedVoice: strings(positioning.prohibitedVoice || positioning.avoid),
    },
    audience: {
      ...audience,
      _meta: sectionMeta(audience, options),
      primary: string(audience.primary),
      demographics: Object.fromEntries(
        Object.entries(record(audience.demographics)).map(([key, value]) => [key, string(value)]),
      ),
      psychographics: strings(audience.psychographics),
    },
    personas: {
      ...personas,
      _meta: sectionMeta(personas, options),
      personas: array(personas.personas).map(record).map(persona => ({
        ...persona,
        name: string(persona.name),
        ...(number(persona.age) != null ? { age: number(persona.age) } : {}),
        ...(string(persona.occupation) ? { occupation: string(persona.occupation) } : {}),
        ...(string(persona.quote) ? { quote: string(persona.quote) } : {}),
        ...(string(persona.story) ? { story: string(persona.story) } : {}),
      })),
    },
    identity: {
      ...identity,
      _meta: sectionMeta(identity, options),
      name: string(identity.name || source.brandName),
      tagline: string(identity.tagline || source.tagline),
      story: string(identity.story),
      rationale: string(identity.rationale),
    },
    logos: {
      ...logos,
      _meta: sectionMeta(logos, options),
      variants: logoVariants.map((variant, index) => ({
        role: ['primary', 'secondary', 'monochrome', 'mark', 'favicon'].includes(string(variant.role))
          ? string(variant.role)
          : index === 0 ? 'primary' : 'secondary',
        ...(validUuid(variant.assetId) ? { assetId: validUuid(variant.assetId) } : {}),
        ...(validUrl(variant.url) ? { url: validUrl(variant.url) } : {}),
        alt: string(variant.alt) || string(identity.name) || 'Property logo',
        restrictions: strings(variant.restrictions),
      })),
      usageRules: strings(logos.usageRules || logos.usage),
    },
    typography: {
      ...typography,
      _meta: sectionMeta(typography, options),
      roles: typographyRoles.map((role, index) => ({
        role: ['headline', 'body', 'accent'].includes(string(role.role))
          ? string(role.role)
          : index === 0 ? 'headline' : 'body',
        family: string(role.family || role.font || role.name),
        weights: array(role.weights ?? role.weight)
          .map(number)
          .filter((weight): weight is number => Boolean(weight))
          .map(weight => Math.min(900, Math.max(100, Math.round(weight / 100) * 100))),
        usage: string(role.usage),
        ...(validUuid(role.assetId) ? { assetId: validUuid(role.assetId) } : {}),
        ...(string(role.fallback) ? { fallback: string(role.fallback) } : {}),
      })).map(role => ({
        ...role,
        weights: role.weights.length ? role.weights : [400],
        fallback: role.fallback || 'Arial, sans-serif',
      })),
    },
    colors: {
      ...colors,
      _meta: sectionMeta(colors, options),
      roles: colorRoles.map((color, index) => ({
        role: ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted'].includes(string(color.role))
          ? string(color.role)
          : index === 0 ? 'primary' : 'accent',
        name: string(color.name) || 'Brand color',
        hex: hex(color.hex || color.value),
        usage: string(color.usage || color.description),
      })),
      usageGuidelines: string(colors.usageGuidelines || colors.usage),
    },
    designElements: {
      ...designElements,
      _meta: sectionMeta(designElements, options),
      elements: array(designElements.elements).map(record).map(element => ({
        ...element,
        type: string(element.type),
        name: string(element.name),
        description: string(element.description),
        ...(validUuid(element.assetId) ? { assetId: validUuid(element.assetId) } : {}),
      })),
      usageNotes: string(designElements.usageNotes),
    },
    photographyYes: {
      ...photographyYes,
      _meta: sectionMeta(photographyYes, options),
      description: string(photographyYes.description),
      criteria: strings(photographyYes.criteria),
      exampleAssetIds: array(photographyYes.exampleAssetIds).flatMap(value => validUuid(value) ? [validUuid(value)!] : []),
    },
    photographyNo: {
      ...photographyNo,
      _meta: sectionMeta(photographyNo, options),
      description: string(photographyNo.description),
      criteria: strings(photographyNo.criteria),
    },
    implementation: {
      ...implementation,
      _meta: sectionMeta(implementation, options),
      examples: array(implementation.examples).map(record).map(example => ({
        ...example,
        type: string(example.type),
        description: string(example.description),
      })),
      lockedRules: strings(implementation.lockedRules || implementation.prohibitedSubstitutions),
    },
  }

  return brandForgeContractV1Schema.parse(contract)
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as JsonRecord).sort().reduce<JsonRecord>((result, key) => {
    const item = (value as JsonRecord)[key]
    if (item !== undefined) result[key] = normalizeForHash(item)
    return result
  }, {})
}

export function hashBrandForgeContract(contract: BrandForgeContractV1): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeForHash(contract)))
    .digest('hex')
}

export function brandContractToStorageSections(contract: BrandForgeContractV1) {
  return {
    section_1_introduction: contract.introduction,
    section_2_positioning: contract.positioning,
    section_3_target_audience: contract.audience,
    section_4_personas: contract.personas,
    section_5_name_story: contract.identity,
    section_6_logo: contract.logos,
    section_7_typography: contract.typography,
    section_8_colors: contract.colors,
    section_9_design_elements: contract.designElements,
    section_10_photo_yep: contract.photographyYes,
    section_11_photo_nope: contract.photographyNo,
    section_12_implementation: contract.implementation,
  }
}

export function normalizeBrandAssetRow(row: JsonRecord): BrandForgeContractV1 {
  const generationStatus = string(row.generation_status)
  const approvalStatus = string(row.approval_status)
  return normalizeBrandForgeContract(row, {
    origin: row.brand_origin === 'imported' || row.brand_origin === 'hybrid'
      ? row.brand_origin
      : 'generated',
    approvalStatus: approvalStatus === 'approved' || generationStatus === 'complete'
      ? 'approved'
      : approvalStatus === 'reviewing' || generationStatus === 'reviewing'
        ? 'reviewing'
        : 'draft',
    approvedBy: string(row.approved_by),
    approvedAt: string(row.approved_at),
  })
}
