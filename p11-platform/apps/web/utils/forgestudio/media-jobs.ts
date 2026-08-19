import { createHash } from 'node:crypto'
import {
  APICallError,
  experimental_generateVideo as generateVideo,
  generateImage,
  generateText,
} from 'ai'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables } from '@/types/supabase'
import {
  STORAGE_BUCKETS,
  uploadAndSaveGeneratedAsset,
} from '@/utils/storage/asset-service'
import { getAssetUsability } from '@/utils/siteforge/assets/curation'
import {
  FORGESTUDIO_MODEL_POLICY_VERSION,
  forgeStudioGatewayOptions,
  resolveForgeStudioImageModel,
  resolveForgeStudioVideoModel,
  type ForgeStudioImageTier,
  type ForgeStudioVideoTier,
} from '@/utils/forgestudio/model-policy'

export const MEDIA_JOB_DOMAIN = 'forgestudio.media'
const LEASE_SECONDS = 600
const RETRY_BACKOFF_MS = 60_000

export type MediaAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export type MediaJobRequest =
  | {
      modality: 'image'
      prompt: string
      tier: ForgeStudioImageTier
      aspectRatio: MediaAspectRatio
      sourceAssetId?: string | null
      altText: string
      name: string
      maxCostUsd: number
    }
  | {
      modality: 'video'
      prompt: string
      tier: ForgeStudioVideoTier
      aspectRatio: Extract<MediaAspectRatio, '16:9' | '9:16'>
      sourceAssetId?: string | null
      altText: string
      name: string
      durationSeconds: 4 | 8
      generateAudio: boolean
      maxCostUsd: number
    }

type StoredMediaPayload = MediaJobRequest & {
  actorId: string
  sourceImageUrl: string | null
  model: string
  estimatedCostUsd: number
  modelPolicyVersion: string
}

export function estimateMediaCost(request: MediaJobRequest): number {
  if (request.modality === 'image') {
    return {
      iterative: 0.067,
      draft: 0.02,
      final: 0.04,
      premium: 0.06,
      challenger: 0.08,
    }[request.tier]
  }
  const perSecond = {
    preview: request.generateAudio ? 0.05 : 0.03,
    social: request.generateAudio ? 0.15 : 0.1,
    premium: request.generateAudio ? 0.4 : 0.2,
  }[request.tier]
  return perSecond * request.durationSeconds
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

function stableDedupeKey(propertyId: string, request: MediaJobRequest): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ propertyId, request }))
    .digest('hex')
  return `forgestudio-media:${digest}`
}

export async function enqueueMediaGeneration(input: {
  orgId: string
  propertyId: string
  actorId: string
  contextSnapshotId?: string | null
  request: MediaJobRequest
}): Promise<Tables<'shared_jobs'>> {
  const supabase = createServiceClient()
  let sourceImageUrl: string | null = null

  if (input.request.sourceAssetId) {
    const { data: sourceAsset, error } = await supabase
      .from('content_assets')
      .select('id, property_id, file_url, approval_status, curation_status, rights_status, expires_at, duplicate_of')
      .eq('id', input.request.sourceAssetId)
      .eq('property_id', input.propertyId)
      .single()
    if (error || !sourceAsset) throw new Error('Source asset not found')
    const usability = getAssetUsability(sourceAsset)
    if (!usability.usable || !sourceAsset.file_url.startsWith('https://')) {
      throw new Error(`Source asset cannot be used: ${usability.blockers.join(', ') || 'https_required'}`)
    }
    sourceImageUrl = sourceAsset.file_url
  }

  const estimatedCostUsd = estimateMediaCost(input.request)
  if (estimatedCostUsd > input.request.maxCostUsd) {
    throw new Error(
      `Estimated media cost $${estimatedCostUsd.toFixed(2)} exceeds the request ceiling $${input.request.maxCostUsd.toFixed(2)}`
    )
  }

  const model = input.request.modality === 'image'
    ? resolveForgeStudioImageModel(input.request.tier)
    : resolveForgeStudioVideoModel(input.request.tier)
  const payload: StoredMediaPayload = {
    ...input.request,
    actorId: input.actorId,
    sourceImageUrl,
    model,
    estimatedCostUsd,
    modelPolicyVersion: FORGESTUDIO_MODEL_POLICY_VERSION,
  }
  const dedupeKey = stableDedupeKey(input.propertyId, input.request)

  const { data: created, error } = await supabase
    .from('shared_jobs')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      domain: MEDIA_JOB_DOMAIN,
      subject_type: 'generated_content_asset',
      lifecycle_status: 'queued',
      status_reason: 'media_generation_requested',
      dedupe_key: dedupeKey,
      payload: payload as unknown as Json,
      context_snapshot_id: input.contextSnapshotId ?? null,
      max_attempts: 3,
      stage: 'queued',
      progress: 0,
      current_step: 'Queued for generation',
    })
    .select('*')
    .single()

  if (error || !created) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await supabase
        .from('shared_jobs')
        .select('*')
        .eq('domain', MEDIA_JOB_DOMAIN)
        .eq('dedupe_key', dedupeKey)
        .single()
      if (existing) return existing
    }
    throw new Error(`Failed to enqueue media generation: ${error?.message || 'unknown error'}`)
  }
  return created
}

