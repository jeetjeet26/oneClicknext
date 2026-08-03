import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = path.resolve(
  appDir,
  '../../../wordpress-plugin/oneclick-siteforge-runtime'
)
const outputDir = path.resolve(appDir, 'runtime-assets')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.name === '.DS_Store') continue
    const relative = path.posix.join(prefix, entry.name)
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(absolute, relative)))
    else if (entry.isFile()) files.push({ relative, absolute })
  }
  return files
}

export async function buildSiteForgeRuntimePlugin() {
  const files = await walk(pluginDir)
  if (
    !files.some((file) => file.relative === 'oneclick-siteforge-runtime.php')
  ) {
    throw new Error('SiteForge runtime plugin entry point is missing')
  }
  const archiveEntries = {}
  for (const file of files) {
    archiveEntries[`oneclick-siteforge-runtime/${file.relative}`] = [
      new Uint8Array(await readFile(file.absolute)),
      { mtime: new Date('1980-01-02T00:00:00.000Z') },
    ]
  }
  const archive = zipSync(archiveEntries, { level: 9 })
  const archiveHash = sha256(archive)
  await mkdir(outputDir, { recursive: true })
  const archivePath = path.join(outputDir, 'oneclick-siteforge-runtime.zip')
  await writeFile(archivePath, archive)
  await writeFile(
    `${archivePath}.sha256`,
    `${archiveHash}  ${path.basename(archivePath)}\n`
  )
  return { archivePath, archiveHash, files: files.length }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = await buildSiteForgeRuntimePlugin()
  console.log(
    `Built ${result.archivePath} (${result.archiveHash}, ${result.files} files).`
  )
}
