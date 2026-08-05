import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = path.resolve(
  appDir,
  '../../../wordpress-plugin/oneclick-siteforge-runtime'
)
const outputDir = path.resolve(appDir, 'runtime-assets')
export const runtimePluginManifestFilename =
  'siteforge-runtime-build-manifest.json'
const fixedArchiveMtime = new Date('1980-01-02T00:00:00.000Z')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((normalized, key) => {
        if (value[key] !== undefined) {
          normalized[key] = normalizeForCanonicalJson(value[key])
        }
        return normalized
      }, {})
  }
  return value
}

export function canonicalizeRuntimePackageJson(value) {
  return JSON.stringify(normalizeForCanonicalJson(value))
}

export function isSiteForgeRuntimeV3Enabled(
  value = process.env.SITEFORGE_RUNTIME_V3_ENABLED ?? 'false'
) {
  const normalized = value.trim().toLowerCase()
  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(
      'SITEFORGE_RUNTIME_V3_ENABLED must be exactly true or false'
    )
  }
  return normalized === 'true'
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.name === '.DS_Store') continue
    const relative = path.posix.join(prefix, entry.name)
    if (relative === runtimePluginManifestFilename) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(absolute, relative)))
    else if (entry.isFile()) files.push({ relative, absolute })
  }
  return files
}

function readDefinedValue(source, constantName) {
  const match = source.match(
    new RegExp(
      `define\\(\\s*['"]${constantName}['"]\\s*,\\s*['"]([^'"]+)['"]\\s*\\)`
    )
  )
  if (!match) {
    throw new Error(`SiteForge runtime plugin is missing ${constantName}`)
  }
  return match[1]
}

function resolveGitSha(explicitGitSha, sourceDirectory) {
  const gitSha =
    explicitGitSha ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(sourceDirectory, '../..'),
      encoding: 'utf8',
    }).trim()
  if (!/^[a-f0-9]{40,64}$/i.test(gitSha)) {
    throw new Error(`Invalid Git SHA for SiteForge runtime package: ${gitSha}`)
  }
  return gitSha.toLowerCase()
}

export async function buildSiteForgeRuntimePlugin({
  sourceDirectory = pluginDir,
  outputDirectory = outputDir,
  v3Enabled = isSiteForgeRuntimeV3Enabled(),
  gitSha,
} = {}) {
  const files = await walk(sourceDirectory)
  if (
    !files.some((file) => file.relative === 'oneclick-siteforge-runtime.php')
  ) {
    throw new Error('SiteForge runtime plugin entry point is missing')
  }
  const archiveEntries = {}
  const manifestFiles = []
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file.absolute))
    archiveEntries[`oneclick-siteforge-runtime/${file.relative}`] = [
      bytes,
      { mtime: fixedArchiveMtime },
    ]
    manifestFiles.push({
      path: file.relative,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
  }

  let manifest = null
  let manifestBytes = null
  let manifestSha256 = null
  if (v3Enabled) {
    const entryPoint = await readFile(
      path.join(sourceDirectory, 'oneclick-siteforge-runtime.php'),
      'utf8'
    )
    manifest = {
      schemaVersion: 1,
      packageType: 'runtime_plugin',
      packageName: 'oneclick-siteforge-runtime',
      version: readDefinedValue(
        entryPoint,
        'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION'
      ),
      runtimeContractVersion: 3,
      gitSha: resolveGitSha(gitSha, sourceDirectory),
      files: manifestFiles,
    }
    manifestBytes = strToU8(canonicalizeRuntimePackageJson(manifest))
    manifestSha256 = sha256(manifestBytes)
    archiveEntries[
      `oneclick-siteforge-runtime/${runtimePluginManifestFilename}`
    ] = [manifestBytes, { mtime: fixedArchiveMtime }]
  }

  const archive = zipSync(archiveEntries, { level: 9 })
  const archiveHash = sha256(archive)
  await mkdir(outputDirectory, { recursive: true })
  const archivePath = path.join(
    outputDirectory,
    'oneclick-siteforge-runtime.zip'
  )
  await writeFile(archivePath, archive)
  await writeFile(
    `${archivePath}.sha256`,
    `${archiveHash}  ${path.basename(archivePath)}\n`
  )
  if (manifest && manifestBytes && manifestSha256) {
    const manifestPath = `${archivePath}.manifest.json`
    await writeFile(manifestPath, manifestBytes)
    await writeFile(
      `${archivePath}.manifest.sha256`,
      `${manifestSha256}  ${path.basename(manifestPath)}\n`
    )
  }
  return {
    archivePath,
    archiveHash,
    manifest,
    manifestSha256,
    runtimeContractVersion: v3Enabled ? 3 : 2,
    files: files.length,
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = await buildSiteForgeRuntimePlugin()
  console.log(
    `Built ${result.archivePath} (${result.archiveHash}, ${result.files} files).`
  )
}
