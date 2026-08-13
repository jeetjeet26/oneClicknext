import { createHash } from 'node:crypto'
import type { Json } from '@/types/supabase'
import { siteBlueprintSchema, type SiteBlueprint } from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  renderedCertificationReportSchema,
} from '@/utils/siteforge/verification/rendered-certification'
import type { BrowserScreenshotEvidence } from '@/utils/siteforge/verification/browser-evidence'
import { SITEFORGE_CRITIQUE_MAX_EVIDENCE_AGE_MS } from './contracts'

const REQUIRED_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const
const MAX_SCREENSHOT_BYTES = 12 * 1_024 * 1_024
const MAX_TOTAL_SCREENSHOT_BYTES = 80 * 1_024 * 1_024

export type CritiqueEvidenceErrorCode =
  | 'artifact_mismatch'
  | 'evidence_missing'
  | 'evidence_stale'
  | 'evidence_digest_mismatch'
  | 'screenshot_missing'
  | 'screenshot_mismatch'

export class CritiqueEvidenceError extends Error {
  constructor(
    public readonly code: CritiqueEvidenceErrorCode,
    message: string,
    public readonly statusCode = code === 'evidence_missing' ? 404 : 409
  ) {
    super(message)
    this.name = 'CritiqueEvidenceError'
  }
}

export interface CritiqueCertificationRow {
  id: string
  artifact_id: string
  evidence_hash: string | null
  binding_hash: string | null
  report_hash: string
  report: Json
  created_at: string
}

export interface BoundCritiqueScreenshot {
  descriptor: BrowserScreenshotEvidence
  bytes: Uint8Array
}

