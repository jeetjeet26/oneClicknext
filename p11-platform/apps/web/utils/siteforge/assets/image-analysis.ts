import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { SITEFORGE_EDITOR_MODEL } from '@/utils/siteforge/models'
import { assetRoleSchema, cropSuggestionSchema, focalPointSchema } from './contracts'

const MAX_ANALYSIS_BYTES = 20 * 1024 * 1024
const supportedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

const visualAnalysisSchema = z.object({
  suggestedRole: assetRoleSchema.exclude(['floorplan']).nullable(),
  altText: z.string().trim().min(1).max(300).nullable(),
  focalPoint: focalPointSchema.nullable(),
  cropSuggestion: cropSuggestionSchema.nullable(),
  qualityScore: z.number().min(0).max(1).nullable(),
  observedElements: z.array(z.string().trim().min(1).max(120)).max(20),
  qualityNotes: z.array(z.string().trim().min(1).max(200)).max(10),
})

export type SiteForgeImageAnalysis = {
  mode: 'visual_ai' | 'metadata_fallback'
  model: string | null
  visualClaims: boolean
  suggestedRole: z.infer<typeof visualAnalysisSchema>['suggestedRole']
  altText: string | null
  focalPoint: z.infer<typeof focalPointSchema> | null
  cropSuggestion: z.infer<typeof cropSuggestionSchema> | null
  qualityScore: number | null
  observedElements: string[]
  qualityNotes: string[]
  metadata: {
    contentHash: string
    byteLength: number
    mediaType: string
    width: number | null
    height: number | null
  }
}

function readPngDimensions(bytes: Uint8Array) {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  return null
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    const segmentLength = (bytes[offset + 2] << 8) + bytes[offset + 3]
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker
      )
    ) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
      }
    }
    if (segmentLength < 2) break
    offset += segmentLength + 2
  }
  return null
}

function readWebpDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 30 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' ||
    new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP' ||
    new TextDecoder().decode(bytes.slice(12, 16)) !== 'VP8X'
  ) {
    return null
  }
  return {
    width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
    height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
  }
}

export function inspectImageMetadata(
  bytes: Uint8Array,
  mediaType: string
): SiteForgeImageAnalysis['metadata'] {
  const dimensions =
    mediaType === 'image/png'
      ? readPngDimensions(bytes)
      : mediaType === 'image/jpeg'
        ? readJpegDimensions(bytes)
        : mediaType === 'image/webp'
          ? readWebpDimensions(bytes)
          : null
  return {
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  }
}

function metadataFallback(
  metadata: SiteForgeImageAnalysis['metadata']
): SiteForgeImageAnalysis {
  return {
    mode: 'metadata_fallback',
    model: null,
    visualClaims: false,
    suggestedRole: null,
    altText: null,
    focalPoint: null,
    cropSuggestion: null,
    qualityScore: null,
    observedElements: [],
    qualityNotes: [
      'Visual analysis was unavailable; only deterministic file metadata was recorded.',
    ],
    metadata,
  }
}

export async function analyzeImageContent(input: {
  bytes: Uint8Array
  mediaType: string
  filename?: string
  operatorRole?: string | null
  model?: string
}): Promise<SiteForgeImageAnalysis> {
  if (!supportedImageTypes.has(input.mediaType)) {
    throw new Error('Unsupported image type for SiteForge analysis')
  }
  if (input.bytes.byteLength > MAX_ANALYSIS_BYTES) {
    throw new Error('Image is too large for SiteForge analysis')
  }
  const metadata = inspectImageMetadata(input.bytes, input.mediaType)
  const model =
    input.model ||
    process.env.SITEFORGE_ASSET_ANALYSIS_MODEL ||
    SITEFORGE_EDITOR_MODEL

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: visualAnalysisSchema }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: input.bytes,
              mediaType: input.mediaType,
            },
            {
              type: 'text',
              text: [
                'Inspect the attached property image itself.',
                'Return only directly visible observations. Use null when uncertain.',
                'Do not infer an address, identity, protected trait, ownership, licensing, or property feature that is not visibly established.',
                'Suggest a SiteForge role, concise accessible alt text, normalized focal point/crop, and technical/composition quality from 0 to 1.',
                input.operatorRole
                  ? `The operator provisionally labeled it "${input.operatorRole}"; verify rather than assume.`
                  : '',
                input.filename
                  ? 'The filename is supplied only for traceability and is not visual evidence.'
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
      ],
    })
    if (!result.output) return metadataFallback(metadata)
    return {
      mode: 'visual_ai',
      model,
      visualClaims: true,
      ...result.output,
      metadata,
    }
  } catch {
    return metadataFallback(metadata)
  }
}
