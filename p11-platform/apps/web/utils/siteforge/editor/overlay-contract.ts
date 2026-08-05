import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { posix } from 'node:path'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const SITEFORGE_OVERLAY_BUCKET = 'siteforge-artifacts'
export const MAX_OVERLAY_FILES = 20
export const MAX_OVERLAY_FILE_BYTES = 100_000
export const MAX_OVERLAY_PACKAGE_BYTES = 1_000_000
const MAX_OVERLAY_EXTRACTED_BYTES = 1_250_000
const MAX_OVERLAY_ZIP_ENTRIES = MAX_OVERLAY_FILES + 3

export const SITEFORGE_OVERLAY_ALLOWED_PATH =
  /^(assets\/(css|js)\/[a-z0-9][a-z0-9._/-]*|partials\/[a-z0-9][a-z0-9._/-]*\.php)$/

export const themeOverlayProposalSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(240)
              .regex(SITEFORGE_OVERLAY_ALLOWED_PATH),
            content: z.string().max(MAX_OVERLAY_FILE_BYTES),
          })
          .strict()
      )
      .min(1)
      .max(MAX_OVERLAY_FILES),
  })
  .strict()

export type ThemeOverlayProposal = z.infer<typeof themeOverlayProposalSchema>

const overlayManifestFileSchema = z
  .object({
    path: z.string().min(1).max(240),
    mediaType: z.enum([
      'text/css',
      'application/javascript',
      'text/x-php',
    ]),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().max(MAX_OVERLAY_FILE_BYTES),
  })
  .strict()

export const overlayManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    files: z
      .array(overlayManifestFileSchema)
      .min(2)
      .max(MAX_OVERLAY_ZIP_ENTRIES - 1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>()
    for (const [index, file] of manifest.files.entries()) {
      const generatedPath =
        file.path === 'functions.php' || file.path === 'style.css'
      if (
        !generatedPath &&
        !SITEFORGE_OVERLAY_ALLOWED_PATH.test(file.path)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Overlay manifest path is not allowlisted',
        })
      }
      const expectedMediaType = file.path.endsWith('.css')
        ? 'text/css'
        : file.path.endsWith('.js')
          ? 'application/javascript'
          : 'text/x-php'
      if (file.mediaType !== expectedMediaType) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index, 'mediaType'],
          message: 'Overlay manifest media type does not match its path',
        })
      }
      if (seen.has(file.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Overlay manifest contains a duplicate path',
        })
      }
      seen.add(file.path)
    }
    for (const required of ['functions.php', 'style.css']) {
      if (!seen.has(required)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files'],
          message: `Overlay manifest is missing ${required}`,
        })
      }
    }
  })

export type OverlayManifest = z.infer<typeof overlayManifestSchema>