export interface BoundCritiqueEvidence {
  artifact: {
    id: string
    contentHash: string
    createdAt: string
    blueprint: SiteBlueprint
  }
  certificationEvidenceId: string
  evidenceDigest: string
  certificationReportHash: string
  certificationBindingHash: string
  capturedAt: string
  targetUrl: string
  screenshots: BoundCritiqueScreenshot[]
  screenshotManifestDigest: string
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function expectedPageUrl(baseUrl: string, slug: string): string {
  return normalizedUrl(
    new URL(slug === 'home' ? '/' : `/${slug}/`, baseUrl).toString()
  )
}

function screenshotKey(
  screenshot: Pick<BrowserScreenshotEvidence, 'url' | 'viewport'>
): string {
  return `${normalizedUrl(screenshot.url)}|${screenshot.viewport}`
}

function assertPng(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (
    bytes.length < signature.length ||
    signature.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new CritiqueEvidenceError(
      'screenshot_mismatch',
      'Screenshot evidence is not a PNG payload'
    )
  }
}

export async function bindRenderedCritiqueEvidence(input: {
  artifact: {
    id: string
    contentHash: string
    createdAt: string
    blueprint: Json
  }
  certification: CritiqueCertificationRow
  screenshotLoader: (
    descriptor: BrowserScreenshotEvidence
  ) => Promise<Uint8Array>
  now?: Date
  maxEvidenceAgeMs?: number
}): Promise<BoundCritiqueEvidence> {
  const reportResult = renderedCertificationReportSchema.safeParse(
    input.certification.report
  )
  if (!reportResult.success) {
    throw new CritiqueEvidenceError(
      'evidence_missing',
      'Certification report does not expose complete screenshot evidence'
    )
  }
  const blueprintResult = siteBlueprintSchema.safeParse(input.artifact.blueprint)
  if (!blueprintResult.success) {
    throw new CritiqueEvidenceError(
      'artifact_mismatch',
      'Critique artifact blueprint is invalid'
    )
  }
  const report = reportResult.data
  if (
    input.certification.artifact_id !== input.artifact.id ||
    report.artifactId !== input.artifact.id ||
    report.contentHash !== input.artifact.contentHash
  ) {
    throw new CritiqueEvidenceError(
      'artifact_mismatch',
      'Certification evidence does not match the exact critique artifact'
    )
  }
  const computedReportHash = hashSiteForgeContent(input.certification.report)
  if (computedReportHash !== input.certification.report_hash) {
    throw new CritiqueEvidenceError(
      'evidence_digest_mismatch',
      'Certification report hash does not match the stored report'
    )
  }
  if (
    !input.certification.evidence_hash ||
    input.certification.evidence_hash !== report.evidenceHash ||
    !input.certification.binding_hash ||
    input.certification.binding_hash !== report.bindingHash
  ) {
    throw new CritiqueEvidenceError(
      'evidence_digest_mismatch',
      'Certification evidence digest or binding hash is inconsistent'
    )
  }
  if (!report.browser.evidenceAccepted || !report.browser.capturedAt) {
    throw new CritiqueEvidenceError(
      'evidence_missing',
      'Accepted browser screenshot evidence is required for critique'
    )
  }

  const capturedAt = new Date(report.browser.capturedAt)
  const artifactCreatedAt = new Date(input.artifact.createdAt)
  const now = input.now ?? new Date()
  const maxEvidenceAgeMs =
    input.maxEvidenceAgeMs ?? SITEFORGE_CRITIQUE_MAX_EVIDENCE_AGE_MS
  if (
    Number.isNaN(capturedAt.getTime()) ||
    Number.isNaN(artifactCreatedAt.getTime()) ||
    capturedAt < artifactCreatedAt ||
    capturedAt > now ||
    now.getTime() - capturedAt.getTime() > maxEvidenceAgeMs
  ) {
    throw new CritiqueEvidenceError(
      'evidence_stale',
      'Screenshot evidence is stale for the exact artifact'
    )
  }

  const screenshots = report.browser.screenshots
  if (!screenshots.length) {
    throw new CritiqueEvidenceError(
      'screenshot_missing',
      'Certification report contains no screenshot manifest'
    )
  }
  const descriptorsByKey = new Map<string, BrowserScreenshotEvidence>()
  for (const descriptor of screenshots) {
    const key = screenshotKey(descriptor)
    if (descriptorsByKey.has(key)) {
      throw new CritiqueEvidenceError(
        'screenshot_mismatch',
        `Duplicate screenshot identity: ${key}`
      )
    }
    descriptorsByKey.set(key, descriptor)
  }
  const expectedKeys = blueprintResult.data.pages.flatMap(page =>
    REQUIRED_VIEWPORTS.map(
      viewport => `${expectedPageUrl(report.targetUrl, page.slug)}|${viewport}`
    )
  )
  const missing = expectedKeys.filter(key => !descriptorsByKey.has(key))
  if (missing.length) {
    throw new CritiqueEvidenceError(
      'screenshot_missing',
      `Screenshot evidence is incomplete: ${missing.join(', ')}`
    )
  }

  let totalBytes = 0
  const boundScreenshots: BoundCritiqueScreenshot[] = []
  for (const descriptor of screenshots) {
    if (descriptor.bytes > MAX_SCREENSHOT_BYTES) {
      throw new CritiqueEvidenceError(
        'screenshot_mismatch',
        `Screenshot exceeds critique byte budget: ${descriptor.storagePath}`
      )
    }
    const bytes = await input.screenshotLoader(descriptor)
    totalBytes += bytes.byteLength
    if (
      totalBytes > MAX_TOTAL_SCREENSHOT_BYTES ||
      bytes.byteLength !== descriptor.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256
    ) {
      throw new CritiqueEvidenceError(
        'screenshot_mismatch',
        `Screenshot bytes do not match the certified manifest: ${descriptor.storagePath}`
      )
    }
    assertPng(bytes)
    boundScreenshots.push({ descriptor, bytes })
  }

  return {
    artifact: {
      id: input.artifact.id,
      contentHash: input.artifact.contentHash,
      createdAt: input.artifact.createdAt,
      blueprint: blueprintResult.data,
    },
    certificationEvidenceId: input.certification.id,
    evidenceDigest: input.certification.evidence_hash,
    certificationReportHash: input.certification.report_hash,
    certificationBindingHash: input.certification.binding_hash,
    capturedAt: report.browser.capturedAt,
    targetUrl: report.targetUrl,
    screenshots: boundScreenshots,
    screenshotManifestDigest: hashSiteForgeContent(screenshots),
  }
}
