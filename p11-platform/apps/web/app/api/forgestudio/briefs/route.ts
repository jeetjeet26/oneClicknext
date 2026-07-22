import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { ContentStoreError, createBrief } from '@/utils/forgestudio/content-store'
import { SOCIAL_PLATFORMS } from '@/utils/forgestudio/content-contract'

const createBriefSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(300),
  objective: z.string().min(1).max(2000),
  topic: z.string().max(2000).nullish(),
  audience: z.string().max(2000).nullish(),
  sourceFacts: z.array(z.object({
    text: z.string().min(1).max(1000),
    source: z.string().max(300).optional(),
  })).max(50).default([]),
  constraints: z.object({
    mustInclude: z.array(z.string().max(300)).max(20).optional(),
    mustAvoid: z.array(z.string().max(300)).max(20).optional(),
    tone: z.string().max(300).optional(),
  }).default({}),
  channels: z.array(z.enum(SOCIAL_PLATFORMS)).min(1),
  connectionIds: z.array(z.string().uuid()).max(20).default([]),
  assetIds: z.array(z.string().uuid()).max(20).default([]),
  schedulingWindow: z.object({
    earliest: z.string().datetime({ offset: true }).optional(),
    latest: z.string().datetime({ offset: true }).optional(),
    timezone: z.string().max(100).optional(),
  }).default({}),
})

// GET - List briefs for a property
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('social_content_briefs')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error listing briefs:', error)
      return NextResponse.json({ error: 'Failed to list briefs' }, { status: 500 })
    }

    return NextResponse.json({ briefs: data ?? [] })
  } catch (error) {
    console.error('Briefs GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a brief
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = createBriefSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid brief', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const brief = await createBrief({
      orgId: access.orgId,
      propertyId: parsed.data.propertyId,
      createdBy: user.id,
      title: parsed.data.title,
      objective: parsed.data.objective,
      topic: parsed.data.topic,
      audience: parsed.data.audience,
      sourceFacts: parsed.data.sourceFacts,
      constraints: parsed.data.constraints,
      channels: parsed.data.channels,
      connectionIds: parsed.data.connectionIds,
      assetIds: parsed.data.assetIds,
      schedulingWindow: parsed.data.schedulingWindow,
    })

    return NextResponse.json({ brief }, { status: 201 })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Briefs POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
