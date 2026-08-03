import { pathToFileURL } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

type ServiceClient = SupabaseClient<Database>

const SHA256 = /^[a-f0-9]{64}$/

export function classifySiteForgeArtifactRepair(input: {
  blueprint: unknown
  assetManifestHash: string | null
  baseThemePackageSha256: string | null
}) {
  const canonicalHash = hashSiteForgeContent(input.blueprint)
  const deployable =
    SHA256.test(input.assetManifestHash || '') &&
    SHA256.test(input.baseThemePackageSha256 || '')
  return {
    canonicalHash,
    classification: deployable ? 'deployable' as const : 'quarantined' as const,
    reasonCodes: deployable ? [] : ['incomplete_release_identity'],
  }
}

export interface ArtifactHashRepairSummary {
  audited: number
  repaired: number
  quarantined: number
  projectionsUpdated: number
}

function repairMetadata(
  originalHash: string | null,
  canonicalHash: string,
  projectionsUpdated: number
): Json {
  return {
    repairVersion: 'siteforge-artifact-sha256-v1',
    originalHash,
    canonicalHash,
    projectionsUpdated,
  }
}

export async function backfillSiteForgeArtifactHashes(
  client: ServiceClient = createServiceClient()
): Promise<ArtifactHashRepairSummary> {
  const { data: audits, error } = await client
    .from('siteforge_rollout_audits')
    .select('id, artifact_id, website_id, original_content_hash')
    .eq('classification', 'repairable')
    .order('audited_at', { ascending: true })

  if (error) throw new Error(`Failed to load repairable SiteForge artifacts: ${error.message}`)

  const summary: ArtifactHashRepairSummary = {
    audited: audits?.length || 0,
    repaired: 0,
    quarantined: 0,
    projectionsUpdated: 0,
  }

  for (const audit of audits || []) {
    if (!audit.artifact_id) {
      await client
        .from('siteforge_rollout_audits')
        .update({
          classification: 'quarantined',
          reason_codes: ['missing_artifact_identity'],
        })
        .eq('id', audit.id)
        .eq('classification', 'repairable')
      summary.quarantined += 1
      continue
    }

    const { data: artifact, error: artifactError } = await client
      .from('siteforge_blueprint_versions')
      .select('id, website_id, blueprint, content_hash, asset_manifest_hash, base_theme_package_sha256')
      .eq('id', audit.artifact_id)
      .eq('website_id', audit.website_id)
      .single()
    if (artifactError || !artifact) {
      await client
        .from('siteforge_rollout_audits')
        .update({
          classification: 'quarantined',
          reason_codes: ['artifact_not_found'],
        })
        .eq('id', audit.id)
        .eq('classification', 'repairable')
      summary.quarantined += 1
      continue
    }

    const repair = classifySiteForgeArtifactRepair({
      blueprint: artifact.blueprint,
      assetManifestHash: artifact.asset_manifest_hash,
      baseThemePackageSha256: artifact.base_theme_package_sha256,
    })
    const canonicalHash = repair.canonicalHash
    const originalHash = artifact.content_hash

    const { data: repairedArtifact, error: repairError } = await client
      .from('siteforge_blueprint_versions')
      .update({ content_hash: canonicalHash })
      .eq('id', artifact.id)
      .eq('content_hash', originalHash)
      .select('id')
      .maybeSingle()
    if (repairError) {
      throw new Error(`Failed to repair SiteForge artifact ${artifact.id}: ${repairError.message}`)
    }

    // A concurrent or previous run may already have repaired the artifact. Only
    // project the new hash when the row now contains the expected canonical value.
    if (!repairedArtifact) {
      const { data: current } = await client
        .from('siteforge_blueprint_versions')
        .select('content_hash')
        .eq('id', artifact.id)
        .single()
      if (current?.content_hash !== canonicalHash) {
        throw new Error(`SiteForge artifact ${artifact.id} changed during hash repair`)
      }
    }

    let projectionsUpdated = 0
    const guardedProjections = [
      ['canonical_preview_artifact_id', 'canonical_preview_artifact_id', 'canonical_preview_content_hash'],
      ['staging_artifact_id', 'staging_artifact_id', 'staging_content_hash'],
      ['deployed_artifact_version_id', 'deployed_artifact_version_id', 'deployed_content_hash'],
      ['production_artifact_id', 'production_artifact_id', 'production_content_hash'],
    ] as const
    for (const [ownerColumn, artifactColumn, hashColumn] of guardedProjections) {
      const { data: updated, error: projectionError } = await client
        .from('property_websites')
        .update({ [hashColumn]: canonicalHash })
        .eq('id', artifact.website_id)
        .eq(ownerColumn, artifact.id)
        .eq(artifactColumn, artifact.id)
        .eq(hashColumn, originalHash)
        .select('id')
        .maybeSingle()
      if (projectionError) {
        throw new Error(
          `Failed to repair ${hashColumn} for SiteForge artifact ${artifact.id}: ${projectionError.message}`
        )
      }
      if (updated) projectionsUpdated += 1
    }

    const now = new Date().toISOString()
    const { error: auditError } = await client
      .from('siteforge_rollout_audits')
      .update({
        canonical_content_hash: canonicalHash,
        classification: repair.classification,
        reason_codes: repair.reasonCodes,
        repair_metadata: repairMetadata(originalHash, canonicalHash, projectionsUpdated),
        repaired_at: now,
      })
      .eq('id', audit.id)
      .eq('classification', 'repairable')
    if (auditError) {
      throw new Error(`Failed to finalize SiteForge audit ${audit.id}: ${auditError.message}`)
    }

    summary.projectionsUpdated += projectionsUpdated
    if (repair.classification === 'deployable') summary.repaired += 1
    else summary.quarantined += 1
  }

  return summary
}

async function main() {
  const summary = await backfillSiteForgeArtifactHashes()
  console.info(JSON.stringify(summary, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
