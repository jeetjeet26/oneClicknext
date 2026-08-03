import { z } from 'zod'

export const BRAND_FORGE_CONTRACT_VERSION = '1.0' as const

export const brandOriginSchema = z.enum(['generated', 'imported', 'hybrid'])
export const brandApprovalStatusSchema = z.enum([
  'draft',
  'reviewing',
  'approved',
  'rejected',
])

const provenanceSchema = z.object({
  sourceType: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  sourceUrl: z.url().optional(),
  capturedAt: z.iso.datetime().optional(),
  excerpt: z.string().optional(),
})

export const brandSectionMetaSchema = z.object({
  schemaVersion: z.literal(BRAND_FORGE_CONTRACT_VERSION),
  origin: brandOriginSchema,
  confidence: z.number().min(0).max(1),
  provenance: z.record(z.string(), z.array(provenanceSchema)),
  approval: z.object({
    status: brandApprovalStatusSchema,
    approvedBy: z.string().uuid().optional(),
    approvedAt: z.iso.datetime().optional(),
  }),
})

const canonicalSection = <T extends z.ZodRawShape>(shape: T) =>
  z.looseObject({ _meta: brandSectionMetaSchema, ...shape })

export const brandForgeContractV1Schema = z.object({
  contractVersion: z.literal(BRAND_FORGE_CONTRACT_VERSION),
  origin: brandOriginSchema,
  introduction: canonicalSection({
    content: z.string(),
    marketInsights: z.array(z.string()),
  }),
  positioning: canonicalSection({
    statement: z.string(),
    rationale: z.string(),
    voice: z.array(z.string()),
    prohibitedVoice: z.array(z.string()),
  }),
  audience: canonicalSection({
    primary: z.string(),
    demographics: z.record(z.string(), z.string()),
    psychographics: z.array(z.string()),
  }),
  personas: canonicalSection({
    personas: z.array(z.looseObject({
      name: z.string(),
      age: z.number().int().nonnegative().optional(),
      occupation: z.string().optional(),
      quote: z.string().optional(),
      story: z.string().optional(),
    })),
  }),
  identity: canonicalSection({
    name: z.string(),
    tagline: z.string(),
    story: z.string(),
    rationale: z.string(),
  }),
  logos: canonicalSection({
    variants: z.array(z.object({
      role: z.enum(['primary', 'secondary', 'monochrome', 'mark', 'favicon']),
      assetId: z.string().uuid().optional(),
      url: z.url().optional(),
      alt: z.string(),
      restrictions: z.array(z.string()),
    })),
    usageRules: z.array(z.string()),
  }),
  typography: canonicalSection({
    roles: z.array(z.object({
      role: z.enum(['headline', 'body', 'accent']),
      family: z.string(),
      weights: z.array(z.number().int().min(100).max(900)),
      usage: z.string(),
      assetId: z.string().uuid().optional(),
      fallback: z.string().optional(),
    })),
  }),
  colors: canonicalSection({
    roles: z.array(z.object({
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
      hex: z.string().regex(/^#[0-9a-f]{6}$/i),
      usage: z.string(),
    })),
    usageGuidelines: z.string(),
  }),
  designElements: canonicalSection({
    elements: z.array(z.looseObject({
      type: z.string(),
      name: z.string(),
      description: z.string(),
      assetId: z.string().uuid().optional(),
    })),
    usageNotes: z.string(),
  }),
  photographyYes: canonicalSection({
    description: z.string(),
    criteria: z.array(z.string()),
    exampleAssetIds: z.array(z.string().uuid()),
  }),
  photographyNo: canonicalSection({
    description: z.string(),
    criteria: z.array(z.string()),
  }),
  implementation: canonicalSection({
    examples: z.array(z.looseObject({
      type: z.string(),
      description: z.string(),
    })),
    lockedRules: z.array(z.string()),
  }),
})

export type BrandForgeContractV1 = z.infer<typeof brandForgeContractV1Schema>
export type BrandSectionMeta = z.infer<typeof brandSectionMetaSchema>

export const BRAND_SECTION_COLUMNS = [
  'section_1_introduction',
  'section_2_positioning',
  'section_3_target_audience',
  'section_4_personas',
  'section_5_name_story',
  'section_6_logo',
  'section_7_typography',
  'section_8_colors',
  'section_9_design_elements',
  'section_10_photo_yep',
  'section_11_photo_nope',
  'section_12_implementation',
] as const
