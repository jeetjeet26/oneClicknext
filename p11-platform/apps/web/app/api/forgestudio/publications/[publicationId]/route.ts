import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  cancelPublication,
  ContentStoreError,
  reschedulePublication,
  retryPublication,
} from '@/utils/forgestudio/content-store'

const patchSchema = z.union([
  z.object({
    requestId:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),
    action: z.literal('reschedule'),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  z.object({
    requestId:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),
    action: z.literal('cancel'),
  }),
  z.object({
    action: z.literal('retry'),
  }),
])

async function authorizePublication(publicationId: string, userId: string) {
  const supabase = createServiceClient()
  const { data: publication, error } = await supabase
    .from('social_publications')
    .select('id, property_id')
    .eq('id', publicationId)
    .single()

  if (error || !publication) {
    return { response: NextResponse.json({ error: 'Publication not found' }, { status: 404 }) }
  }

  const access = await validatePropertyAccess(userId, publication.property_id)
  if (!access.authorized) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { publication }
}

// GET - Publication detail with attempt history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string }> }
) {
  try {
    const { publicationId } = await params
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authorized = await authorizePublication(publicationId, user.id)
    if ('response' in authorized) return authorized.response

    const supabase = createServiceClient()
    const [publicationResult, attemptsResult, metricsResult, attributionResult, receiptsResult, jobResult] = await Promise.all([
      supabase
        .from('social_publications')
        .select(`
          *,
          social_content_variants ( id, platform, caption, hashtags, media_urls, content_format ),
          social_connections ( id, platform, account_name, account_username )
        `)
        .eq('id', publicationId)
        .single(),
      supabase
        .from('social_publication_attempts')
        .select('*')
        .eq('publication_id', publicationId)
        .order('attempt_number', { ascending: false }),
      supabase
        .from('social_publication_metrics')
        .select('id,metric_date,observed_at')
        .eq('publication_id', publicationId)
        .order('metric_date', { ascending: false })
        .limit(30),
      supabase
        .from('social_attribution_events')
        .select('id,event_type,occurred_at,attribution_window_days,evidence_kind,event_state')
        .eq('publication_id', publicationId)
        .order('occurred_at', { ascending: false })
        .limit(100),
      supabase.from('forgestudio_publication_receipts').select('id,kind,evidence,created_at').eq('publication_id',publicationId).order('created_at',{ascending:true}),
      supabase.from('shared_jobs').select('lifecycle_status,lease_expires_at,status_reason').eq('subject_id',publicationId).eq('domain','forgestudio.publication').maybeSingle(),
    ])

    if (publicationResult.error || !publicationResult.data) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 })
    }

    if(attemptsResult.error||metricsResult.error||attributionResult.error||receiptsResult.error||jobResult.error)return NextResponse.json({error:'Publication evidence could not be loaded. Reload before making a decision.'},{status:503})
    return NextResponse.json({
      receipts:receiptsResult.data??[],
      job:jobResult.data,
      publication: publicationResult.data,
      attempts: attemptsResult.data ?? [],
      legacyMetricRecords: metricsResult.data ?? [],
      metrics: [],
      metricsQualification: 'Use Results for reviewed measurement evidence; earlier daily records are unqualified.',
      attributionEvents: attributionResult.data ?? [],
    })
  } catch (error) {
    console.error('Publication GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Reschedule or cancel a publication
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string }> }
) {
  try {
    const { publicationId } = await params
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid publication update', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const authorized = await authorizePublication(publicationId, user.id)
    if ('response' in authorized) return authorized.response

    const publication = parsed.data.action === 'cancel'
      ? await cancelPublication(publicationId,{requestId:parsed.data.requestId,actorId:user.id,expectedUpdatedAt:parsed.data.expectedUpdatedAt})
      : parsed.data.action === 'retry'
        ? await retryPublication(publicationId)
        : await reschedulePublication(publicationId, parsed.data.scheduledFor,{requestId:parsed.data.requestId,actorId:user.id,expectedUpdatedAt:parsed.data.expectedUpdatedAt})

    return NextResponse.json({ publication })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Publication PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
