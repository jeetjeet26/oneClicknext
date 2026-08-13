import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const themeDir = path.resolve(
  appDir,
  '../../../wordpress-theme/oneclick-siteforge'
)
const outputDir = path.resolve(appDir, 'runtime-assets')
export const runtimeArtifacts = [
  {
    name: 'SiteForge theme',
    filename: 'oneclick-siteforge.zip',
  },
  {
    name: 'ACF Pro plugin',
    filename: 'advanced-custom-fields-pro.zip',
  },
  {
    name: 'SiteForge runtime plugin',
    filename: 'oneclick-siteforge-runtime.zip',
  },
]
const blockNames = [
  'menu',
  'top-slides',
  'text-section',
  'feature-section',
  'image',
  'links',
  'content-grid',
  'form',
  'map',
  'html-section',
  'gallery',
  'accordion-section',
  'plans-availability',
  'poi',
  'testimonials',
]
const variantCatalog = {
  'top-slides': [
    'cinematic',
    'editorial',
    'split',
    'panoramic',
    'immersive',
    'minimal',
  ],
  'text-section': ['editorial', 'contained', 'lead'],
  'feature-section': [
    'alternating',
    'bleed',
    'framed',
    'spotlight',
    'collage',
    'compact',
  ],
  image: ['full-bleed', 'contained'],
  links: ['inline', 'banner', 'sticky'],
  'content-grid': [
    'amenity-grid',
    'tabs',
    'editorial',
    'bento',
    'icon-list',
    'carousel',
  ],
  form: ['card', 'split', 'minimal'],
  map: ['standard', 'immersive'],
  'html-section': ['contained', 'full-width'],
  gallery: [
    'categorized',
    'masonry',
    'lightbox',
    'filmstrip',
    'mosaic',
    'full-bleed',
  ],
  'accordion-section': ['bordered', 'minimal'],
  'plans-availability': ['cards', 'details', 'preleasing'],
  poi: ['narrative', 'map-list', 'editorial'],
  testimonials: ['cards', 'spotlight', 'carousel'],
  menu: ['standard', 'sticky-cta'],
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseDigest(content, filename) {
  const match = content.trim().match(/^([a-f0-9]{64})\s+\*?([^\s]+)$/i)
  if (!match || match[2] !== filename) {
    throw new Error(
      `Invalid digest file for ${filename}; expected "<sha256>  ${filename}"`
    )
  }
  return match[1].toLowerCase()
}

export async function verifyRuntimeArtifact(
  filename,
  { runtimeAssetsDir = outputDir } = {}
) {
  const archivePath = path.join(runtimeAssetsDir, filename)
  const digestPath = `${archivePath}.sha256`
  try {
    await Promise.all([access(archivePath), access(digestPath)])
  } catch {
    throw new Error(
      `Missing runtime artifact or checked digest for ${filename}; run the explicit artifact preparation command`
    )
  }
  const [archive, digestContent] = await Promise.all([
    readFile(archivePath),
    readFile(digestPath, 'utf8'),
  ])
  if (
    archive.length < 100 ||
    archive[0] !== 0x50 ||
    archive[1] !== 0x4b
  ) {
    throw new Error(`${filename} is not a valid ZIP archive`)
  }
  const expectedHash = parseDigest(digestContent, filename)
  const actualHash = sha256(archive)
  if (actualHash !== expectedHash) {
    throw new Error(
      `${filename} digest mismatch: expected ${expectedHash}, received ${actualHash}`
    )
  }
  return { archivePath, digestPath, archiveHash: actualHash }
}

export async function verifySiteForgeRuntimeArtifacts(options = {}) {
  return Promise.all(
    runtimeArtifacts.map(artifact =>
      verifyRuntimeArtifact(artifact.filename, options)
    )
  )
}

export async function validateSiteForgeDeploymentAssets({
  sourceThemeDir = themeDir,
  runtimeAssetsDir = outputDir,
} = {}) {
  let sourceValidation = null
  try {
    await access(path.join(sourceThemeDir, 'theme.json'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (sourceThemeDir === themeDir) {
    try {
      await access(path.join(sourceThemeDir, 'theme.json'))
      sourceValidation = await validateSiteForgeTheme()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const artifacts = await verifySiteForgeRuntimeArtifacts({ runtimeAssetsDir })
  return { sourceValidation, artifacts }
}

async function walkFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      entry.name === '.DS_Store' ||
      entry.name === '.gitkeep' ||
      entry.name === 'build-manifest.json'
    ) {
      continue
    }
    const relative = path.posix.join(prefix, entry.name)
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute, relative)))
    } else if (entry.isFile()) {
      files.push({ relative, absolute })
    }
  }
  return files
}

