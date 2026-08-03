import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'

loadEnvConfig(process.cwd())

type PackageInput = {
  packageType: 'runtime_plugin' | 'base_theme'
  version: string
  filename: string
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function publishPackage(input: PackageInput) {
  const client = createServiceClient()
  const archive = await readFile(
    path.resolve(process.cwd(), 'runtime-assets', input.filename)
  )
  const packageSha256 = sha256(archive)
  const storagePath = `runtime-packages/${input.packageType}/${packageSha256}/${input.filename}`
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
  if (uploadError) {
    const { data: stored, error: downloadError } = await client.storage
      .from('siteforge-artifacts')
      .download(storagePath)
    if (downloadError || !stored) {
      throw new Error(
        `Failed to verify existing ${input.packageType}: ${
          downloadError?.message || 'missing blob'
        }`
      )
    }
    const storedBytes = new Uint8Array(await stored.arrayBuffer())
    if (sha256(storedBytes) !== packageSha256) {
      throw new Error(`Existing ${input.packageType} package digest mismatch`)
    }
  }
  const { data: existing, error: lookupError } = await client
    .from('siteforge_runtime_packages')
    .select('id, storage_path')
    .eq('package_sha256', packageSha256)
    .maybeSingle()
  if (lookupError) throw new Error(lookupError.message)
  if (existing && existing.storage_path !== storagePath) {
    throw new Error(
      `Immutable package ${packageSha256} is already bound to another path`
    )
  }
  if (!existing) {
    const { error: insertError } = await client
      .from('siteforge_runtime_packages')
      .insert({
        package_type: input.packageType,
        version: input.version,
        package_sha256: packageSha256,
        storage_path: storagePath,
        manifest: {
          filename: input.filename,
          bytes: archive.byteLength,
        } as Json,
      })
    if (insertError) throw new Error(insertError.message)
  }
  return { ...input, packageSha256, storagePath }
}

async function main() {
  const runtimeVersion = process.argv[2] || '2.0.0'
  const themeVersion = process.argv[3] || '2.2.7'
  const published = await Promise.all([
    publishPackage({
      packageType: 'runtime_plugin',
      version: runtimeVersion,
      filename: 'oneclick-siteforge-runtime.zip',
    }),
    publishPackage({
      packageType: 'base_theme',
      version: themeVersion,
      filename: 'oneclick-siteforge.zip',
    }),
  ])
  console.log(JSON.stringify({ published }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