export const overlayRuntimeCompatibilitySchema = z
  .object({
    contractVersion: z.literal(1),
    overlayId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceArtifactId: z.string().uuid(),
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    storage: z
      .object({
        bucket: z.literal(SITEFORGE_OVERLAY_BUCKET),
        path: z.string().min(1).max(500),
      })
      .strict(),
    validation: z
      .object({
        validator: z.literal('siteforge-static-sandbox-v1'),
        reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

export type OverlayRuntimeCompatibility = z.infer<
  typeof overlayRuntimeCompatibilitySchema
>

const packageDescriptorSchema = z
  .object({
    descriptorVersion: z.literal(1),
    overlayContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    manifest: overlayManifestSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict()

export function sha256OverlayValue(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function computeOverlayContentHash(
  reason: string,
  manifest: OverlayManifest
): string {
  return hashSiteForgeContent({ reason, manifest })
}

export function computeOverlaySignature(input: {
  websiteId: string
  contentHash: string
  packageSha256: string
  signingSecret: string
}): string {
  return createHmac('sha256', input.signingSecret)
    .update(`${input.websiteId}:${input.contentHash}:${input.packageSha256}`)
    .digest('hex')
}

export function verifyOverlaySignature(input: {
  websiteId: string
  contentHash: string
  packageSha256: string
  signature: string
  signingSecret: string
}): boolean {
  const expected = computeOverlaySignature(input)
  if (
    !/^[a-f0-9]{64}$/.test(input.signature) ||
    expected.length !== input.signature.length
  ) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.signature, 'hex'))
}

function assertReviewableZipPath(path: string): void {
  if (
    path === 'siteforge-overlay.json' ||
    path === 'functions.php' ||
    path === 'style.css'
  ) {
    return
  }
  if (
    !SITEFORGE_OVERLAY_ALLOWED_PATH.test(path) ||
    path.startsWith('/') ||
    path.includes('..') ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`Stored theme overlay package has unsafe entry: ${path}`)
  }
}

export interface ReviewedOverlayPackage {
  packageSha256: string
  reason: string
  manifest: OverlayManifest
  files: Array<{
    path: string
    content: string
    contentHash: string
    bytes: number
    mediaType: OverlayManifest['files'][number]['mediaType']
  }>
}

export function inspectStoredOverlayPackage(
  archive: Uint8Array,
  expected: {
    contentHash: string
    manifest: OverlayManifest
    packageSha256?: string
  }
): ReviewedOverlayPackage {
  if (archive.byteLength > MAX_OVERLAY_PACKAGE_BYTES) {
    throw new Error('Stored theme overlay package is too large')
  }
  let entryCount = 0
  let extractedBytes = 0
  const entries = unzipSync(archive, {
    filter: entry => {
      entryCount += 1
      extractedBytes += entry.originalSize
      if (
        entryCount > MAX_OVERLAY_ZIP_ENTRIES ||
        entry.originalSize > MAX_OVERLAY_FILE_BYTES ||
        extractedBytes > MAX_OVERLAY_EXTRACTED_BYTES
      ) {
        throw new Error('Stored theme overlay package exceeds extraction limits')
      }
      assertReviewableZipPath(entry.name)
      return true
    },
  })
  const packageSha256 = sha256OverlayValue(archive)
  if (
    expected.packageSha256 &&
    packageSha256 !== expected.packageSha256
  ) {
    throw new Error('Stored theme overlay package digest does not match')
  }
  const descriptorEntry = entries['siteforge-overlay.json']
  if (!descriptorEntry) {
    throw new Error('Stored theme overlay package has no manifest descriptor')
  }
  const descriptor = packageDescriptorSchema.parse(
    JSON.parse(strFromU8(descriptorEntry))
  )
  const expectedManifest = overlayManifestSchema.parse(expected.manifest)
  if (
    descriptor.overlayContentHash !== expected.contentHash ||
    computeOverlayContentHash(descriptor.reason, descriptor.manifest) !==
      expected.contentHash ||
    hashSiteForgeContent(descriptor.manifest) !==
      hashSiteForgeContent(expectedManifest) ||
    hashSiteForgeContent(descriptor.manifest.files) !==
      descriptor.manifest.contentHash
  ) {
    throw new Error('Stored theme overlay package manifest does not match')
  }

  const expectedPaths = new Set([
    'siteforge-overlay.json',
    ...expectedManifest.files.map(file => file.path),
  ])
  const actualPaths = Object.keys(entries)
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some(path => !expectedPaths.has(path))
  ) {
    throw new Error('Stored theme overlay package contains unexpected entries')
  }

  const files = expectedManifest.files.map(file => {
    const entry = entries[file.path]
    if (
      !entry ||
      entry.byteLength !== file.bytes ||
      sha256OverlayValue(entry) !== file.contentHash
    ) {
      throw new Error(
        `Stored theme overlay package file does not match: ${file.path}`
      )
    }
    const content = strFromU8(entry)
    if (sha256OverlayValue(strToU8(content)) !== file.contentHash) {
      throw new Error(
        `Stored theme overlay package file is not valid UTF-8: ${file.path}`
      )
    }
    return { ...file, content }
  })
  return {
    packageSha256,
    reason: descriptor.reason,
    manifest: expectedManifest,
    files,
  }
}
