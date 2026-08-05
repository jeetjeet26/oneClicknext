import { dirname, posix } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { strToU8, zipSync } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  computeOverlayContentHash,
  computeOverlaySignature,
  inspectStoredOverlayPackage,
  MAX_OVERLAY_FILE_BYTES,
  MAX_OVERLAY_FILES,
  MAX_OVERLAY_PACKAGE_BYTES,
  overlayManifestSchema,
  sha256OverlayValue,
  SITEFORGE_OVERLAY_ALLOWED_PATH,
  SITEFORGE_OVERLAY_BUCKET,
  themeOverlayProposalSchema,
  type OverlayManifest,
  type ThemeOverlayProposal,
} from '@/utils/siteforge/editor/overlay-contract'

const FORBIDDEN_PHP = [
  /\b(eval|assert)\s*\(/i,
  /\b(exec|system|shell_exec|passthru|proc_open|popen|pcntl_exec)\s*\(/i,
  /\b(curl_exec|fsockopen|stream_socket_client)\s*\(/i,
  /\b(include|include_once|require|require_once)\s*\(\s*['"]https?:/i,
  /\bfile_get_contents\s*\(\s*['"]https?:/i,
  /`[^`]+`/,
]
const FORBIDDEN_JS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bFunction\s*\(/,
  /\b(fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/,
  /\b(import|require)\s*\(/,
  /\b(process|globalThis)\s*\.\s*(env|mainModule)/,
]

export function buildOverlayFunctionsPhp(
  cssFiles: string[],
  jsFiles: string[]
): string {
  return `<?php
defined( 'ABSPATH' ) || exit;
add_action( 'wp_enqueue_scripts', function () {
${cssFiles
  .map(
    (file, index) =>
      `\twp_enqueue_style( 'siteforge-overlay-${index}', get_stylesheet_directory_uri() . '/${file}', array( 'oneclick-siteforge-style' ), null );`
  )
  .join('\n')}
${jsFiles
  .map(
    (file, index) =>
      `\twp_enqueue_script( 'siteforge-overlay-${index}', get_stylesheet_directory_uri() . '/${file}', array(), null, true );`
  )
  .join('\n')}
}, 20 );
`
}

function buildOverlayStyleCss(sourceHash: string): string {
  return [
    '/*',
    `Theme Name: SiteForge Overlay ${sourceHash.slice(0, 12)}`,
    'Template: oneclick-siteforge',
    `Version: 1.0.${sourceHash.slice(0, 6)}`,
    `Text Domain: oneclick-siteforge-overlay-${sourceHash.slice(0, 12)}`,
    '*/',
  ].join('\n')
}

export function buildOverlayPackageManifest(
  proposal: ThemeOverlayProposal
): {
  functionsPhp: string
  styleCss: string
  manifest: OverlayManifest
} {
  const cssFiles = proposal.files
    .filter(file => file.path.endsWith('.css'))
    .map(file => file.path)
    .sort()
  const jsFiles = proposal.files
    .filter(file => file.path.endsWith('.js'))
    .map(file => file.path)
    .sort()
  const functionsPhp = buildOverlayFunctionsPhp(cssFiles, jsFiles)
  const sourceHash = hashSiteForgeContent(
    [...proposal.files]
      .map(file => ({ path: file.path, contentHash: sha256OverlayValue(file.content) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  )
  const styleCss = buildOverlayStyleCss(sourceHash)
  const manifestFiles = [
    ...proposal.files,
    { path: 'style.css', content: styleCss },
    { path: 'functions.php', content: functionsPhp },
  ]
    .map(file => ({
      path: file.path,
      mediaType: mediaType(file.path),
      contentHash: sha256OverlayValue(file.content),
      bytes: Buffer.byteLength(file.content, 'utf8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    functionsPhp,
    styleCss,
    manifest: overlayManifestSchema.parse({
      manifestVersion: 1,
      contentHash: hashSiteForgeContent(manifestFiles),
      files: manifestFiles,
    }),
  }
}

export interface OverlayValidationResult {
  overlayId: string
  contentHash: string
  packageSha256: string
  signature: string
  storagePath: string
  manifest: OverlayManifest
  validationReport: Json
  validationReportSha256: string
}

interface SandboxLike {
  cwd: string
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
    writeFile(path: string, data: string | Buffer | Uint8Array): Promise<void>
  }
  runCommand(command: string, args?: string[]): Promise<{
    exitCode: number
    stdout(): Promise<string>
    stderr(): Promise<string>
  }>
  stop(): Promise<unknown>
}

export function validateStoredOverlayPackage(
  archive: Uint8Array,
  expected: {
    contentHash: string
    manifest: OverlayManifest
    packageSha256?: string
  }
): string {
  return inspectStoredOverlayPackage(archive, expected).packageSha256
}

function mediaType(path: string) {
  if (path.endsWith('.css')) return 'text/css' as const
  if (path.endsWith('.js')) return 'application/javascript' as const
  return 'text/x-php' as const
}

function assertSafePath(path: string): void {
  if (
    !SITEFORGE_OVERLAY_ALLOWED_PATH.test(path) ||
    path.startsWith('/') ||
    path.includes('..') ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`Overlay path is not allowlisted: ${path}`)
  }
}

function assertBalancedCss(content: string, path: string): void {
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  for (const character of withoutComments) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth < 0) throw new Error(`Overlay CSS has unmatched braces: ${path}`)
  }
  if (depth !== 0) throw new Error(`Overlay CSS has unmatched braces: ${path}`)
  if (/@import\b/i.test(withoutComments) || /url\s*\(\s*['"]?https?:/i.test(withoutComments)) {
    throw new Error(`Overlay CSS cannot load remote resources: ${path}`)
  }
}

export function validateOverlayProposalStatic(
  proposalValue: ThemeOverlayProposal
): ThemeOverlayProposal {
  const proposal = themeOverlayProposalSchema.parse(proposalValue)
  if (proposal.files.length > MAX_OVERLAY_FILES)
    throw new Error('Overlay has too many files')
  const seen = new Set<string>()
  let totalBytes = 0

  for (const file of proposal.files) {
    assertSafePath(file.path)
    if (seen.has(file.path)) throw new Error(`Overlay contains duplicate path: ${file.path}`)
    seen.add(file.path)
    const bytes = Buffer.byteLength(file.content, 'utf8')
    totalBytes += bytes
    if (bytes > MAX_OVERLAY_FILE_BYTES)
      throw new Error(`Overlay file is too large: ${file.path}`)

    if (file.path.endsWith('.php')) {
      for (const pattern of FORBIDDEN_PHP) {
        if (pattern.test(file.content)) {
          throw new Error(`Overlay PHP contains forbidden behavior: ${file.path}`)
        }
      }
    } else if (file.path.endsWith('.js')) {
      for (const pattern of FORBIDDEN_JS) {
        if (pattern.test(file.content)) {
          throw new Error(`Overlay JavaScript contains forbidden behavior: ${file.path}`)
        }
      }
    } else if (file.path.endsWith('.css')) {
      assertBalancedCss(file.content, file.path)
    } else {
      throw new Error(`Overlay file type is not supported: ${file.path}`)
    }
  }
  if (totalBytes > MAX_OVERLAY_PACKAGE_BYTES)
    throw new Error('Overlay package is too large')
  return proposal
}

async function runSandboxValidation(
  proposal: ThemeOverlayProposal,
  sandboxFactory: () => Promise<SandboxLike>
): Promise<Json> {
  const sandbox = await sandboxFactory()
  const checks: Array<Record<string, Json | undefined>> = []
  try {
    const root = `${sandbox.cwd}/siteforge-overlay`
    for (const file of proposal.files) {
      const absolutePath = `${root}/${file.path}`
      await sandbox.fs.mkdir(dirname(absolutePath), { recursive: true })
      await sandbox.fs.writeFile(absolutePath, file.content)

      const command = file.path.endsWith('.php')
        ? ['php', ['-l', absolutePath]] as const
        : file.path.endsWith('.js')
          ? ['node', ['--check', absolutePath]] as const
          : null
      if (!command) {
        checks.push({ path: file.path, check: 'css-static-parse', passed: true })
        continue
      }
      const result = await sandbox.runCommand(command[0], [...command[1]])
      const stderr = (await result.stderr()).trim()
      checks.push({
        path: file.path,
        check: file.path.endsWith('.php') ? 'php-lint' : 'node-check',
        passed: result.exitCode === 0,
        stderr: stderr.slice(0, 2_000) || undefined,
      })
      if (result.exitCode !== 0) {
        throw new Error(
          `Sandbox syntax validation failed for ${file.path}: ${stderr || 'unknown error'}`
        )
      }
    }
    return {
      provider: 'vercel-sandbox',
      networkPolicy: 'deny-all',
      checks,
      passed: true,
      validator: 'siteforge-static-sandbox-v1',
    }
  } finally {
    await sandbox.stop()
  }
}

function defaultSandboxFactory(): Promise<SandboxLike> {
  return Sandbox.create({
    runtime: 'node24',
    timeout: 120_000,
    networkPolicy: { allow: [] },
    tags: { workload: 'siteforge-overlay' },
  }) as Promise<SandboxLike>
}

export async function validateAndStoreThemeOverlay(
  input: {
    orgId: string
    propertyId: string
    websiteId: string
    userId: string
    proposal: ThemeOverlayProposal
  },
  options: {
    client?: SupabaseClient<Database>
    sandboxFactory?: () => Promise<SandboxLike>
    signingSecret?: string
  } = {}
): Promise<OverlayValidationResult> {
  const proposal = validateOverlayProposalStatic(input.proposal)
  const validationReport = await runSandboxValidation(
    proposal,
    options.sandboxFactory || defaultSandboxFactory
  )
  const { functionsPhp, styleCss, manifest } =
    buildOverlayPackageManifest(proposal)
  const contentHash = computeOverlayContentHash(proposal.reason, manifest)
  const zipEntries: Record<string, Uint8Array> = {}
  for (const file of [...proposal.files].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    zipEntries[file.path] = strToU8(file.content)
  }
  zipEntries['functions.php'] = strToU8(functionsPhp)
  zipEntries['style.css'] = strToU8(styleCss)
  zipEntries['siteforge-overlay.json'] = strToU8(
    JSON.stringify(
      {
        descriptorVersion: 1,
        overlayContentHash: contentHash,
        manifest,
        reason: proposal.reason,
      },
      null,
      2
    )
  )
  const zip = zipSync(zipEntries, { level: 9 })
  let packageSha256 = validateStoredOverlayPackage(zip, {
    contentHash,
    manifest,
  })
  const storagePath = `overlays/${input.websiteId}/${contentHash}.zip`
  const client = options.client || createServiceClient()

  const { error: uploadError } = await client.storage
    .from(SITEFORGE_OVERLAY_BUCKET)
    .upload(storagePath, zip, {
      contentType: 'application/zip',
      upsert: false,
    })
  const alreadyExists =
    uploadError?.message.toLowerCase().includes('already exists') === true
  if (uploadError && !alreadyExists) {
    throw new Error(`Failed to store theme overlay: ${uploadError.message}`)
  }
  if (alreadyExists) {
    const { data: storedPackage, error: storedPackageError } =
      await client.storage
        .from(SITEFORGE_OVERLAY_BUCKET)
        .download(storagePath)
    if (storedPackageError || !storedPackage) {
      throw new Error(
        `Failed to verify stored theme overlay: ${
          storedPackageError?.message || storagePath
        }`
      )
    }
    packageSha256 = validateStoredOverlayPackage(
      new Uint8Array(await storedPackage.arrayBuffer()),
      { contentHash, manifest, packageSha256 }
    )
  }
  const signingSecret =
    options.signingSecret || process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
  if (!signingSecret) {
    throw new Error('SITEFORGE_OVERLAY_SIGNING_SECRET is required')
  }
  const signature = computeOverlaySignature({
    websiteId: input.websiteId,
    contentHash,
    packageSha256,
    signingSecret,
  })
  const validationReportSha256 = hashSiteForgeContent(validationReport)
  const immutableOverlay = {
    org_id: input.orgId,
    property_id: input.propertyId,
    website_id: input.websiteId,
    content_hash: contentHash,
    manifest: manifest as unknown as Json,
    storage_path: storagePath,
    package_sha256: packageSha256,
    signature,
    validation_report: validationReport,
    created_by: input.userId,
  }
  const { data: insertedOverlay, error: insertError } = await client
    .from('siteforge_theme_overlays')
    .insert({ ...immutableOverlay, screenshot_manifest: {} })
    .select('id')
    .maybeSingle()
  let overlay = insertedOverlay
  const isIdentityConflict =
    insertError?.code === '23505' ||
    insertError?.message.toLowerCase().includes('duplicate') === true
  if (insertError && !isIdentityConflict) {
    throw new Error(
      `Failed to persist theme overlay: ${insertError.message}`
    )
  }
  if (!overlay) {
    const { data: existing, error: existingError } = await client
      .from('siteforge_theme_overlays')
      .select(
        'id, org_id, property_id, website_id, content_hash, manifest, storage_path, package_sha256, signature, validation_report, created_by'
      )
      .eq('website_id', input.websiteId)
      .eq('content_hash', contentHash)
      .single()
    if (existingError || !existing) {
      throw new Error(
        `Failed to resolve immutable theme overlay conflict: ${
          existingError?.message || 'missing row'
        }`
      )
    }
    const existingIdentity = {
      org_id: existing.org_id,
      property_id: existing.property_id,
      website_id: existing.website_id,
      content_hash: existing.content_hash,
      manifest: existing.manifest,
      storage_path: existing.storage_path,
      package_sha256: existing.package_sha256,
      signature: existing.signature,
      validation_report: existing.validation_report,
      created_by: existing.created_by,
    }
    if (
      hashSiteForgeContent(existingIdentity) !==
      hashSiteForgeContent(immutableOverlay)
    ) {
      throw new Error(
        'Immutable theme overlay identity conflict; existing overlay was not modified'
      )
    }
    overlay = { id: existing.id }
  }

  return {
    overlayId: overlay.id,
    contentHash,
    packageSha256,
    signature,
    storagePath,
    manifest,
    validationReport,
    validationReportSha256,
  }
}
