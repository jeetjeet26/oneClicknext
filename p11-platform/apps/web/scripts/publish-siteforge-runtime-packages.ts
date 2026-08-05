import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { strFromU8, unzipSync } from 'fflate'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Database, Json } from '@/types/supabase'

loadEnvConfig(process.cwd())

type PackageInput = {
  packageType: 'runtime_plugin' | 'base_theme'
  version?: string
  filename: string
  runtimeContractVersion: number | null
}

type ServiceClient = ReturnType<typeof createServiceClient>
type RegistryPackage =
  Database['public']['Tables']['siteforge_runtime_packages']['Row']

type RuntimePackageManifest = {
  schemaVersion: 1
  packageType: 'runtime_plugin'
  packageName: 'oneclick-siteforge-runtime'
  version: string
  runtimeContractVersion: 3
  gitSha: string
  files: Array<{
    path: string
    bytes: number
    sha256: string
  }>
}

export type RuntimePackageSignatureEnvelope = {
  schemaVersion: 1
  signatureAlgorithm: 'ed25519-sha256'
  packageType: 'runtime_plugin'
  version: string
  runtimeContractVersion: 3
  filename: string
  storagePath: string
  packageSha256: string
  manifestSha256: string
  gitSha: string
}

type RegistryIdentity = {
  packageType: PackageInput['packageType']
  version: string
  packageSha256: string
  storagePath: string
  manifest: Json
  runtimeContractVersion: number | null
  manifestSha256: string | null
  signature: string | null
  signatureAlgorithm: 'ed25519-sha256' | null
  signingKeyId: string | null
  signatureEnvelope: RuntimePackageSignatureEnvelope | null
}

function sha256(bytes: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        const item = (value as Record<string, unknown>)[key]
        if (item !== undefined) normalized[key] = normalizeForCanonicalJson(item)
        return normalized
      }, {})
  }
  return value
}

export function canonicalizeRuntimePackageEnvelope(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value))
}

export function isRuntimeV3PublicationEnabled(
  value = process.env.SITEFORGE_RUNTIME_V3_ENABLED ?? 'false'
): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(
      'SITEFORGE_RUNTIME_V3_ENABLED must be exactly true or false'
    )
  }
  return normalized === 'true'
}

function parseCheckedDigest(content: string, filename: string): string {
  const match = content.trim().match(/^([a-f0-9]{64})\s+\*?([^\s]+)$/i)
  if (!match || match[2] !== filename) {
    throw new Error(
      `Invalid digest file for ${filename}; expected "<sha256>  ${filename}"`
    )
  }
  return match[1].toLowerCase()
}

async function readCheckedArchive(runtimeAssetsDir: string, filename: string) {
  const archivePath = path.join(runtimeAssetsDir, filename)
  const [archive, checkedDigest] = await Promise.all([
    readFile(archivePath),
    readFile(`${archivePath}.sha256`, 'utf8'),
  ])
  const packageSha256 = sha256(archive)
  const expectedSha256 = parseCheckedDigest(checkedDigest, filename)
  if (packageSha256 !== expectedSha256) {
    throw new Error(
      `${filename} digest mismatch: expected ${expectedSha256}, received ${packageSha256}`
    )
  }
  return { archive, packageSha256 }
}

function parseRuntimeManifest(value: unknown): RuntimePackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SiteForge runtime v3 manifest must be an object')
  }
  const manifest = value as Partial<RuntimePackageManifest>
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageType !== 'runtime_plugin' ||
    manifest.packageName !== 'oneclick-siteforge-runtime' ||
    manifest.runtimeContractVersion !== 3 ||
    typeof manifest.version !== 'string' ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      manifest.version
    ) ||
    typeof manifest.gitSha !== 'string' ||
    !/^[a-f0-9]{40,64}$/.test(manifest.gitSha) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('SiteForge runtime v3 manifest identity is invalid')
  }
  return manifest as RuntimePackageManifest
}

