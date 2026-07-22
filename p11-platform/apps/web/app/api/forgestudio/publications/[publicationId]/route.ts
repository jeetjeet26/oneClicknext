import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  cancelPublication,
  ContentStoreError,
  reschedulePublication,
} from '@/utils/forgestudio/content-store'

const patchSchema = z.union([
  z.object({
    action: z.literal('reschedule'),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  z.object({
    action: z.literal('cancel'),
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
    const [publicationResult, attemptsResult] = await Promise.all([
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
    ])

    if (publicationResult.error || !publicationResult.data) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 })
    }

    return NextResponse.json({
      publication: publicationResult.data,
      attempts: attemptsResult.data ?? [],
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
      ? await cancelPublication(publicationId)
      : await reschedulePublication(publicationId, parsed.data.scheduledFor)

    return NextResponse.json({ publication })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Publication PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
