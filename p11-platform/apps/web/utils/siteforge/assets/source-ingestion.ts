import type { Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  STORAGE_BUCKETS,
} from '@/utils/storage/asset-service'
import { analyzeImageContent } from './image-analysis'
import {
  AssetProviderError,
  discoverAssetSourceFiles,
  downloadAssetSourceFile,
  resolveAssetSourceCredential,
} from './source-adapters'
import type { AssetSourceProvider } from './contracts'
import {
  buildSiteForgePhotoTrustUpdate,
  isSiteForgePhotoAsset,
} from './trust-policy'

type ServiceClient = ReturnType<typeof createServiceClient>
const MAX_INGEST_BYTES = 20 * 1024 * 1024

function extensionForMediaType(mediaType: string) {
  if (mediaType === 'image/png') return 'png'
  if (mediaType === 'image/webp') return 'webp'
  return 'jpg'
}

function hasValidImageSignature(bytes: Uint8Array, mediaType: string) {
  if (mediaType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mediaType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
  }
  return (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
}

function publicStorageUrl(
  service: ServiceClient,
  bucket: string,
  path: string
) {
  return service.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

export async function runAssetSourceIngestion(input: {
  source: Tables<'siteforge_asset_sources'>
  userId: string
  supabase?: ServiceClient
}): Promise<Tables<'siteforge_asset_ingest_runs'>> {
  const service = input.supabase || createServiceClient()
  const source = input.source
  if (source.status !== 'active') {
    throw new AssetProviderError('Asset source is not active')
  }
  if (!['google_drive', 'dropbox'].includes(source.provider)) {
    throw new AssetProviderError('Unsupported asset source provider')
  }
  const provider = source.provider as AssetSourceProvider
  const { data: run, error: runError } = await service
    .from('siteforge_asset_ingest_runs')
    .insert({
      source_id: source.id,
      org_id: source.org_id,
      property_id: source.property_id,
      website_id: source.website_id,
      status: 'running',
      started_at: new Date().toISOString(),
      source_checkpoint: source.checkpoint,
      result_manifest: {},
    })
    .select('*')
    .single()
  if (runError || !run) {
    throw new Error('Failed to start asset source ingestion')
  }

  try {
    const credential = await resolveAssetSourceCredential({
      credentialRef: source.credential_ref,
      provider,
      orgId: source.org_id,
      propertyId: source.property_id,
    })
    const discovery = await discoverAssetSourceFiles({
      provider,
      folderId: source.external_folder_id || '',
      accessToken: credential.accessToken,
      checkpoint:
        source.checkpoint && typeof source.checkpoint === 'object'
          ? (source.checkpoint as Record<string, unknown>)
          : {},
    })
    let importedCount = 0
    let duplicateCount = 0
    let rejectedCount = 0
    const imported: Array<{ assetId: string; sourceIdentity: string }> = []
    const duplicates: Array<{
      assetId: string
      sourceIdentity: string
    }> = []

    for (const file of discovery.files) {
      if (file.size !== null && file.size > MAX_INGEST_BYTES) {
        rejectedCount += 1
        continue
      }
      const download = await downloadAssetSourceFile({
        provider,
        file,
        accessToken: credential.accessToken,
      })
      if (
        download.bytes.byteLength > MAX_INGEST_BYTES ||
        !hasValidImageSignature(download.bytes, download.mediaType)
      ) {
        rejectedCount += 1
        continue
      }
      const analysis = await analyzeImageContent({
        bytes: download.bytes,
        mediaType: download.mediaType,
        filename: file.name,
      })
      const contentHash = analysis.metadata.contentHash
      const { data: duplicate, error: duplicateError } = await service
        .from('content_assets')
        .select(
          'id, asset_type, asset_role, curation_status, rights_metadata'
        )
        .eq('property_id', source.property_id)
        .eq('content_hash', contentHash)
        .is('duplicate_of', null)
        .maybeSingle()
      if (duplicateError) {
        throw new Error('Failed to check imported asset identity')
      }
      if (duplicate) {
        if (!isSiteForgePhotoAsset(duplicate)) {
          rejectedCount += 1
          continue
        }
        const trustedAt = new Date().toISOString()
        const { error: trustError } = await service
          .from('content_assets')
          .update(
            buildSiteForgePhotoTrustUpdate({
              userId: input.userId,
              trustedAt,
              sourceIdentity: file.sourceIdentity,
              contentHash,
              intake: 'provider_import',
              importSource: provider,
              currentCurationStatus: duplicate.curation_status,
              currentRightsMetadata: duplicate.rights_metadata,
              sourceId: source.id,
              providerFileId: file.providerFileId,
            })
          )
          .eq('id', duplicate.id)
          .eq('property_id', source.property_id)
        if (trustError) {
          throw new Error('Failed to trust an existing imported photo')
        }
        duplicateCount += 1
        duplicates.push({
          assetId: duplicate.id,
          sourceIdentity: file.sourceIdentity,
        })
        continue
      }

      const extension = extensionForMediaType(download.mediaType)
      // Every run owns its upload path. A concurrent insert loser may clean up
      // only this path and can never delete the winner's bytes.
      const storagePath = `${source.property_id}/siteforge/sources/${source.id}/attempts/${run.id}/${contentHash}.${extension}`
      const { error: uploadError } = await service.storage
        .from(STORAGE_BUCKETS.PROPERTY_ASSETS)
        .upload(storagePath, download.bytes, {
          contentType: download.mediaType,
          upsert: false,
        })
      if (
        uploadError &&
        !uploadError.message.toLowerCase().includes('already exists')
      ) {
        throw new Error('Failed to store imported asset bytes')
      }
      const fileUrl = publicStorageUrl(
        service,
        STORAGE_BUCKETS.PROPERTY_ASSETS,
        storagePath
      )
      const trustedAt = new Date().toISOString()
      const trust = buildSiteForgePhotoTrustUpdate({
        userId: input.userId,
        trustedAt,
        sourceIdentity: file.sourceIdentity,
        contentHash,
        intake: 'provider_import',
        importSource: provider,
        sourceId: source.id,
        providerFileId: file.providerFileId,
      })
      const { data: created, error: createError } = await service
        .from('content_assets')
        .insert({
          org_id: source.org_id,
          property_id: source.property_id,
          name: file.name.slice(0, 255),
          description: null,
          asset_type: 'image',
          asset_role: analysis.suggestedRole,
          file_url: fileUrl,
          file_size_bytes: analysis.metadata.byteLength,
          width: analysis.metadata.width,
          height: analysis.metadata.height,
          format: download.mediaType,
          storage_bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
          storage_path: storagePath,
          content_hash: contentHash,
          source_identity: file.sourceIdentity,
          source_metadata: {
            provider,
            providerFileId: file.providerFileId,
            providerHash: file.providerHash,
            modifiedAt: file.modifiedAt,
            sourceId: source.id,
            analysisMode: analysis.mode,
            observedElements: analysis.observedElements,
            qualityNotes: analysis.qualityNotes,
          },
          ...trust,
          alt_text: analysis.altText,
          focal_point: analysis.focalPoint,
          crop_suggestion: analysis.cropSuggestion,
          quality_score: analysis.qualityScore,
          usage_manifest: [],
          analyzed_at: new Date().toISOString(),
          uploaded_by: input.userId,
        })
        .select('id')
        .single()
      if (createError || !created) {
        await service.storage
          .from(STORAGE_BUCKETS.PROPERTY_ASSETS)
          .remove([storagePath])
        if (createError?.code === '23505') {
          const { data: winner, error: winnerError } = await service
            .from('content_assets')
            .select(
              'id, asset_type, asset_role, curation_status, rights_metadata'
            )
            .eq('property_id', source.property_id)
            .eq('content_hash', contentHash)
            .is('duplicate_of', null)
            .maybeSingle()
          if (winnerError || !winner) {
            throw new Error('Failed to reconcile concurrent imported asset')
          }
          if (!isSiteForgePhotoAsset(winner)) {
            rejectedCount += 1
            continue
          }
          const { error: trustWinnerError } = await service
            .from('content_assets')
            .update(
              buildSiteForgePhotoTrustUpdate({
                userId: input.userId,
                trustedAt,
                sourceIdentity: file.sourceIdentity,
                contentHash,
                intake: 'provider_import',
                importSource: provider,
                currentCurationStatus: winner.curation_status,
                currentRightsMetadata: winner.rights_metadata,
                sourceId: source.id,
                providerFileId: file.providerFileId,
              })
            )
            .eq('id', winner.id)
            .eq('property_id', source.property_id)
          if (trustWinnerError) {
            throw new Error('Failed to trust the concurrent imported photo')
          }
          duplicateCount += 1
          duplicates.push({
            assetId: winner.id,
            sourceIdentity: file.sourceIdentity,
          })
          continue
        }
        throw new Error('Failed to persist imported asset')
      }
      importedCount += 1
      imported.push({
        assetId: created.id,
        sourceIdentity: file.sourceIdentity,
      })
    }

    const completedAt = new Date().toISOString()
    const resultManifest = {
      provider,
      imported,
      duplicates,
      checkpointAdvanced: true,
    }
    const { data: completed, error: completeError } = await service
      .from('siteforge_asset_ingest_runs')
      .update({
        status: 'succeeded',
        completed_at: completedAt,
        discovered_count: discovery.files.length,
        imported_count: importedCount,
        duplicate_count: duplicateCount,
        rejected_count: rejectedCount,
        source_checkpoint: discovery.checkpoint,
        result_manifest: resultManifest,
        error_message: null,
      })
      .eq('id', run.id)
      .eq('source_id', source.id)
      .select('*')
      .single()
    if (completeError || !completed) {
      throw new Error('Failed to complete asset source ingestion')
    }
    const { error: sourceUpdateError } = await service
      .from('siteforge_asset_sources')
      .update({
        checkpoint: discovery.checkpoint,
        status: 'active',
        last_synced_at: completedAt,
        last_error: null,
      })
      .eq('id', source.id)
      .eq('org_id', source.org_id)
      .eq('property_id', source.property_id)
    if (sourceUpdateError) {
      throw new Error('Failed to advance asset source checkpoint')
    }
    return completed
  } catch (error) {
    const message =
      error instanceof AssetProviderError
        ? error.message
        : 'Asset source ingestion failed'
    const completedAt = new Date().toISOString()
    await Promise.all([
      service
        .from('siteforge_asset_ingest_runs')
        .update({
          status: 'failed',
          completed_at: completedAt,
          error_message: message,
          result_manifest: { checkpointAdvanced: false },
        })
        .eq('id', run.id)
        .eq('source_id', source.id),
      service
        .from('siteforge_asset_sources')
        .update({
          status: 'error',
          last_error: message,
        })
        .eq('id', source.id)
        .eq('org_id', source.org_id)
        .eq('property_id', source.property_id),
    ])
    throw new AssetProviderError(message)
  }
}
