import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { brainRpc, requireCurrentScope, resolveCommunityScope } from './server'
import { createServiceClient } from '@/utils/supabase/admin'
import { uploadOriginal, readFiles, decideFile } from '@/utils/knowledge/file-store'
import type { FileDetail } from '@/utils/knowledge/file-contracts'
import { discoverAssetSourceFiles, downloadAssetSourceFile, resolveAssetSourceCredential } from '@/utils/siteforge/assets/source-adapters'
import type { Tables } from '@/types/supabase'

function identity(value: string) {
  const h = createHash('sha256').update(value).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
}

/** Complete inventory first, then bounded original intake. Unfinished work is
 * explicit and resumes from immutable file identities on the next request. */
export async function syncConnectedFiles(actorId: string, propertyId: string, sourceId: string) {
  const scope = await resolveCommunityScope(actorId, propertyId, 'ingestion'), runId = randomUUID()
  const command = (operation: string, input: Record<string, unknown> = {}) => brainRpc('brain_source_sync', {
    p_scope_id: scope.id, p_source_id: sourceId, p_run_id: runId, p_operation: operation, p_input: input,
  })
  const started = await command('begin') as { source: Tables<'siteforge_asset_sources'>; files: Array<{ provider_file_id: string; provider_revision: string; file_id: string }> }
  let imported = 0, unchanged = 0, remaining = 0
  const startedAt = Date.now()
  try {
    const source = started.source
    if (source.property_id !== propertyId || !['google_drive','dropbox'].includes(source.provider)) throw new Error('Source owner or provider changed')
    const provider = source.provider as 'google_drive' | 'dropbox'
    const credential = await resolveAssetSourceCredential({ credentialRef: source.credential_ref, provider, orgId: source.org_id, propertyId })
    const inventory = await discoverAssetSourceFiles({ provider, folderId: source.external_folder_id ?? '', accessToken: credential.accessToken, checkpoint: {}, communityFiles: true })
    await command('observe', { files: inventory.files.map(f => ({ id: f.providerFileId, revision: f.providerRevision })) })
    for (const file of inventory.files) {
      if (started.files.some(f => f.provider_file_id === file.providerFileId && f.provider_revision === file.providerRevision)) { unchanged++; continue }
      if (imported >= 25 || Date.now() - startedAt > 180_000) { remaining++; continue }
      await requireCurrentScope(scope, propertyId)
      const download = await downloadAssetSourceFile({ provider, file, accessToken: credential.accessToken, communityFiles: true })
      const hash = createHash('sha256').update(download.bytes).digest('hex')
      const fileId = identity(JSON.stringify([sourceId, file.providerFileId, file.providerRevision, hash]))
      const form = new FormData()
      form.set('file', new File([Uint8Array.from(download.bytes).buffer], file.name, { type: download.mediaType }))
      for (const [key, value] of Object.entries({ requestId: fileId, propertyId, title: file.name, reason: `Retain ${provider} revision ${file.providerRevision} for review`, materialId: '' })) form.set(key, value)
      await uploadOriginal(actorId, form)
      const saved = await readFiles(actorId, propertyId, { kind: 'file', fileId }) as unknown as FileDetail
      if (saved.file.state !== 'stored') throw new Error('The source original was not confirmed')
      await command('bind', { fileId, providerFileId: file.providerFileId, providerRevision: file.providerRevision,
        metadata: { provider, providerHash: file.providerHash, modifiedAt: file.modifiedAt, exportRecipe: file.exportRecipe ?? null, exportMime: file.exportMime ?? null, byteHash: hash } })
      if (!saved.file.latest_extraction_id) await decideFile(actorId, { requestId: identity(`connected-extract:${fileId}`), propertyId, fileId, expectedRevision: saved.file.revision, operation: 'extract', reason: 'Extract this exact connected original for review' })
      imported++
    }
    await command('finish', { imported, unchanged, remaining, error: remaining ? 'More files remain. Continue this source intake.' : null })
  } catch (error) {
    await command('fail', { imported, unchanged, remaining, error: 'Source intake needs review. Retained originals are preserved.' }).catch(() => undefined)
    throw error
  }
  const { data, error } = await createServiceClient().from('siteforge_asset_ingest_runs').select('*').eq('id', runId).eq('property_id', propertyId).single()
  if (error || !data) throw new Error('Source intake result could not be confirmed')
  await requireCurrentScope(scope, propertyId)
  return data
}
