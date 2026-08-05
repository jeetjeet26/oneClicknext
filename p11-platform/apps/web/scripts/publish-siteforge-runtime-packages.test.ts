import {
  createHash,
  generateKeyPairSync,
  verify as verifyBytes,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Database, Json } from '@/types/supabase'
import {
  assertImmutableRegistryPackage,
  canonicalizeRuntimePackageEnvelope,
  createRuntimePackageSignatureEnvelope,
  isRuntimeV3PublicationEnabled,
  signRuntimePackageEnvelope,
  verifyRuntimePackageEnvelopeSignature,
} from './publish-siteforge-runtime-packages'

type RegistryPackage =
  Database['public']['Tables']['siteforge_runtime_packages']['Row']

function registryPackage(
  overrides: Partial<RegistryPackage> = {}
): RegistryPackage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    package_type: 'runtime_plugin',
    version: '3.0.0',
    package_sha256: 'a'.repeat(64),
    storage_path:
      `runtime-packages/runtime_plugin/${'a'.repeat(64)}/` +
      'oneclick-siteforge-runtime.zip',
    manifest: { schemaVersion: 1 } as Json,
    manifest_sha256: 'b'.repeat(64),
    runtime_contract_version: 3,
    signature: 'signature',
    signature_algorithm: 'ed25519-sha256',
    signing_key_id: 'runtime-test-key',
    publication_status: 'published',
    revoked_at: null,
    revocation_reason: null,
    created_at: '2026-08-04T00:00:00.000Z',
    created_by: null,
    ...overrides,
  }
}

describe('SiteForge runtime package publication trust', () => {
  it('requires an explicit true value to publish runtime v3', () => {
    expect(isRuntimeV3PublicationEnabled('false')).toBe(false)
    expect(isRuntimeV3PublicationEnabled('true')).toBe(true)
    expect(() => isRuntimeV3PublicationEnabled('1')).toThrow(
      /must be exactly true or false/
    )
  })

  it('rejects an Ed25519 signature after the canonical envelope is tampered', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const envelope = createRuntimePackageSignatureEnvelope({
      version: '3.0.0',
      filename: 'oneclick-siteforge-runtime.zip',
      storagePath:
        `runtime-packages/runtime_plugin/${'a'.repeat(64)}/` +
        'oneclick-siteforge-runtime.zip',
      packageSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      gitSha: '0123456789abcdef0123456789abcdef01234567',
    })
    const signature = signRuntimePackageEnvelope(envelope, privateKey)

    expect(
      verifyBytes(
        null,
        Buffer.from(
          createHash('sha256')
            .update(canonicalizeRuntimePackageEnvelope(envelope))
            .digest('hex'),
          'hex'
        ),
        publicKey,
        Buffer.from(signature, 'base64')
      )
    ).toBe(true)
    expect(
      verifyRuntimePackageEnvelopeSignature(envelope, signature, publicKey)
    ).toBe(true)
    expect(
      verifyRuntimePackageEnvelopeSignature(
        { ...envelope, packageSha256: 'c'.repeat(64) },
        signature,
        publicKey
      )
    ).toBe(false)
  })

  it('refuses to republish an otherwise matching revoked package', () => {
    const row = registryPackage({
      publication_status: 'revoked',
      revoked_at: '2026-08-04T12:00:00.000Z',
      revocation_reason: 'Compromised signing key',
    })

    expect(() =>
      assertImmutableRegistryPackage(row, {
        packageType: 'runtime_plugin',
        version: row.version,
        packageSha256: row.package_sha256,
        storagePath: row.storage_path,
        manifest: row.manifest,
        runtimeContractVersion: row.runtime_contract_version,
        manifestSha256: row.manifest_sha256,
        signature: row.signature,
        signatureAlgorithm: 'ed25519-sha256',
        signingKeyId: row.signing_key_id,
        signatureEnvelope: null,
      })
    ).toThrow(/revoked and cannot be republished/)
  })
})
