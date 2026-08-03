import { createHash, createHmac } from 'node:crypto'
import { dirname, posix } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const OVERLAY_BUCKET = 'siteforge-artifacts'
const MAX_FILES = 20
const MAX_FILE_BYTES = 100_000
const MAX_PACKAGE_BYTES = 1_000_000
const ALLOWED_PATH =
  /^(assets\/(css|js)\/[a-z0-9][a-z0-9._/-]*|partials\/[a-z0-9][a-z0-9._/-]*\.php)$/

const themeOverlayProposalSchema = z.object({
  reason: z.string().min(1).max(2_000),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(240).regex(ALLOWED_PATH),
        content: z.string().max(MAX_FILE_BYTES),
      })
    )
    .min(1)
    .max(MAX_FILES),
})

type ThemeOverlayProposal = z.infer<typeof themeOverlayProposalSchema>

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

export function buildOverlayPackageManifest(
  proposal: ThemeOverlayProposal
): {
  functionsPhp: string
  manifest: OverlayValidationResult['manifest']
} {
  const cssFiles = proposal.files
    .filter(file => file.path.endsWith('.css'))
    .map(file => file.path)
  const jsFiles = proposal.files
    .filter(file => file.path.endsWith('.js'))
    .map(file => file.path)
  const functionsPhp = buildOverlayFunctionsPhp(cssFiles, jsFiles)
  const manifestFiles = [
    ...proposal.files,
    { path: 'functions.php', content: functionsPhp },
  ]
    .map(file => ({
      path: file.path,
      mediaType: mediaType(file.path),
      contentHash: sha256(file.content),
      bytes: Buffer.byteLength(file.content, 'utf8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    functionsPhp,
    manifest: {
      manifestVersion: 1,
      contentHash: hashSiteForgeContent(manifestFiles),
      files: manifestFiles,
    },
  }
}

export interface OverlayValidationResult {
  overlayId: string
  contentHash: string
  packageSha256: string
  signature: string
  storagePath: string
  manifest: {
    manifestVersion: 1
    contentHash: string
    files: Array<{
      path: string
      mediaType: 'text/css' | 'application/javascript' | 'text/x-php'
      contentHash: string
      bytes: number
    }>
  }
  validationReport: Json
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

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function validateStoredOverlayPackage(
  archive: Uint8Array,
  expectedManifest: OverlayValidationResult['manifest']
): string {
  const entries = unzipSync(archive)
  const descriptorEntry = entries['siteforge-overlay.json']
  if (!descriptorEntry) {
    throw new Error('Stored theme overlay package has no manifest descriptor')
  }
  const descriptor = JSON.parse(strFromU8(descriptorEntry)) as {
    manifest?: OverlayValidationResult['manifest']
  }
  if (
    !descriptor.manifest ||
    descriptor.manifest.contentHash !== expectedManifest.contentHash ||
    hashSiteForgeContent(descriptor.manifest.files) !==
      expectedManifest.contentHash
  ) {
    throw new Error('Stored theme overlay package manifest does not match')
  }
  for (const file of expectedManifest.files) {
    const entry = entries[file.path]
    if (
      !entry ||
      entry.byteLength !== file.bytes ||
      sha256(entry) !== file.contentHash
    ) {
      throw new Error(
        `Stored theme overlay package file does not match: ${file.path}`
      )
    }
  }
  return sha256(archive)
}

function mediaType(path: string) {
  if (path.endsWith('.css')) return 'text/css' as const
  if (path.endsWith('.js')) return 'application/javascript' as const
  return 'text/x-php' as const
}

function assertSafePath(path: string): void {
  if (
    !ALLOWED_PATH.test(path) ||
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
  if (proposal.files.length > MAX_FILES) throw new Error('Overlay has too many files')
  const seen = new Set<string>()
  let totalBytes = 0

  for (const file of proposal.files) {
    assertSafePath(file.path)
    if (seen.has(file.path)) throw new Error(`Overlay contains duplicate path: ${file.path}`)
    seen.add(file.path)
    const bytes = Buffer.byteLength(file.content, 'utf8')
    totalBytes += bytes
    if (bytes > MAX_FILE_BYTES) throw new Error(`Overlay file is too large: ${file.path}`)

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
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Overlay package is too large')
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
      validatedAt: new Date().toISOString(),
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
  const { functionsPhp, manifest } = buildOverlayPackageManifest(proposal)
  const contentHash = manifest.contentHash
  const zipEntries = Object.fromEntries(
    proposal.files.map(file => [file.path, strToU8(file.content)])
  )
  const overlaySlug = `oneclick-siteforge-overlay-${contentHash.slice(0, 12)}`
  zipEntries['style.css'] = strToU8(
    [
      '/*',
      `Theme Name: SiteForge Overlay ${contentHash.slice(0, 12)}`,
      'Template: oneclick-siteforge',
      `Version: 1.0.${contentHash.slice(0, 6)}`,
      `Text Domain: ${overlaySlug}`,
      '*/',
    ].join('\n')
  )
  zipEntries['functions.php'] = strToU8(functionsPhp)
  zipEntries['siteforge-overlay.json'] = strToU8(
    JSON.stringify({ manifest, reason: proposal.reason }, null, 2)
  )
  const zip = zipSync(zipEntries, { level: 9 })
  const storagePath = `overlays/${input.websiteId}/${contentHash}.zip`
  const client = options.client || createServiceClient()

  const { error: uploadError } = await client.storage
    .from(OVERLAY_BUCKET)
    .upload(storagePath, zip, {
      contentType: 'application/zip',
      upsert: false,
    })
  const alreadyExists =
    uploadError?.message.toLowerCase().includes('already exists') === true
  if (uploadError && !alreadyExists) {
    throw new Error(`Failed to store theme overlay: ${uploadError.message}`)
  }
  let packageSha256 = sha256(zip)
  if (alreadyExists) {
    const { data: storedPackage, error: storedPackageError } =
      await client.storage.from(OVERLAY_BUCKET).download(storagePath)
    if (storedPackageError || !storedPackage) {
      throw new Error(
        `Failed to verify stored theme overlay: ${
          storedPackageError?.message || storagePath
        }`
      )
    }
    packageSha256 = validateStoredOverlayPackage(
      new Uint8Array(await storedPackage.arrayBuffer()),
      manifest
    )
  }
  const signingSecret =
    options.signingSecret || process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
  if (!signingSecret) {
    throw new Error('SITEFORGE_OVERLAY_SIGNING_SECRET is required')
  }
  const signature = createHmac('sha256', signingSecret)
    .update(`${input.websiteId}:${contentHash}:${packageSha256}`)
    .digest('hex')

  const { data: overlay, error: overlayError } = await client
    .from('siteforge_theme_overlays')
    .upsert(
      {
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        content_hash: contentHash,
        manifest: manifest as unknown as Json,
        storage_path: storagePath,
        package_sha256: packageSha256,
        signature,
        validation_report: validationReport,
        screenshot_manifest: {},
        created_by: input.userId,
      },
      { onConflict: 'website_id,content_hash', ignoreDuplicates: false }
    )
    .select('id')
    .single()
  if (overlayError || !overlay) {
    throw new Error(
      `Failed to persist theme overlay: ${overlayError?.message || 'missing row'}`
    )
  }

  return {
    overlayId: overlay.id,
    contentHash,
    packageSha256,
    signature,
    storagePath,
    manifest,
    validationReport,
  }
}