async function updateJob(
  jobId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('shared_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw new Error(`Failed to update media job: ${error.message}`)
}

async function generateImageBytes(
  payload: StoredMediaPayload,
  propertyId: string
): Promise<{
  bytes: Uint8Array
  mediaType: string
  warnings: unknown[]
  providerMetadata: Record<string, unknown>
}> {
  const gateway = forgeStudioGatewayOptions({
    propertyId,
    actorId: payload.actorId,
    operation: 'image',
    tier: payload.tier,
  })

  if (payload.tier === 'iterative') {
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'file'; data: string; mediaType: string }
    > = [{ type: 'text', text: payload.prompt }]
    if (payload.sourceImageUrl) {
      content.push({
        type: 'file',
        data: payload.sourceImageUrl,
        mediaType: 'image/jpeg',
      })
    }
    const result = await generateText({
      model: payload.model,
      messages: [{ role: 'user', content }],
      providerOptions: { gateway },
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(180_000),
    })
    const image = result.files.find((file) => file.mediaType.startsWith('image/'))
    if (!image) throw new Error('Image model returned no image file')
    return {
      bytes: image.uint8Array,
      mediaType: image.mediaType,
      warnings: result.warnings ?? [],
      providerMetadata: (result.providerMetadata ?? {}) as Record<string, unknown>,
    }
  }

  const result = await generateImage({
    model: payload.model,
    prompt: payload.prompt,
    aspectRatio: payload.aspectRatio,
    providerOptions: { gateway },
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(180_000),
  })
  return {
    bytes: result.image.uint8Array,
    mediaType: result.image.mediaType,
    warnings: result.warnings ?? [],
    providerMetadata: (result.providerMetadata ?? {}) as Record<string, unknown>,
  }
}

