import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables } from '@/types/supabase'
import { decryptSecret } from '@/utils/forgestudio/crypto'
import {
  getAdapter,
  type AdapterConnection,
  type EngagementMetrics,
} from '@/utils/forgestudio/adapters'

type MetricName = 'engagement_rate' | 'click_through_rate' | 'video_completion_rate'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

function normalizedMetrics(metrics: EngagementMetrics) {
  return {
    impressions: metrics.impressions ?? 0,
    reach: metrics.reach ?? 0,
    clicks: metrics.clicks ?? 0,
    reactions: metrics.reactions ?? 0,
    comments: metrics.comments ?? 0,
    shares: metrics.shares ?? 0,
    saves: metrics.saves ?? 0,
    video_views: metrics.videoViews ?? 0,
    video_completions: metrics.videoCompletions ?? 0,
  }
}

export function calculatePublicationKpis(
  metrics: ReturnType<typeof normalizedMetrics>
): Record<MetricName, number | null> {
  return {
    engagement_rate: safeRate(
      metrics.reactions + metrics.comments + metrics.shares + metrics.saves,
      metrics.impressions
    ),
    click_through_rate: safeRate(metrics.clicks, metrics.impressions),
    video_completion_rate: safeRate(metrics.video_completions, metrics.video_views),
  }
}

function toAdapterConnection(
  publication: Tables<'social_publications'>,
  connection: Tables<'social_connections'>
): AdapterConnection {
  if (!connection.account_id) throw new Error('Connection account identity is missing')
  return {
    id: connection.id,
    propertyId: connection.property_id ?? publication.property_id,
    platform: connection.platform,
    accountId: connection.account_id,
    accessToken: connection.access_token ? decryptSecret(connection.access_token) : null,
    refreshToken: connection.refresh_token ? decryptSecret(connection.refresh_token) : null,
    tokenExpiresAt: connection.token_expires_at,
    pageId: connection.page_id,
    pageAccessToken: connection.page_access_token
      ? decryptSecret(connection.page_access_token)
      : null,
  }
}

async function controlBaseline(
  publication: Tables<'social_publications'>,
  kpiName: MetricName
): Promise<number | null> {
  if (!publication.experiment_key || publication.experiment_group !== 'treatment') return null
  const supabase = createServiceClient()
  const { data: controls } = await supabase
    .from('social_publications')
    .select('id')
    .eq('property_id', publication.property_id)
    .eq('experiment_key', publication.experiment_key)
    .eq('experiment_group', 'control')
    .eq('status', 'published')
  const controlIds = (controls ?? []).map((row) => row.id)
  if (controlIds.length === 0) return null
  const { data: rows } = await supabase
    .from('social_publication_metrics')
    .select('impressions, reach, clicks, reactions, comments, shares, saves, video_views, video_completions')
    .in('publication_id', controlIds)
  if (!rows?.length) return null
  const totals = rows.reduce(
    (sum, row) => ({
      impressions: sum.impressions + row.impressions,
      reach: sum.reach + row.reach,
      clicks: sum.clicks + row.clicks,
      reactions: sum.reactions + row.reactions,
      comments: sum.comments + row.comments,
      shares: sum.shares + row.shares,
      saves: sum.saves + row.saves,
      video_views: sum.video_views + row.video_views,
      video_completions: sum.video_completions + row.video_completions,
    }),
    {
      impressions: 0,
      reach: 0,
      clicks: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      video_views: 0,
      video_completions: 0,
    }
  )
  return calculatePublicationKpis(totals)[kpiName]
}

