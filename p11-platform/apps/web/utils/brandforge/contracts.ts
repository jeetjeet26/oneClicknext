import { z } from 'zod'

export const BRAND_FORGE_CONTRACT_VERSION = '1.0' as const
export const BRAND_FORGE_COMPETITIVE_SNAPSHOT_VERSION = '1.0' as const

export const brandOriginSchema = z.enum(['generated', 'imported', 'hybrid'])
export const brandForgeModeSchema = z.enum(['generated', 'supplied'])
export const brandForgeVerticalSchema = z.enum([
  'multifamily_rental',
  'for_sale_community',
])
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

export const competitivePositioningEvidenceSchema = z.object({
  competitorId: z.string().uuid(),
  competitorName: z.string().min(1),
  positioning: z.string().nullable(),
  brandVoice: z.string().nullable(),
  targetAudience: z.string().nullable(),
  messagingThemes: z.array(z.string()),
  source: z.object({
    sourceType: z.literal('competitor_brand_intelligence'),
    sourceId: z.string().uuid(),
    captureId: z.string().uuid().nullable(),
    sourceUrl: z.url().nullable(),
    observedAt: z.iso.datetime().nullable(),
  }),
})

export const competitivePositioningSnapshotSchema = z.object({
  schemaVersion: z.literal(BRAND_FORGE_COMPETITIVE_SNAPSHOT_VERSION),
  propertyId: z.string().uuid(),
  vertical: brandForgeVerticalSchema,
  generatedAt: z.iso.datetime(),
  evidence: z.array(competitivePositioningEvidenceSchema),
  marketGaps: z.array(z.string()),
  websiteExpressionOpportunities: z.array(z.string()),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  causalHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export const brandForgeGeneratedContentSchema = z.object({
  introduction: z.object({
    content: z.string(),
    marketInsights: z.array(z.string()),
  }),
  positioning: z.object({
    statement: z.string(),
    rationale: z.string(),
    voice: z.array(z.string()),
    prohibitedVoice: z.array(z.string()),
  }),
  audience: z.object({
    primary: z.string(),
    demographics: z.record(z.string(), z.string()),
    psychographics: z.array(z.string()),
  }),
  personas: z.object({
    personas: z.array(z.object({
      name: z.string(),
      age: z.number().int().nonnegative().optional(),
      occupation: z.string().optional(),
      quote: z.string().optional(),
      story: z.string().optional(),
    })),
  }),
  identity: z.object({
    name: z.string(),
    tagline: z.string(),
    story: z.string(),
    rationale: z.string(),
  }),
  logos: z.object({
    variants: z.array(z.object({
      role: z.enum(['primary', 'secondary', 'monochrome', 'mark', 'favicon']),
      assetId: z.string().uuid().optional(),
      url: z.url().optional(),
      alt: z.string(),
      restrictions: z.array(z.string()),
    })),
    usageRules: z.array(z.string()),
  }),
  typography: z.object({
    roles: z.array(z.object({
      role: z.enum(['headline', 'body', 'accent']),
      family: z.string(),
      weights: z.array(z.number().int().min(100).max(900)),
      usage: z.string(),
      assetId: z.string().uuid().optional(),
      fallback: z.string().optional(),
    })),
  }),
  colors: z.object({
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
  designElements: z.object({
    elements: z.array(z.object({
      type: z.string(),
      name: z.string(),
      description: z.string(),
      assetId: z.string().uuid().optional(),
    })),
    usageNotes: z.string(),
  }),
  photographyYes: z.object({
    description: z.string(),
    criteria: z.array(z.string()),
    exampleAssetIds: z.array(z.string().uuid()),
  }),
  photographyNo: z.object({
    description: z.string(),
    criteria: z.array(z.string()),
  }),
  implementation: z.object({
    examples: z.array(z.object({
      type: z.string(),
      description: z.string(),
    })),
    lockedRules: z.array(z.string()),
  }),
})

const brandForgeWorkflowBaseSchema = z.object({
  brandAssetId: z.string().uuid(),
  propertyId: z.string().uuid(),
  orgId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  vertical: brandForgeVerticalSchema,
})

export const brandForgeWorkflowInputSchema = z.discriminatedUnion('mode', [
  brandForgeWorkflowBaseSchema.extend({
    mode: z.literal('generated'),
    creativeBrief: z.object({
      brandName: z.string().trim().min(1),
      vision: z.string().trim().default(''),
      targetAudience: z.string().trim().default(''),
      brandVoice: z.string().trim().default(''),
      personality: z.array(z.string()).default([]),
      visualPreferences: z.array(z.string()).default([]),
    }),
  }),
  brandForgeWorkflowBaseSchema.extend({
    mode: z.literal('supplied'),
    suppliedContract: brandForgeContractV1Schema,
  }),
])

export type BrandForgeMode = z.infer<typeof brandForgeModeSchema>
export type BrandForgeVertical = z.infer<typeof brandForgeVerticalSchema>
export type BrandForgeGeneratedContent = z.infer<typeof brandForgeGeneratedContentSchema>
export type CompetitivePositioningEvidence = z.infer<typeof competitivePositioningEvidenceSchema>
export type CompetitivePositioningSnapshot = z.infer<typeof competitivePositioningSnapshotSchema>
export type BrandForgeWorkflowInput = z.infer<typeof brandForgeWorkflowInputSchema>

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
