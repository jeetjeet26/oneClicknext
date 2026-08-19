import { z } from 'zod'

export const siteForgeAssetTruthClassSchema = z.enum([
  'documentary',
  'client_rendering',
  'generated_brand_graphic',
  'conceptual',
  'decorative',
])

export const siteForgeAssetTruthRecordSchema = z.object({
  assetId: z.string().min(1),
  truthClass: siteForgeAssetTruthClassSchema,
  generated: z.boolean(),
  sourceType: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rightsOwner: z.string().min(1).nullable(),
  allowedUsage: z.array(z.string().min(1)).min(1),
  expiresAt: z.iso.datetime().nullable(),
  transformations: z.array(z.string()).default([]),
  modelMetadata: z.record(z.string(), z.unknown()).nullable(),
  factualSubjects: z.array(z.string()).default([]),
})

export type SiteForgeAssetTruthRecord = z.infer<
  typeof siteForgeAssetTruthRecordSchema
>

export type SiteForgeAssetTruthFinding = {
  code: string
  severity: 'blocker' | 'warning'
  assetId: string
  message: string
}

const documentarySubjects = new Set([
  'building',
  'view',
  'finish',
  'amenity',
  'home',
  'unit',
  'inventory',
  'neighborhood_condition',
  'construction_progress',
])

export function evaluateSiteForgeAssetTruth(
  input: SiteForgeAssetTruthRecord,
  now = new Date()
): SiteForgeAssetTruthFinding[] {
  const asset = siteForgeAssetTruthRecordSchema.parse(input)
  const findings: SiteForgeAssetTruthFinding[] = []
  if (asset.generated && asset.truthClass === 'documentary') {
    findings.push({
      code: 'generated_documentary_asset',
      severity: 'warning',
      assetId: asset.assetId,
      message:
        'AI-generated media cannot represent documentary property conditions.',
    })
  }
  if (
    asset.generated &&
    asset.factualSubjects.some((subject) => documentarySubjects.has(subject))
  ) {
    findings.push({
      code: 'generated_factual_subject',
      severity: 'warning',
      assetId: asset.assetId,
      message:
        'Generated media cannot depict an actual property, inventory, view, finish, or construction condition.',
    })
  }
  if (
    ['documentary', 'client_rendering'].includes(asset.truthClass) &&
    !asset.rightsOwner
  ) {
    findings.push({
      code: 'missing_visual_rights_owner',
      severity: 'warning',
      assetId: asset.assetId,
      message: 'Documentary and client rendering assets require a rights owner.',
    })
  }
  if (asset.expiresAt && new Date(asset.expiresAt).getTime() <= now.getTime()) {
    findings.push({
      code: 'expired_visual_rights',
      severity: 'warning',
      assetId: asset.assetId,
      message: 'Asset usage rights have expired.',
    })
  }
  if (
    asset.generated &&
    ['conceptual', 'decorative'].includes(asset.truthClass) &&
    !asset.allowedUsage.includes('conceptual')
  ) {
    findings.push({
      code: 'generated_asset_requires_label',
      severity: 'warning',
      assetId: asset.assetId,
      message: 'Conceptual generated media must retain conceptual usage metadata.',
    })
  }
  return findings
}