export async function verifyBuiltRuntimeV3Package({
  runtimeAssetsDir,
  filename = 'oneclick-siteforge-runtime.zip',
  expectedVersion,
}: {
  runtimeAssetsDir: string
  filename?: string
  expectedVersion?: string
}) {
  const { archive, packageSha256 } = await readCheckedArchive(
    runtimeAssetsDir,
    filename
  )
  const archivePath = path.join(runtimeAssetsDir, filename)
  const manifestFilename = `${filename}.manifest.json`
  const [sidecarManifest, checkedManifestDigest] = await Promise.all([
    readFile(`${archivePath}.manifest.json`),
    readFile(`${archivePath}.manifest.sha256`, 'utf8'),
  ])
  const manifestSha256 = sha256(sidecarManifest)
  const expectedManifestSha256 = parseCheckedDigest(
    checkedManifestDigest,
    manifestFilename
  )
  if (manifestSha256 !== expectedManifestSha256) {
    throw new Error(
      `Runtime manifest digest mismatch: expected ${expectedManifestSha256}, received ${manifestSha256}`
    )
  }

  const archiveEntries = unzipSync(new Uint8Array(archive))
  const internalManifestPath =
    'oneclick-siteforge-runtime/siteforge-runtime-build-manifest.json'
  const internalManifest = archiveEntries[internalManifestPath]
  if (!internalManifest) {
    throw new Error('SiteForge runtime v3 archive has no internal manifest')
  }
  if (!Buffer.from(internalManifest).equals(sidecarManifest)) {
    throw new Error('SiteForge runtime v3 internal manifest differs from sidecar')
  }

  let parsedManifest: unknown
  try {
    parsedManifest = JSON.parse(strFromU8(internalManifest))
  } catch {
    throw new Error('SiteForge runtime v3 manifest is not valid JSON')
  }
  const manifest = parseRuntimeManifest(parsedManifest)
  if (
    canonicalizeRuntimePackageEnvelope(manifest) !==
    strFromU8(internalManifest)
  ) {
    throw new Error('SiteForge runtime v3 manifest is not canonical JSON')
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Runtime package version mismatch: expected ${expectedVersion}, received ${manifest.version}`
    )
  }

  const expectedArchivePaths = new Set([internalManifestPath])
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !file.path ||
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      file.path.split('/').some(part => part === '.' || part === '..') ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error('SiteForge runtime v3 manifest contains an invalid file')
    }
    const archiveFilePath = `oneclick-siteforge-runtime/${file.path}`
    if (expectedArchivePaths.has(archiveFilePath)) {
      throw new Error(`Duplicate runtime manifest path: ${file.path}`)
    }
    const bytes = archiveEntries[archiveFilePath]
    if (
      !bytes ||
      bytes.byteLength !== file.bytes ||
      sha256(bytes) !== file.sha256
    ) {
      throw new Error(`Runtime archive file does not match manifest: ${file.path}`)
    }
    expectedArchivePaths.add(archiveFilePath)
  }
  const actualArchivePaths = Object.keys(archiveEntries).filter(
    entry => !entry.endsWith('/')
  )
  if (
    actualArchivePaths.length !== expectedArchivePaths.size ||
    actualArchivePaths.some(entry => !expectedArchivePaths.has(entry))
  ) {
    throw new Error('Runtime archive contains files outside its manifest')
  }

  return {
    archive,
    packageSha256,
    manifest,
    manifestSha256,
  }
}

export function createRuntimePackageSignatureEnvelope(input: {
  version: string
  filename: string
  storagePath: string
  packageSha256: string
  manifestSha256: string
  gitSha: string
}): RuntimePackageSignatureEnvelope {
  return {
    schemaVersion: 1,
    signatureAlgorithm: 'ed25519-sha256',
    packageType: 'runtime_plugin',
    version: input.version,
    runtimeContractVersion: 3,
    filename: input.filename,
    storagePath: input.storagePath,
    packageSha256: input.packageSha256,
    manifestSha256: input.manifestSha256,
    gitSha: input.gitSha,
  }
}

function signaturePayload(envelope: RuntimePackageSignatureEnvelope): Buffer {
  return Buffer.from(
    sha256(canonicalizeRuntimePackageEnvelope(envelope)),
    'hex'
  )
}

export function signRuntimePackageEnvelope(
  envelope: RuntimePackageSignatureEnvelope,
  privateKey: KeyObject
): string {
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('SiteForge runtime signing key must be Ed25519')
  }
  return signBytes(null, signaturePayload(envelope), privateKey).toString(
    'base64'
  )
}

export function verifyRuntimePackageEnvelopeSignature(
  envelope: RuntimePackageSignatureEnvelope,
  signature: string,
  publicKey: KeyObject
): boolean {
  if (publicKey.asymmetricKeyType !== 'ed25519') return false
  try {
    return verifyBytes(
      null,
      signaturePayload(envelope),
      publicKey,
      Buffer.from(signature, 'base64')
    )
  } catch {
    return false
  }
}

function loadSigningPrivateKey(value: string): KeyObject {
  const normalized = value.includes('BEGIN')
    ? value.replace(/\\n/g, '\n')
    : Buffer.from(value, 'base64')
  const key = value.includes('BEGIN')
    ? createPrivateKey(normalized)
    : createPrivateKey({ key: normalized, format: 'der', type: 'pkcs8' })
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('SITEFORGE_RUNTIME_SIGNING_PRIVATE_KEY must be Ed25519')
  }
  return key
}

export function assertImmutableRegistryPackage(
  row: RegistryPackage,
  expected: RegistryIdentity,
  publicKey?: KeyObject
): void {
  if (
    row.publication_status === 'revoked' ||
    row.revoked_at !== null ||
    row.revocation_reason !== null
  ) {
    throw new Error(
      `SiteForge runtime package ${row.package_sha256} is revoked and cannot be republished`
    )
  }
  const identityMatches =
    row.publication_status === 'published' &&
    row.package_type === expected.packageType &&
    row.version === expected.version &&
    row.package_sha256 === expected.packageSha256 &&
    row.storage_path === expected.storagePath &&
    canonicalizeRuntimePackageEnvelope(row.manifest) ===
      canonicalizeRuntimePackageEnvelope(expected.manifest) &&
    row.runtime_contract_version === expected.runtimeContractVersion &&
    row.manifest_sha256 === expected.manifestSha256 &&
    row.signature === expected.signature &&
    row.signature_algorithm === expected.signatureAlgorithm &&
    row.signing_key_id === expected.signingKeyId
  if (!identityMatches) {
    throw new Error(
      'SiteForge runtime package conflicts with immutable registry identity'
    )
  }
  if (
    expected.signatureEnvelope &&
    publicKey &&
    row.signature &&
    !verifyRuntimePackageEnvelopeSignature(
      expected.signatureEnvelope,
      row.signature,
      publicKey
    )
  ) {
    throw new Error('SiteForge runtime package registry signature is invalid')
  }
}

async function findExistingRegistryPackages(
  client: ServiceClient,
  expected: RegistryIdentity
) {
  const columns =
    'id, package_type, version, package_sha256, storage_path, manifest, runtime_contract_version, manifest_sha256, signature, signature_algorithm, signing_key_id, publication_status, revoked_at, revocation_reason, created_at, created_by'
  const { data: digestMatch, error: digestError } = await client
    .from('siteforge_runtime_packages')
    .select(columns)
    .eq('package_sha256', expected.packageSha256)
    .maybeSingle()
  if (digestError) throw new Error(digestError.message)

  let identityQuery = client
    .from('siteforge_runtime_packages')
    .select(columns)
    .eq('package_type', expected.packageType)
    .eq('version', expected.version)
  identityQuery =
    expected.runtimeContractVersion === null
      ? identityQuery.is('runtime_contract_version', null)
      : identityQuery.eq(
          'runtime_contract_version',
          expected.runtimeContractVersion
        )
  const { data: identityMatch, error: identityError } = await identityQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (identityError) throw new Error(identityError.message)

  return [digestMatch, identityMatch].filter(
    (row, index, rows): row is RegistryPackage =>
      Boolean(row) && rows.findIndex(candidate => candidate?.id === row?.id) === index
  )
}

export async function publishPackage(
  input: PackageInput,
  {
    client = createServiceClient(),
    runtimeAssetsDir = path.resolve(process.cwd(), 'runtime-assets'),
    signingPrivateKey = process.env.SITEFORGE_RUNTIME_SIGNING_PRIVATE_KEY,
    signingKeyId = process.env.SITEFORGE_RUNTIME_SIGNING_KEY_ID,
  }: {
    client?: ServiceClient
    runtimeAssetsDir?: string
    signingPrivateKey?: string
    signingKeyId?: string
  } = {}
) {
  const checked = await readCheckedArchive(runtimeAssetsDir, input.filename)
  const archive = checked.archive
  const packageSha256 = checked.packageSha256
  const storagePath = `runtime-packages/${input.packageType}/${packageSha256}/${input.filename}`
  let resolvedVersion = input.version
  let manifest: Json = {
    filename: input.filename,
    bytes: archive.byteLength,
  }
  let manifestSha256: string | null = null
  let signature: string | null = null
  let signatureAlgorithm: 'ed25519-sha256' | null = null
  let resolvedSigningKeyId: string | null = null
  let signatureEnvelope: RuntimePackageSignatureEnvelope | null = null
  let signingPublicKey: KeyObject | undefined

  if (input.packageType === 'runtime_plugin' && input.runtimeContractVersion === 3) {
    const verified = await verifyBuiltRuntimeV3Package({
      runtimeAssetsDir,
      filename: input.filename,
      expectedVersion: input.version,
    })
    if (verified.packageSha256 !== packageSha256) {
      throw new Error('Runtime package digest changed during verification')
    }
    resolvedVersion = verified.manifest.version
    manifest = verified.manifest as unknown as Json
    manifestSha256 = verified.manifestSha256
    if (!signingPrivateKey || !signingKeyId?.trim()) {
      throw new Error(
        'SITEFORGE_RUNTIME_SIGNING_PRIVATE_KEY and SITEFORGE_RUNTIME_SIGNING_KEY_ID are required for runtime v3 publication'
      )
    }
    const privateKey = loadSigningPrivateKey(signingPrivateKey)
    signingPublicKey = createPublicKey(privateKey)
    resolvedSigningKeyId = signingKeyId.trim()
    signatureAlgorithm = 'ed25519-sha256'
    signatureEnvelope = createRuntimePackageSignatureEnvelope({
      version: resolvedVersion,
      filename: input.filename,
      storagePath,
      packageSha256,
      manifestSha256,
      gitSha: verified.manifest.gitSha,
    })
    signature = signRuntimePackageEnvelope(signatureEnvelope, privateKey)
    if (
      !verifyRuntimePackageEnvelopeSignature(
        signatureEnvelope,
        signature,
        signingPublicKey
      )
    ) {
      throw new Error('Generated SiteForge runtime package signature is invalid')
    }
  }
  if (!resolvedVersion) {
    throw new Error(`A version is required for ${input.packageType} publication`)
  }

  const expected: RegistryIdentity = {
    packageType: input.packageType,
    version: resolvedVersion,
    packageSha256,
    storagePath,
    manifest,
    runtimeContractVersion: input.runtimeContractVersion,
    manifestSha256,
    signature,
    signatureAlgorithm,
    signingKeyId: resolvedSigningKeyId,
    signatureEnvelope,
  }
  const existingRows = await findExistingRegistryPackages(client, expected)
  for (const existing of existingRows) {
    assertImmutableRegistryPackage(existing, expected, signingPublicKey)
  }

  const { error: uploadError } = await client.storage
    .from('siteforge-artifacts')
    .upload(storagePath, archive, {
      contentType: 'application/zip',
      upsert: false,
    })
  if (
    uploadError &&
    !uploadError.message.toLowerCase().includes('already exists')
  ) {
    throw new Error(
      `Failed to upload immutable ${input.packageType}: ${uploadError.message}`
    )
  }
  const { data: stored, error: downloadError } = await client.storage
    .from('siteforge-artifacts')
    .download(storagePath)
  if (downloadError || !stored) {
    throw new Error(
      `Failed to verify stored ${input.packageType}: ${
        downloadError?.message || 'missing blob'
      }`
    )
  }
  const storedBytes = new Uint8Array(await stored.arrayBuffer())
  if (sha256(storedBytes) !== packageSha256) {
    throw new Error(`Stored ${input.packageType} package digest mismatch`)
  }

  const { data: registered, error: registrationError } = await client.rpc(
    'register_siteforge_runtime_package',
    {
      p_package_type: input.packageType,
      p_version: resolvedVersion,
      p_package_sha256: packageSha256,
      p_storage_path: storagePath,
      p_manifest: manifest,
      p_runtime_contract_version:
        input.runtimeContractVersion ?? undefined,
      p_manifest_sha256: manifestSha256 ?? undefined,
      p_signature: signature ?? undefined,
      p_signature_algorithm: signatureAlgorithm ?? undefined,
      p_signing_key_id: resolvedSigningKeyId ?? undefined,
    }
  )
  if (registrationError || !registered) {
    throw new Error(
      `Failed to register immutable ${input.packageType}: ${
        registrationError?.message || 'missing registry row'
      }`
    )
  }
  assertImmutableRegistryPackage(registered, expected, signingPublicKey)
  return {
    ...input,
    version: resolvedVersion,
    packageSha256,
    storagePath,
    manifestSha256,
    signatureAlgorithm,
    signingKeyId: resolvedSigningKeyId,
  }
}

export async function main() {
  const v3Enabled = isRuntimeV3PublicationEnabled()
  const runtimeVersion =
    process.argv[2] || (v3Enabled ? undefined : '2.0.0')
  const themeVersion = process.argv[3] || '2.2.7'
  const client = createServiceClient()
  const published = await Promise.all([
    publishPackage({
      packageType: 'runtime_plugin',
      version: runtimeVersion,
      filename: 'oneclick-siteforge-runtime.zip',
      runtimeContractVersion: v3Enabled ? 3 : 2,
    }, {
      client,
    }),
    publishPackage({
      packageType: 'base_theme',
      version: themeVersion,
      filename: 'oneclick-siteforge.zip',
      runtimeContractVersion: null,
    }, {
      client,
    }),
  ])
  console.log(JSON.stringify({ published }, null, 2))
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
