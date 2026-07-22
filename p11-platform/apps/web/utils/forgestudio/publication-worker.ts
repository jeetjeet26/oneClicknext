/**
 * ForgeStudio publication worker.
 *
 * One durable execution path for every environment: hosted cron and the local
 * Node worker both call processDuePublications(), which
 *
 *   1. atomically claims due `forgestudio.publication` jobs (claim_shared_jobs
 *      with FOR UPDATE SKIP LOCKED + lease),
 *   2. reconciles ambiguous prior attempts before ever re-posting,
 *   3. refreshes expiring tokens,
 *   4. publishes via the deterministic channel adapter,
 *   5. records every attempt with idempotency key + error classification.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables } from '@/types/supabase'
import { decryptSecret, encryptSecret } from '@/utils/forgestudio/crypto'
import { getSocialAppCredentials, type SocialConfigPlatform } from '@/utils/forgestudio/social-config'
import {
  AdapterError,
  getAdapter,
  isChannelEnabled,
  normalizePlatform,
  toAdapterError,
  type AdapterConnection,
  type AdapterVariant,
  type PublishOutcome,
} from '@/utils/forgestudio/adapters'

export const PUBLICATION_JOB_DOMAIN = 'forgestudio.publication'
const LEASE_SECONDS = 300
const RETRY_BACKOFF_BASE_MS = 60_000
const TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000

export type WorkerJobResult = {
  jobId: string
  publicationId: string | null
  outcome: 'published' | 'reconciled' | 'retrying' | 'reconciling' | 'failed' | 'skipped'
  error?: string
}

export type WorkerRunResult = {
  claimed: number
  results: WorkerJobResult[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function decryptNullable(value: string | null): string | null {
  return value ? decryptSecret(value) : null
}

function credentialPlatform(platform: string): SocialConfigPlatform {
  const normalized = normalizePlatform(platform)
  if (normalized === 'instagram' || normalized === 'facebook') return 'meta'
  if (normalized === 'tiktok') return 'tiktok'
  if (normalized === 'x') return 'x'
  return 'linkedin'
}

async function heartbeat(jobId: string, workerId: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase.rpc('heartbeat_shared_job', {
    p_job_id: jobId,
    p_worker: workerId,
    p_lease_seconds: LEASE_SECONDS,
  })
}

async function finishJob(
  jobId: string,
  update: {
    lifecycle: 'succeeded' | 'failed' | 'retrying' | 'cancelled'
    reason: string
    errorMessage?: string | null
    availableAt?: string
  }
): Promise<void> {
  const supabase = createServiceClient()
  const finished = update.lifecycle === 'succeeded' || update.lifecycle === 'failed' || update.lifecycle === 'cancelled'
  await supabase
    .from('shared_jobs')
    .update({
      lifecycle_status: update.lifecycle,
      status_reason: update.reason,
      error_message: update.errorMessage ?? null,
      finished_at: finished ? nowIso() : null,
      lease_owner: null,
      lease_expires_at: null,
      ...(update.availableAt ? { available_at: update.availableAt } : {}),
      updated_at: nowIso(),
    })
    .eq('id', jobId)
}

async function loadPublicationBundle(job: Tables<'shared_jobs'>): Promise<{
  publication: Tables<'social_publications'>
  variant: Tables<'social_content_variants'>
  connection: Tables<'social_connections'>
} | null> {
  const supabase = createServiceClient()
  const payload = (job.payload ?? {}) as { revisionId?: string; connectionId?: string }

  let publicationQuery = supabase.from('social_publications').select('*')
  if (job.subject_id) {
    publicationQuery = publicationQuery.eq('id', job.subject_id)
  } else if (payload.revisionId && payload.connectionId) {
    publicationQuery = publicationQuery
      .eq('revision_id', payload.revisionId)
      .eq('connection_id', payload.connectionId)
  } else {
    return null
  }

  const { data: publication } = await publicationQuery.limit(1).maybeSingle()
  if (!publication) return null

  const [{ data: variant }, { data: connection }] = await Promise.all([
    supabase.from('social_content_variants').select('*').eq('id', publication.variant_id).single(),
    supabase.from('social_connections').select('*').eq('id', publication.connection_id).single(),
  ])
  if (!variant || !connection) return null

  return { publication, variant, connection }
}

async function refreshTokenIfNeeded(
  connectionRow: Tables<'social_connections'>,
  adapterConnection: AdapterConnection
): Promise<AdapterConnection> {
  const adapter = getAdapter(connectionRow.platform)
  if (!adapter?.refreshToken || !adapterConnection.refreshToken) return adapterConnection
  if (!connectionRow.token_expires_at || !connectionRow.property_id) return adapterConnection
  const expiresAtMs = Date.parse(connectionRow.token_expires_at)
  if (Number.isNaN(expiresAtMs) || expiresAtMs - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
    return adapterConnection
  }

  const credentials = await getSocialAppCredentials(
    connectionRow.property_id,
    credentialPlatform(connectionRow.platform)
  )
  if (!credentials) return adapterConnection

  const refreshed = await adapter.refreshToken(adapterConnection, {
    appId: credentials.appId,
    appSecret: credentials.appSecret,
  })
  if (!refreshed) return adapterConnection

  const supabase = createServiceClient()
  await supabase
    .from('social_connections')
    .update({
      access_token: encryptSecret(refreshed.accessToken),
      ...(refreshed.refreshToken ? { refresh_token: encryptSecret(refreshed.refreshToken) } : {}),
      token_expires_at: refreshed.tokenExpiresAt ?? null,
      updated_at: nowIso(),
    })
    .eq('id', connectionRow.id)

  return {
    ...adapterConnection,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? adapterConnection.refreshToken,
    tokenExpiresAt: refreshed.tokenExpiresAt ?? adapterConnection.tokenExpiresAt,
  }
}

async function recordAttempt(input: {
  publication: Tables<'social_publications'>
  attemptNumber: number
  idempotencyKey: string
}): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('social_publication_attempts')
    .insert({
      publication_id: input.publication.id,
      org_id: input.publication.org_id,
      property_id: input.publication.property_id,
      attempt_number: input.attemptNumber,
      idempotency_key: input.idempotencyKey,
      status: 'running',
      request_summary: {
        platform: input.publication.platform,
        connectionId: input.publication.connection_id,
        scheduledFor: input.publication.scheduled_for,
      } as Json,
    })
    .select('id')
    .single()
  return data?.id ?? null
}

async function closeAttempt(
  attemptId: string | null,
  update: {
    status: 'succeeded' | 'failed' | 'reconciling'
    outcome?: PublishOutcome | null
    errorMessage?: string
    classification?: 'retryable' | 'permanent' | 'ambiguous'
  }
): Promise<void> {
  if (!attemptId) return
  const supabase = createServiceClient()
  await supabase
    .from('social_publication_attempts')
    .update({
      status: update.status,
      provider_post_id: update.outcome?.providerPostId ?? null,
      provider_post_url: update.outcome?.providerPostUrl ?? null,
      error_message: update.errorMessage ?? null,
      error_classification: update.classification ?? null,
      response_summary: (update.outcome ?? {}) as Json,
      finished_at: nowIso(),
    })
    .eq('id', attemptId)
}

async function markPublished(
  publication: Tables<'social_publications'>,
  outcome: PublishOutcome
): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('social_publications')
    .update({
      status: 'published',
      remote_post_id: outcome.providerPostId,
      remote_post_url: outcome.providerPostUrl,
      published_at: nowIso(),
      last_error: null,
      error_classification: null,
      updated_at: nowIso(),
    })
    .eq('id', publication.id)

  await supabase
    .from('social_connections')
    .update({ last_used_at: nowIso(), error_count: 0, last_error: null, updated_at: nowIso() })
    .eq('id', publication.connection_id)

  // Mark the package published once every publication reached a terminal-success state.
  const { data: siblings } = await supabase
    .from('social_publications')
    .select('status')
    .eq('package_id', publication.package_id)
  const allDone = (siblings ?? []).every((row) => ['published', 'cancelled'].includes(row.status))
  if (allDone) {
    await supabase
      .from('social_content_packages')
      .update({ status: 'published', updated_at: nowIso() })
      .eq('id', publication.package_id)
  }
}

async function processJob(
  job: Tables<'shared_jobs'>,
  workerId: string
): Promise<WorkerJobResult> {
  const supabase = createServiceClient()
  const bundle = await loadPublicationBundle(job)

  if (!bundle) {
    await finishJob(job.id, {
      lifecycle: 'failed',
      reason: 'publication_missing',
      errorMessage: 'Publication, variant, or connection no longer exists',
    })
    return { jobId: job.id, publicationId: job.subject_id, outcome: 'failed', error: 'missing records' }
  }

  const { publication, variant, connection } = bundle

  // Cancelled or already-published publications are terminal.
  if (['cancelled', 'published'].includes(publication.status)) {
    await finishJob(job.id, {
      lifecycle: publication.status === 'published' ? 'succeeded' : 'cancelled',
      reason: `publication_${publication.status}`,
    })
    return { jobId: job.id, publicationId: publication.id, outcome: 'skipped' }
  }

  const adapter = getAdapter(publication.platform)
  if (!adapter || !isChannelEnabled(publication.platform)) {
    const message = `Channel ${publication.platform} is not enabled for publishing`
    await supabase
      .from('social_publications')
      .update({
        status: 'failed',
        last_error: message,
        error_classification: 'permanent',
        updated_at: nowIso(),
      })
      .eq('id', publication.id)
    await finishJob(job.id, { lifecycle: 'failed', reason: 'channel_disabled', errorMessage: message })
    return { jobId: job.id, publicationId: publication.id, outcome: 'failed', error: message }
  }

  const attemptNumber = job.attempt_count // already incremented by the claim
  const idempotencyKey = `publication:${publication.id}:attempt:${attemptNumber}`

  let adapterConnection: AdapterConnection
  try {
    adapterConnection = {
      id: connection.id,
      propertyId: connection.property_id ?? publication.property_id,
      platform: connection.platform,
      accountId: connection.account_id,
      accessToken: decryptNullable(connection.access_token),
      refreshToken: decryptNullable(connection.refresh_token),
      tokenExpiresAt: connection.token_expires_at,
      pageId: connection.page_id,
      pageAccessToken: decryptNullable(connection.page_access_token),
    }
  } catch (error) {
    const message = `Failed to decrypt connection tokens: ${error instanceof Error ? error.message : error}`
    await supabase
      .from('social_publications')
      .update({ status: 'failed', last_error: message, error_classification: 'permanent', updated_at: nowIso() })
      .eq('id', publication.id)
    await finishJob(job.id, { lifecycle: 'failed', reason: 'token_decrypt_failed', errorMessage: message })
    return { jobId: job.id, publicationId: publication.id, outcome: 'failed', error: message }
  }

  const adapterVariant: AdapterVariant = {
    caption: variant.caption,
    hashtags: variant.hashtags,
    callToAction: variant.call_to_action,
    linkUrl: variant.link_url,
    mediaUrls: variant.media_urls,
    altText: variant.alt_text,
    contentFormat: variant.content_format,
    platformOptions: (variant.platform_options ?? {}) as Record<string, unknown>,
  }

  // If the previous attempt was ambiguous, verify with the provider before
  // re-posting. Finding the post means the earlier attempt actually landed.
  if (publication.status === 'reconciling' && adapter.reconcile) {
    try {
      const existing = await adapter.reconcile(adapterConnection, adapterVariant)
      if (existing) {
        await markPublished(publication, existing)
        await finishJob(job.id, { lifecycle: 'succeeded', reason: 'reconciled_existing_post' })
        return { jobId: job.id, publicationId: publication.id, outcome: 'reconciled' }
      }
    } catch {
      // Reconciliation is best-effort; fall through to a fresh attempt.
    }
  }

  await supabase
    .from('social_publications')
    .update({ status: 'publishing', attempt_count: attemptNumber, updated_at: nowIso() })
    .eq('id', publication.id)

  const attemptId = await recordAttempt({ publication, attemptNumber, idempotencyKey })

  try {
    adapterConnection = await refreshTokenIfNeeded(connection, adapterConnection)
    await adapter.preflight(adapterConnection, adapterVariant)
    await heartbeat(job.id, workerId)

    const outcome = await adapter.publish(adapterConnection, adapterVariant, { idempotencyKey })

    await closeAttempt(attemptId, { status: 'succeeded', outcome })
    await markPublished(publication, outcome)
    await finishJob(job.id, { lifecycle: 'succeeded', reason: 'published' })
    return { jobId: job.id, publicationId: publication.id, outcome: 'published' }
  } catch (rawError) {
    const error =
      rawError instanceof AdapterError ? rawError : toAdapterError(rawError, 'before_send')
    const attemptsExhausted = attemptNumber >= job.max_attempts
    const classification = error.classification

    await supabase
      .from('social_connections')
      .update({
        error_count: (connection.error_count ?? 0) + 1,
        last_error: error.message,
        updated_at: nowIso(),
      })
      .eq('id', connection.id)

    if (classification === 'ambiguous' && !attemptsExhausted) {
      await closeAttempt(attemptId, {
        status: 'reconciling',
        errorMessage: error.message,
        classification,
      })
      await supabase
        .from('social_publications')
        .update({
          status: 'reconciling',
          last_error: error.message,
          error_classification: classification,
          updated_at: nowIso(),
        })
        .eq('id', publication.id)
      await finishJob(job.id, {
        lifecycle: 'retrying',
        reason: 'ambiguous_needs_reconcile',
        errorMessage: error.message,
        availableAt: new Date(Date.now() + RETRY_BACKOFF_BASE_MS * attemptNumber).toISOString(),
      })
      return {
        jobId: job.id,
        publicationId: publication.id,
        outcome: 'reconciling',
        error: error.message,
      }
    }

    if (classification === 'retryable' && !attemptsExhausted) {
      await closeAttempt(attemptId, {
        status: 'failed',
        errorMessage: error.message,
        classification,
      })
      await supabase
        .from('social_publications')
        .update({
          status: 'queued',
          last_error: error.message,
          error_classification: classification,
          updated_at: nowIso(),
        })
        .eq('id', publication.id)
      await finishJob(job.id, {
        lifecycle: 'retrying',
        reason: 'retryable_failure',
        errorMessage: error.message,
        availableAt: new Date(Date.now() + RETRY_BACKOFF_BASE_MS * attemptNumber).toISOString(),
      })
      return {
        jobId: job.id,
        publicationId: publication.id,
        outcome: 'retrying',
        error: error.message,
      }
    }

    // Permanent failure or attempts exhausted.
    await closeAttempt(attemptId, {
      status: 'failed',
      errorMessage: error.message,
      classification,
    })
    await supabase
      .from('social_publications')
      .update({
        status: 'failed',
        last_error: error.message,
        error_classification: classification,
        updated_at: nowIso(),
      })
      .eq('id', publication.id)
    await finishJob(job.id, {
      lifecycle: 'failed',
      reason: attemptsExhausted ? 'attempts_exhausted' : 'permanent_failure',
      errorMessage: error.message,
    })
    return { jobId: job.id, publicationId: publication.id, outcome: 'failed', error: error.message }
  }
}

/**
 * Claim and process a batch of due publication jobs. Safe to run from
 * multiple workers concurrently — claims are atomic and leased.
 */
export async function processDuePublications(options: {
  workerId: string
  limit?: number
}): Promise<WorkerRunResult> {
  const supabase = createServiceClient()
  const { data: jobs, error } = await supabase.rpc('claim_shared_jobs', {
    p_domain: PUBLICATION_JOB_DOMAIN,
    p_worker: options.workerId,
    p_limit: options.limit ?? 5,
    p_lease_seconds: LEASE_SECONDS,
  })

  if (error) {
    throw new Error(`Failed to claim publication jobs: ${error.message}`)
  }

  const results: WorkerJobResult[] = []
  for (const job of jobs ?? []) {
    try {
      results.push(await processJob(job, options.workerId))
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError)
      console.error('[forgestudio-worker] job crashed', { jobId: job.id, message })
      await finishJob(job.id, {
        lifecycle: job.attempt_count >= job.max_attempts ? 'failed' : 'retrying',
        reason: 'worker_crash',
        errorMessage: message,
        availableAt: new Date(Date.now() + RETRY_BACKOFF_BASE_MS).toISOString(),
      }).catch(() => undefined)
      results.push({ jobId: job.id, publicationId: job.subject_id, outcome: 'failed', error: message })
    }
  }

  return { claimed: (jobs ?? []).length, results }
}
