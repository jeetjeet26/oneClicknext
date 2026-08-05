import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const POLICY_VERSION = 'siteforge-browser-certification-v16' as const

export const certificationArtifactBindingSchema = z.object({
  artifactId: z.string().uuid(),
  contentHash: sha256Schema,
  runtimePackageSha256: sha256Schema,
  runtimeManifestSha256: sha256Schema,
  overlayPackageSha256: sha256Schema.nullable(),
  assetManifestHash: sha256Schema,
  operationSetHash: sha256Schema.nullable(),
})

export type CertificationArtifactBinding = z.infer<
  typeof certificationArtifactBindingSchema
>

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function buildCertificationBindingHash(input: {
  artifact: CertificationArtifactBinding
  targetUrl: string
  environment: 'protected_preview' | 'staging' | 'production'
  access: 'protected' | 'public'
  requireIndexable: boolean
  policyVersion?: typeof POLICY_VERSION
}): string {
  return hashSiteForgeContent({
    policyVersion: input.policyVersion ?? POLICY_VERSION,
    targetUrl: normalizedUrl(input.targetUrl),
    environment: input.environment,
    access: input.access,
    requireIndexable: input.requireIndexable,
    artifact: certificationArtifactBindingSchema.parse(input.artifact),
  })
}

export function buildReleaseCertificationBinding(input: {
  artifact: {
    id: string
    contentHash: string
    runtimeContractVersion: number
    runtimePackageSha256: string | null
    baseThemePackageSha256: string
    overlayPackageSha256: string | null
    assetManifestHash: string
    operationSetHash: string | null
  }
  runtimePackageIdentity?: { manifestSha256: string } | null
  runtimeAssets: Array<{
    path?: string
    byteHash: string
    bytes?: number
  }>
}): CertificationArtifactBinding {
  const runtimePackageSha256 =
    input.artifact.runtimePackageSha256 ??
    input.artifact.baseThemePackageSha256
  const runtimeManifestSha256 =
    input.runtimePackageIdentity?.manifestSha256 ??
    hashSiteForgeContent({
      runtimeContractVersion: input.artifact.runtimeContractVersion,
      packageSha256: runtimePackageSha256,
      assets: input.runtimeAssets
        .map(asset => ({
          path: asset.path ?? null,
          sha256: asset.byteHash,
          bytes: asset.bytes ?? null,
        }))
        .sort((left, right) =>
          `${left.path}:${left.sha256}`.localeCompare(
            `${right.path}:${right.sha256}`
          )
        ),
    })
  return certificationArtifactBindingSchema.parse({
    artifactId: input.artifact.id,
    contentHash: input.artifact.contentHash,
    runtimePackageSha256,
    runtimeManifestSha256,
    overlayPackageSha256: input.artifact.overlayPackageSha256,
    assetManifestHash: input.artifact.assetManifestHash,
    operationSetHash: input.artifact.operationSetHash,
  })
}
