import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { SITEFORGE_CERTIFICATION_POLICY_VERSION } from './browser-evidence'

export const NON_WAIVABLE_CHECK_PREFIXES = [
  'identity.',
  'legal.',
  'rights.',
  'accessibility.critical',
] as const

const NON_WAIVABLE_CHECK_CODES = new Set([
  'artifact_manifest_identity',
  'rendered_logo_identity',
  'rendered_favicon_identity',
  'rendered_legal_version',
  'rendered_image_provenance',
  'consent.script_blocking',
])

export const certificationWaiverRequestSchema = z
  .object({
    propertyId: z.string().uuid(),
    websiteId: z.string().uuid(),
    artifactId: z.string().uuid(),
    checkCode: z.string().trim().min(3).max(200),
    rationale: z.string().trim().min(20).max(2_000),
    expiresAt: z.string().datetime(),
    evidence: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type CertificationWaiverRequest = z.infer<
  typeof certificationWaiverRequestSchema
>

export interface ImmutableCertificationWaiver {
  readonly org_id: string
  readonly property_id: string
  readonly website_id: string
  readonly artifact_id: string
  readonly check_code: string
  readonly policy_version: typeof SITEFORGE_CERTIFICATION_POLICY_VERSION
  readonly rationale: string
  readonly evidence: Json
  readonly approved_by: string
  readonly expires_at: string
}

export class CertificationWaiverError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'CertificationWaiverError'
  }
}

export function isWaivableCertificationCheck(checkCode: string): boolean {
  const normalized = checkCode.trim().toLowerCase().replace(/^browser:/, '')
  return (
    !NON_WAIVABLE_CHECK_CODES.has(normalized) &&
    !NON_WAIVABLE_CHECK_PREFIXES.some(prefix => normalized.startsWith(prefix))
  )
}

function canonicalFingerprint(input: {
  orgId: string
  approvedBy: string
  request: CertificationWaiverRequest
}): string {
  const canonical = JSON.stringify({
    approvedBy: input.approvedBy,
    artifactId: input.request.artifactId,
    checkCode: input.request.checkCode,
    expiresAt: input.request.expiresAt,
    orgId: input.orgId,
    policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    propertyId: input.request.propertyId,
    rationale: input.request.rationale,
    websiteId: input.request.websiteId,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function buildImmutableCertificationWaiver(input: {
  orgId: string
  approvedBy: string
  request: CertificationWaiverRequest
  now?: Date
}): Readonly<ImmutableCertificationWaiver> {
  if (!isWaivableCertificationCheck(input.request.checkCode)) {
    throw new CertificationWaiverError(
      'Identity, legal, rights, and critical accessibility checks cannot be waived',
      422
    )
  }
  const now = input.now ?? new Date()
  const expiresAt = new Date(input.request.expiresAt)
  if (expiresAt.getTime() <= now.getTime()) {
    throw new CertificationWaiverError('Waiver expiry must be in the future', 400)
  }
  if (expiresAt.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1_000) {
    throw new CertificationWaiverError(
      'Certification waivers may not exceed 30 days',
      400
    )
  }
  const fingerprint = canonicalFingerprint(input)
  const evidence = Object.freeze({
    ...input.request.evidence,
    waiverFingerprint: fingerprint,
    immutable: true,
  }) as Json
  return Object.freeze({
    org_id: input.orgId,
    property_id: input.request.propertyId,
    website_id: input.request.websiteId,
    artifact_id: input.request.artifactId,
    check_code: input.request.checkCode,
    policy_version: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    rationale: input.request.rationale,
    evidence,
    approved_by: input.approvedBy,
    expires_at: expiresAt.toISOString(),
  })
}

export function waiverIsActive(
  waiver: { expires_at: string; revoked_at: string | null },
  at: Date = new Date()
): boolean {
  return waiver.revoked_at === null && new Date(waiver.expires_at).getTime() > at.getTime()
}
