import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const text = z.string().trim().min(1)
const hex = z.string().regex(/^#[0-9a-f]{6}$/i)

export const siteForgeCreativeDirectionSchema = z.object({
  rationale: text,
  typography: z.object({
    headingFamily: text,
    bodyFamily: text,
    scale: text,
    weightStrategy: text,
  }),
  palette: z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    background: hex,
    text: hex,
  }),
  hero: z.object({
    composition: text,
    headlineStyle: text,
    mediaTreatment: text,
  }),
  layout: z.object({
    system: text,
    density: text,
    sectionRhythm: text,
  }),
  imagery: z.object({
    style: text,
    subjects: z.array(text).min(1),
    treatment: text,
  }),
  cta: z.object({
    label: text,
    placement: text,
    style: text,
  }),
  voice: z.object({
    traits: z.array(text).min(2),
    do: z.array(text).min(1),
    dont: z.array(text).min(1),
  }),
  tradeoffs: z.array(text).min(1),
  provenance: z.object({
    generator: z.literal('siteforge-deterministic-directions-v1'),
    briefVersionId: z.guid(),
    briefContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    onboardingSnapshotId: z.guid(),
    onboardingSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    brandAssetId: z.guid(),
    brandContractHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
})

export const siteForgeDirectionPreviewSchema = z.object({
  paletteSwatches: z.array(hex).length(5),
  heroMode: text,
  layoutMode: text,
  typographyPairing: text,
})

export type SiteForgeCreativeDirection = z.infer<
  typeof siteForgeCreativeDirectionSchema
>
export type SiteForgeDirectionPreview = z.infer<
  typeof siteForgeDirectionPreviewSchema
>

export type SiteForgeDirectionCandidate = {
  id?: string
  ordinal: number
  name: string
  direction: SiteForgeCreativeDirection
  previewManifest: SiteForgeDirectionPreview
  contentHash: string
}

export function hashSiteForgeDirection(input: {
  name: string
  ordinal: number
  direction: SiteForgeCreativeDirection
  previewManifest: SiteForgeDirectionPreview
}): string {
  return hashSiteForgeContent({ schemaVersion: 1, ...input })
}

export function hashSiteForgeDirectionSet(input: {
  briefVersionId: string
  briefContentHash: string
  directionHashes: string[]
  selectedDirectionHash: string | null
  selectionNotes: string | null
}): string {
  return hashSiteForgeContent({
    schemaVersion: 1,
    briefVersionId: input.briefVersionId,
    briefContentHash: input.briefContentHash,
    directionHashes: input.directionHashes,
    selectedDirectionHash: input.selectedDirectionHash,
    selectionNotes: input.selectionNotes?.trim() || null,
  })
}

export function assertMateriallyDistinctDirections(
  directions: SiteForgeDirectionCandidate[]
): void {
  if (directions.length < 2 || directions.length > 3) {
    throw new Error('Creative direction sets must contain two or three options')
  }
  const signatures = new Set(
    directions.map(candidate =>
      hashSiteForgeContent({
        hero: candidate.direction.hero,
        layout: candidate.direction.layout,
        imagery: candidate.direction.imagery,
        cta: candidate.direction.cta,
      })
    )
  )
  if (signatures.size !== directions.length) {
    throw new Error('Creative directions must be materially distinct')
  }
}