async function upsertOutcome(input: {
  publication: Tables<'social_publications'>
  kpiName: MetricName
  observedValue: number
  baselineValue: number | null
}): Promise<void> {
  const actionAttemptId = input.publication.shared_action_attempt_id
  const jobId = input.publication.shared_job_id
  if (!actionAttemptId || !jobId) return
  const supabase = createServiceClient()
  const windowStart = input.publication.published_at ?? input.publication.scheduled_for
  const windowEnd = new Date().toISOString()
  const delta = input.baselineValue == null
    ? null
    : input.observedValue - input.baselineValue
  const outcomeStatus = delta == null
    ? 'unknown'
    : delta > 0
      ? 'positive'
      : delta < 0
        ? 'negative'
        : 'neutral'
  const { data: existing } = await supabase
    .from('shared_experiment_outcomes')
    .select('id')
    .eq('action_attempt_id', actionAttemptId)
    .eq('kpi_name', input.kpiName)
    .limit(1)
    .maybeSingle()
  const payload = {
    baseline_value: input.baselineValue,
    observed_value: input.observedValue,
    delta_value: delta,
    outcome_status: outcomeStatus,
    measurement_window_start: windowStart,
    measurement_window_end: windowEnd,
    attribution_payload: {
      publicationId: input.publication.id,
      experimentKey: input.publication.experiment_key,
      experimentGroup: input.publication.experiment_group,
      source: 'social_publication_metrics',
    } as Json,
    measured_at: windowEnd,
  }
  if (existing) {
    await supabase.from('shared_experiment_outcomes').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('shared_experiment_outcomes').insert({
      ...payload,
      org_id: input.publication.org_id,
      property_id: input.publication.property_id,
      job_id: jobId,
      action_attempt_id: actionAttemptId,
      kpi_name: input.kpiName,
    })
  }
}

export async function syncPublicationMetrics(
  publication: Tables<'social_publications'>
): Promise<'synced' | 'unsupported' | 'skipped'> {
  if (publication.status !== 'published' || !publication.remote_post_id) return 'skipped'
  const adapter = getAdapter(publication.platform)
  if (!adapter?.fetchMetrics) return 'unsupported'
  const supabase = createServiceClient()
  const { data: connection, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('id', publication.connection_id)
    .single()
  if (error || !connection) throw new Error('Publication connection not found')

  const fetched = await adapter.fetchMetrics(
    toAdapterConnection(publication, connection),
    publication.remote_post_id
  )
  const normalized = normalizedMetrics(fetched)
  const observedAt = new Date().toISOString()
  const { error: metricError } = await supabase
    .from('social_publication_metrics')
    .upsert({
      publication_id: publication.id,
      org_id: publication.org_id,
      property_id: publication.property_id,
      metric_date: today(),
      ...normalized,
      provider_payload: (fetched.providerPayload ?? {}) as Json,
      observed_at: observedAt,
      updated_at: observedAt,
    }, { onConflict: 'publication_id,metric_date' })
  if (metricError) throw new Error(`Failed to persist publication metrics: ${metricError.message}`)

  for (const [kpiName, observedValue] of Object.entries(calculatePublicationKpis(normalized))) {
    if (observedValue == null) continue
    const baselineValue = await controlBaseline(publication, kpiName as MetricName)
    await upsertOutcome({
      publication,
      kpiName: kpiName as MetricName,
      observedValue,
      baselineValue,
    })
  }
  return 'synced'
}

export async function syncRecentPublicationMetrics(input: {
  propertyId?: string
  limit?: number
} = {}): Promise<{ synced: number; unsupported: number; failed: number }> {
  const supabase = createServiceClient()
  let query = supabase
    .from('social_publications')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(input.limit ?? 50)
  if (input.propertyId) query = query.eq('property_id', input.propertyId)
  const { data: publications, error } = await query
  if (error) throw new Error(`Failed to load published content: ${error.message}`)

  let synced = 0
  let unsupported = 0
  let failed = 0
  for (const publication of publications ?? []) {
    try {
      const result = await syncPublicationMetrics(publication)
      if (result === 'synced') synced++
      if (result === 'unsupported') unsupported++
    } catch (error) {
      failed++
      console.error('[forgestudio.metrics] sync failed', {
        publicationId: publication.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { synced, unsupported, failed }
}
