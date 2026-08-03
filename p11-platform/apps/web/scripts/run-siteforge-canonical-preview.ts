import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  failCanonicalWordPressPreview,
  renderCanonicalWordPressPreview,
} from '@/utils/siteforge/workflows/preview-steps'

async function main() {
  const websiteId = process.argv[2]
  if (!websiteId) {
    throw new Error('Usage: run-siteforge-canonical-preview.ts <website-id>')
  }

  const client = createServiceClient()
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select('id, org_id, property_id, current_artifact_version_id')
    .eq('id', websiteId)
    .single()
  if (websiteError || !website?.current_artifact_version_id) {
    throw new Error(
      `Current website artifact is unavailable: ${
        websiteError?.message || websiteId
      }`
    )
  }

  const [{ data: artifact, error: artifactError }, { data: target, error: targetError }] =
    await Promise.all([
      client
        .from('siteforge_blueprint_versions')
        .select('id, content_hash')
        .eq('id', website.current_artifact_version_id)
        .eq('website_id', website.id)
        .single(),
      client
        .from('siteforge_wordpress_targets')
        .select('id')
        .eq('website_id', website.id)
        .eq('target_type', 'canonical_preview')
        .eq('is_active', true)
        .single(),
    ])
  if (artifactError || !artifact) {
    throw new Error(
      `Current artifact is unavailable: ${
        artifactError?.message || website.current_artifact_version_id
      }`
    )
  }
  if (targetError || !target) {
    throw new Error(
      `Canonical preview target is unavailable: ${
        targetError?.message || website.id
      }`
    )
  }

  const now = new Date().toISOString()
  const payload = {
    websiteId: website.id,
    propertyId: website.property_id,
    orgId: website.org_id,
    artifactId: artifact.id,
    contentHash: artifact.content_hash,
    targetId: target.id,
  }
  const { data: job, error: jobError } = await client
    .from('shared_jobs')
    .insert({
      org_id: website.org_id,
      property_id: website.property_id,
      domain: 'siteforge.preview',
      subject_type: 'siteforge_artifact',
      subject_id: artifact.id,
      dedupe_key: `siteforge-preview-operator:${artifact.id}:${Date.now()}`,
      lifecycle_status: 'running',
      status_reason: 'canonical_preview_operator_claimed',
      stage: 'queued',
      progress: 0,
      current_step: 'Operator canonical WordPress preview started',
      payload: payload as Json,
      attempt_count: 1,
      max_attempts: 1,
      lease_owner: 'siteforge-canonical-preview',
      lease_expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      heartbeat_at: now,
      started_at: now,
      updated_at: now,
    })
    .select('id')
    .single()
  if (jobError || !job) {
    throw new Error(
      `Failed to create operator preview job: ${jobError?.message || 'missing job'}`
    )
  }

  const input = { sharedJobId: job.id, ...payload }
  try {
    const output = await renderCanonicalWordPressPreview(input)
    process.stdout.write(`${JSON.stringify({ jobId: job.id, ...output })}\n`)
  } catch (error) {
    const message =
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : 'Canonical WordPress preview failed'
    await failCanonicalWordPressPreview(input, message)
    throw error
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