async function executeMediaJob(job: Tables<'shared_jobs'>): Promise<Record<string, unknown>> {
  if (!job.property_id) throw new Error('Media job is missing property scope')
  if (job.cancel_requested) {
    await updateJob(job.id, {
      lifecycle_status: 'cancelled',
      status_reason: 'cancel_requested',
      stage: 'cancelled',
      progress: 100,
      current_step: 'Cancelled',
      finished_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    })
    return { status: 'cancelled' }
  }

  const payload = job.payload as unknown as StoredMediaPayload
  await updateJob(job.id, {
    stage: 'generating',
    progress: 20,
    current_step: `Generating ${payload.modality}`,
  })

  let bytes: Uint8Array
  let mediaType: string
  let warnings: unknown[] = []
  let providerMetadata: Record<string, unknown> = {}
  if (payload.modality === 'image') {
    const result = await generateImageBytes(payload, job.property_id)
    bytes = result.bytes
    mediaType = result.mediaType
    warnings = result.warnings
    providerMetadata = result.providerMetadata
  } else {
    const gateway = forgeStudioGatewayOptions({
      propertyId: job.property_id,
      actorId: payload.actorId,
      operation: 'video',
      tier: payload.tier,
    })
    const result = await generateVideo({
      model: payload.model,
      prompt: payload.sourceImageUrl
        ? { image: payload.sourceImageUrl, text: payload.prompt }
        : payload.prompt,
      duration: payload.durationSeconds,
      aspectRatio: payload.aspectRatio,
      generateAudio: payload.generateAudio,
      providerOptions: { gateway },
      headers: { 'idempotency-key': job.dedupe_key || job.id },
      poll: { intervalMs: 5_000, timeoutMs: 600_000 },
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(660_000),
    })
    bytes = result.videos[0].uint8Array
    mediaType = result.videos[0].mediaType
    warnings = result.warnings ?? []
    providerMetadata = (result.providerMetadata ?? {}) as Record<string, unknown>
  }

  await updateJob(job.id, {
    stage: 'storing',
    progress: 80,
    current_step: 'Storing governed asset',
  })
  const stored = await uploadAndSaveGeneratedAsset(
    Buffer.from(bytes).toString('base64'),
    mediaType,
    {
      bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
      orgId: job.org_id,
      propertyId: job.property_id,
      folder: 'forgestudio/generated',
      name: payload.name,
      description: payload.prompt,
      generationProvider: payload.model,
      generationPrompt: payload.prompt,
      generationParams: {
        modelPolicyVersion: payload.modelPolicyVersion,
        tier: payload.tier,
        aspectRatio: payload.aspectRatio,
        sourceAssetId: payload.sourceAssetId,
        estimatedCostUsd: payload.estimatedCostUsd,
        warnings,
        providerMetadata,
      },
      tags: ['ai-generated', 'forgestudio', payload.modality],
      durationSeconds: payload.modality === 'video' ? payload.durationSeconds : undefined,
      altText: payload.altText,
    }
  )
  if (!stored.success || !stored.publicUrl || !stored.asset) {
    throw new Error(stored.error || 'Generated asset storage failed')
  }

  const assetId = typeof stored.asset.id === 'string' ? stored.asset.id : null
  const output = {
    status: 'succeeded',
    assetId,
    publicUrl: stored.publicUrl,
    model: payload.model,
    modelPolicyVersion: payload.modelPolicyVersion,
    estimatedCostUsd: payload.estimatedCostUsd,
    warnings,
    providerMetadata,
    completedAt: new Date().toISOString(),
  }
  await updateJob(job.id, {
    lifecycle_status: 'succeeded',
    status_reason: 'media_generated',
    stage: 'completed',
    progress: 100,
    current_step: 'Completed',
    output: output as Json,
    finished_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    error_message: null,
  })
  return output
}

function retryable(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return true
  return !error.statusCode || error.statusCode === 408 || error.statusCode === 409 ||
    error.statusCode === 429 || error.statusCode >= 500
}

export async function processDueMediaJobs(input: {
  workerId: string
  limit?: number
}): Promise<{ claimed: number; results: Array<Record<string, unknown>> }> {
  const supabase = createServiceClient()
  const { data: jobs, error } = await supabase.rpc('claim_shared_jobs', {
    p_domain: MEDIA_JOB_DOMAIN,
    p_worker: input.workerId,
    p_limit: input.limit ?? 2,
    p_lease_seconds: LEASE_SECONDS,
  })
  if (error) throw new Error(`Failed to claim media jobs: ${error.message}`)

  const results: Array<Record<string, unknown>> = []
  for (const job of jobs ?? []) {
    try {
      results.push({ jobId: job.id, ...(await executeMediaJob(job)) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const canRetry = retryable(error) && job.attempt_count < job.max_attempts
      await updateJob(job.id, {
        lifecycle_status: canRetry ? 'retrying' : 'failed',
        status_reason: canRetry ? 'media_provider_retry' : 'media_generation_failed',
        stage: canRetry ? 'retrying' : 'failed',
        current_step: canRetry ? 'Waiting to retry' : 'Failed',
        error_message: message,
        error_details: {
          retryable: canRetry,
          modelPolicyVersion: FORGESTUDIO_MODEL_POLICY_VERSION,
        } as Json,
        available_at: canRetry
          ? new Date(Date.now() + RETRY_BACKOFF_MS).toISOString()
          : job.available_at,
        retry_at: canRetry
          ? new Date(Date.now() + RETRY_BACKOFF_MS).toISOString()
          : null,
        finished_at: canRetry ? null : new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      results.push({ jobId: job.id, status: canRetry ? 'retrying' : 'failed', error: message })
    }
  }
  return { claimed: jobs?.length ?? 0, results }
}
