import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITEFORGE_RUNTIME_ARTIFACT_FILENAMES = [
  'advanced-custom-fields-pro.zip',
  'oneclick-siteforge-runtime.zip',
  'oneclick-siteforge.zip',
] as const

type GitRunner = (args: readonly string[]) => Buffer

export interface SiteForgeSourceIdentity {
  gitSha: string
  dirty: boolean
  dirtyDiffDigest: string
  trackedDiffDigest: string
  untrackedFiles: Array<{
    path: string
    kind: 'file' | 'symlink'
    mode: number
    bytes: number
    sha256: string
  }>
}

export interface SiteForgeBuildMetadata {
  schemaVersion: 1
  source: SiteForgeSourceIdentity
  runtimeArtifacts: Array<{
    filename: string
    sha256: string
    bytes: number
  }>
  acceptance: {
    cleanSourceRequired: true
  }
  metadataDigest: string
}

export async function collectSiteForgeSourceIdentity({
  repoRoot,
  runGit = args =>
    execFileSync('git', [...args], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    }),
}: {
  repoRoot: string
  runGit?: GitRunner
}): Promise<SiteForgeSourceIdentity> {
  const gitSha = runGit(['rev-parse', 'HEAD']).toString('utf8').trim()
  if (!/^[a-f0-9]{40,64}$/i.test(gitSha)) {
    throw new Error(`Invalid Git SHA returned for build source: ${gitSha}`)
  }

  const trackedDiff = runGit([
    '-c',
    'core.quotepath=false',
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    'HEAD',
    '--',
  ])
  const untrackedPaths = runGit([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort()

  const untrackedFiles = await Promise.all(
    untrackedPaths.map(async relativePath => {
      const absolutePath = path.join(repoRoot, relativePath)
      const stats = await lstat(absolutePath)
      const kind: 'file' | 'symlink' = stats.isSymbolicLink()
        ? 'symlink'
        : 'file'
      if (kind === 'file' && !stats.isFile()) {
        throw new Error(
          `Unsupported untracked source entry ${relativePath}; expected a file or symlink`
        )
      }
      const bytes =
        kind === 'symlink'
          ? Buffer.from(await readlink(absolutePath), 'utf8')
          : await readFile(absolutePath)
      return {
        path: relativePath,
        kind,
        mode: stats.mode & 0o777,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      }
    })
  )
  const trackedDiffDigest = sha256(trackedDiff)
  const dirtyDiffDigest = sha256(
    canonicalJson({
      trackedDiffDigest,
      untrackedFiles,
    })
  )

  return {
    gitSha: gitSha.toLowerCase(),
    dirty: trackedDiff.byteLength > 0 || untrackedFiles.length > 0,
    dirtyDiffDigest,
    trackedDiffDigest,
    untrackedFiles,
  }
}

export async function collectSiteForgeRuntimeArtifactDigests({
  runtimeAssetsDir,
  filenames = SITEFORGE_RUNTIME_ARTIFACT_FILENAMES,
}: {
  runtimeAssetsDir: string
  filenames?: readonly string[]
}): Promise<SiteForgeBuildMetadata['runtimeArtifacts']> {
  return Promise.all(
    [...filenames].sort().map(async filename => {
      const archivePath = path.join(runtimeAssetsDir, filename)
      const [archive, digestFile] = await Promise.all([
        readFile(archivePath),
        readFile(`${archivePath}.sha256`, 'utf8'),
      ])
      const expectedDigest = parseCheckedDigest(digestFile, filename)
      const actualDigest = sha256(archive)
      if (actualDigest !== expectedDigest) {
        throw new Error(
          `${filename} digest mismatch: expected ${expectedDigest}, received ${actualDigest}`
        )
      }
      return {
        filename,
        sha256: actualDigest,
        bytes: archive.byteLength,
      }
    })
  )
}

export async function createSiteForgeBuildMetadata({
  repoRoot,
  runtimeAssetsDir,
  runGit,
}: {
  repoRoot: string
  runtimeAssetsDir: string
  runGit?: GitRunner
}): Promise<SiteForgeBuildMetadata> {
  const [source, runtimeArtifacts] = await Promise.all([
    collectSiteForgeSourceIdentity({ repoRoot, runGit }),
    collectSiteForgeRuntimeArtifactDigests({ runtimeAssetsDir }),
  ])
  const metadataCore = {
    schemaVersion: 1 as const,
    source,
    runtimeArtifacts,
    acceptance: {
      cleanSourceRequired: true as const,
    },
  }

  return {
    ...metadataCore,
    metadataDigest: sha256(canonicalJson(metadataCore)),
  }
}

export async function writeSiteForgeBuildMetadata({
  outputPath,
  ...options
}: {
  outputPath: string
  repoRoot: string
  runtimeAssetsDir: string
  runGit?: GitRunner
}): Promise<SiteForgeBuildMetadata> {
  const metadata = await createSiteForgeBuildMetadata(options)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(value)
}

function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(value).digest('hex')
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const outputPath = path.resolve(
    process.argv[2] || path.join(appDir, '.next/siteforge-build-metadata.json')
  )
  const metadata = await writeSiteForgeBuildMetadata({
    outputPath,
    repoRoot: path.resolve(appDir, '../../..'),
    runtimeAssetsDir: path.join(appDir, 'runtime-assets'),
  })
  if (metadata.source.dirty) {
    console.warn(
      'Recorded dirty SiteForge source identity; release acceptance still requires clean source.'
    )
  }
  console.log(
    `Wrote ${outputPath} (${metadata.metadataDigest}, source ${metadata.source.gitSha}).`
  )
}