export async function validateSiteForgeTheme() {
  const errors = []
  const themeJson = JSON.parse(
    await readFile(path.join(themeDir, 'theme.json'), 'utf8')
  )
  if (themeJson.version !== 3) {
    errors.push('theme.json must use WordPress schema version 3')
  }
  if (!Array.isArray(themeJson.settings?.color?.palette)) {
    errors.push('theme.json is missing its color palette')
  }

  const functionsPhp = await readFile(path.join(themeDir, 'functions.php'), 'utf8')
  for (const required of ['acf/settings/save_json', 'acf/settings/load_json']) {
    if (!functionsPhp.includes(required)) {
      errors.push(`functions.php is missing ${required}`)
    }
  }

  const acfDirectory = path.join(themeDir, 'acf-json')
  const acfFiles = (await readdir(acfDirectory))
    .filter((filename) => filename.endsWith('.json'))
    .sort()
  if (acfFiles.length !== blockNames.length) {
    errors.push(
      `Expected ${blockNames.length} ACF schemas, found ${acfFiles.length}`
    )
  }
  const locatedBlocks = new Set()
  const acfVariants = new Map()
  for (const filename of acfFiles) {
    const group = JSON.parse(await readFile(path.join(acfDirectory, filename), 'utf8'))
    const location = group.location?.[0]?.[0]
    if (
      location?.param !== 'block' ||
      location?.operator !== '==' ||
      typeof location?.value !== 'string'
    ) {
      errors.push(`${filename} does not have one exact block location`)
      continue
    }
    if (!Array.isArray(group.fields) || group.fields.length === 0) {
      errors.push(`${filename} has no ACF fields`)
    }
    locatedBlocks.add(location.value.replace(/^acf\//, ''))
    const variantField = group.fields.find((field) => field.name === 'variant')
    acfVariants.set(
      location.value.replace(/^acf\//, ''),
      Object.keys(variantField?.choices || {})
    )
  }

  const blockUtilities = await readFile(
    path.join(themeDir, 'inc/block-utilities.php'),
    'utf8'
  )
  const blockCss = await readFile(path.join(themeDir, 'assets/css/blocks.css'), 'utf8')
  for (const block of blockNames) {
    try {
      const blockPath = path.join(themeDir, 'blocks', `${block}.php`)
      if (!(await stat(blockPath)).isFile()) {
        errors.push(`Missing render template for acf/${block}`)
      }
    } catch {
      errors.push(`Missing render template for acf/${block}`)
    }
    if (!locatedBlocks.has(block)) {
      errors.push(`Missing ACF schema for acf/${block}`)
    }
    if (!blockUtilities.includes(`'acf/${block}'`)) {
      errors.push(`Missing finite variant catalog entry for acf/${block}`)
    }
    const expectedVariants = variantCatalog[block]
    if (
      JSON.stringify(acfVariants.get(block) || []) !==
      JSON.stringify(expectedVariants)
    ) {
      errors.push(`ACF variant choices do not match the catalog for acf/${block}`)
    }
    for (const variant of expectedVariants) {
      if (!blockCss.includes(`.variant-${variant}.block-${block}`)) {
        errors.push(`Missing CSS implementation for acf/${block} variant ${variant}`)
      }
    }
  }

  const style = await readFile(path.join(themeDir, 'style.css'), 'utf8')
  const version = style.match(/^Version:\s*(.+)$/m)?.[1]?.trim()
  if (!version) {
    errors.push('style.css is missing a theme Version header')
  }

  const files = await walkFiles(themeDir)
  for (const file of files) {
    if (/\.(php|css|js|json|md|txt)$/i.test(file.relative)) {
      const content = await readFile(file.absolute, 'utf8')
      if (/http:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)/i.test(content)) {
        errors.push(`${file.relative} contains an insecure production URL`)
      }
    }
  }

  if (errors.length) {
    throw new Error(`SiteForge theme validation failed:\n- ${errors.join('\n- ')}`)
  }
  return { version, files }
}

export async function buildSiteForgeTheme({
  signingKey = process.env.SITEFORGE_THEME_SIGNING_KEY,
  gitSha = process.env.VERCEL_GIT_COMMIT_SHA,
  outputDirectory = outputDir,
} = {}) {
  if (!signingKey) {
    throw new Error('SITEFORGE_THEME_SIGNING_KEY is required to build a signed theme')
  }
  const validation = await validateSiteForgeTheme()
  const resolvedGitSha =
    gitSha ||
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(themeDir, '../..'),
      encoding: 'utf8',
    }).trim()
  const fileEntries = {}
  const fileChecksums = {}
  for (const file of validation.files) {
    const bytes = new Uint8Array(await readFile(file.absolute))
    const archivePath = `oneclick-siteforge/${file.relative}`
    fileEntries[archivePath] = [
      bytes,
      { mtime: new Date('1980-01-02T00:00:00.000Z') },
    ]
    fileChecksums[file.relative] = sha256(bytes)
  }

  const manifestCore = {
    artifactSchemaVersion: 1,
    theme: 'oneclick-siteforge',
    themeVersion: validation.version,
    requiredAcfVersion: '6.2.0',
    gitSha: resolvedGitSha,
    fileChecksums,
  }
  const canonicalManifest = JSON.stringify(manifestCore)
  const manifest = {
    ...manifestCore,
    signature: {
      algorithm: 'hmac-sha256',
      value: createHmac('sha256', signingKey)
        .update(canonicalManifest)
        .digest('hex'),
    },
  }
  fileEntries['oneclick-siteforge/build-manifest.json'] = [
    strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    { mtime: new Date('1980-01-02T00:00:00.000Z') },
  ]

  const archive = zipSync(fileEntries, { level: 9 })
  const archiveHash = sha256(archive)
  await mkdir(outputDirectory, { recursive: true })
  const archivePath = path.join(
    outputDirectory,
    'oneclick-siteforge.zip'
  )
  await writeFile(archivePath, archive)
  await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${path.basename(archivePath)}\n`)
  return { archivePath, archiveHash, manifest }
}

export async function checkSiteForgeThemeArtifact({
  signingKey = process.env.SITEFORGE_THEME_SIGNING_KEY,
  gitSha = process.env.VERCEL_GIT_COMMIT_SHA,
  outputDirectory = outputDir,
} = {}) {
  const checked = await verifyRuntimeArtifact('oneclick-siteforge.zip', {
    runtimeAssetsDir: outputDirectory,
  })
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'siteforge-theme-check-')
  )
  try {
    const rebuilt = await buildSiteForgeTheme({
      signingKey,
      gitSha,
      outputDirectory: temporaryDirectory,
    })
    if (rebuilt.archiveHash !== checked.archiveHash) {
      throw new Error(
        `SiteForge theme artifact drift detected: checked ${checked.archiveHash}, rebuilt ${rebuilt.archiveHash}; run npm run theme:build with the same signing key and Git SHA`
      )
    }
    return rebuilt
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || '--validate'
  if (command === '--validate') {
    const result = await validateSiteForgeTheme()
    console.log(
      `Validated SiteForge theme ${result.version} (${result.files.length} files).`
    )
  } else if (command === '--build') {
    const result = await buildSiteForgeTheme()
    console.log(`Built ${result.archivePath} (${result.archiveHash}).`)
  } else if (command === '--check') {
    const result = await checkSiteForgeThemeArtifact()
    console.log(
      `Verified reproducible SiteForge theme artifact (${result.archiveHash}).`
    )
  } else if (command === '--verify') {
    const results = await verifySiteForgeRuntimeArtifacts()
    console.log(
      `Verified ${results.length} SiteForge runtime artifacts and checked digests.`
    )
  } else {
    throw new Error(`Unknown command ${command}`)
  }
}
