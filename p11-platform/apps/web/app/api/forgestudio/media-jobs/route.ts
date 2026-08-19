import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  enqueueMediaGeneration,
  MEDIA_JOB_DOMAIN,
} from '@/utils/forgestudio/media-jobs'

const baseSchema = z.object({
  propertyId: z.string().uuid(),
  prompt: z.string().min(10).max(4000),
  sourceAssetId: z.string().uuid().nullish(),
  altText: z.string().min(3).max(1000),
  name: z.string().min(1).max(200),
  contextSnapshotId: z.string().uuid().nullish(),
  maxCostUsd: z.number().positive().max(25),
})

const requestSchema = z.discriminatedUnion('modality', [
  baseSchema.extend({
    modality: z.literal('image'),
    tier: z.enum(['iterative', 'draft', 'final', 'premium', 'challenger']),
    aspectRatio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']),
  }),
  baseSchema.extend({
    modality: z.literal('video'),
    tier: z.enum(['preview', 'social', 'premium']),
    aspectRatio: z.enum(['16:9', '9:16']),
    durationSeconds: z.union([z.literal(4), z.literal(8)]),
    generateAudio: z.boolean().default(false),
  }),
])

export async function GET(request: NextRequest) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const propertyId = new URL(request.url).searchParams.get('propertyId')
  const parsedPropertyId = z.string().uuid().safeParse(propertyId)
  if (!parsedPropertyId.success) {
    return NextResponse.json({ error: 'Valid propertyId required' }, { status: 400 })
  }
  const access = await validatePropertyAccess(user.id, parsedPropertyId.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await createServiceClient()
    .from('shared_jobs')
    .select('id, lifecycle_status, status_reason, stage, progress, current_step, payload, output, error_message, cancel_requested, created_at, updated_at')
    .eq('property_id', parsedPropertyId.data)
    .eq('domain', MEDIA_JOB_DOMAIN)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: 'Failed to list media jobs' }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid media generation request', details: parsed.error.issues },
      { status: 400 }
    )
  }
  const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { propertyId, contextSnapshotId, ...mediaRequest } = parsed.data
    const job = await enqueueMediaGeneration({
      orgId: access.orgId,
      propertyId,
      actorId: user.id,
      contextSnapshotId,
      request: mediaRequest,
    })
    return NextResponse.json({ job }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue media generation' },
      { status: 409 }
    )
  }
}
