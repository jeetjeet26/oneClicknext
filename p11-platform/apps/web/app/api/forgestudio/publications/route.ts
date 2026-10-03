import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { ContentStoreError, schedulePublications } from '@/utils/forgestudio/content-store'

const scheduleSchema = z.object({
  requestId:z.string().uuid(),
  contentHash:z.string().regex(/^[0-9a-f]{64}$/),
  revisionId: z.string().uuid(),
  destinations: z.array(z.object({
    connectionId: z.string().uuid(),
    variantId: z.string().uuid(),
    scheduledFor: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    experimentKey: z.string().min(1).max(200).optional(),
    experimentGroup: z.enum(['control', 'treatment']).optional(),
  })).min(1).max(20),
})

// GET - List publications for a property (calendar/operations view)
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const cursor=searchParams.get('cursor')
    let after:{at:string;id:string}|null=null
    if(cursor){try{after=z.object({at:z.string().datetime({offset:true}),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')))}catch{return NextResponse.json({error:'Invalid publication page. Reload the schedule.'},{status:400})}}
    if([from,to].some(value=>value&&!z.string().datetime({offset:true}).safeParse(value).success))return NextResponse.json({error:'Choose valid schedule dates.'},{status:400})
    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    let query = supabase
      .from('social_publications')
      .select(`
        *,
        social_content_variants ( id, variant_key, sequence_index, platform, caption, content_format, media_urls, overlay_text, storyboard, subtitle_text, thumbnail_asset_id ),
        social_connections ( id, platform, account_name, account_username )
      `)
      .eq('property_id', propertyId)
      .order('scheduled_for', { ascending: true })
      .order('id',{ascending:true})
      .limit(101)

    if(after)query=query.or(`scheduled_for.gt.${after.at},and(scheduled_for.eq.${after.at},id.gt.${after.id})`)
    if (from) query = query.gte('scheduled_for', from)
    if (to) query = query.lte('scheduled_for', to)

    const { data, error } = await query
    if (error) {
      console.error('Error listing publications:', error)
      return NextResponse.json({ error: 'Failed to list publications' }, { status: 500 })
    }

    const publications=(data??[]).slice(0,100),last=publications.at(-1)
    const nextCursor=(data??[]).length>100&&last?Buffer.from(JSON.stringify({at:last.scheduled_for,id:last.id})).toString('base64url'):null
    return NextResponse.json({publications,nextCursor})
  } catch (error) {
    console.error('Publications GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Schedule an approved revision to one or more connections
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = scheduleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid schedule request', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const { data: revision, error: revisionError } = await supabase
      .from('social_content_revisions')
      .select('id, property_id')
      .eq('id', parsed.data.revisionId)
      .single()

    if (revisionError || !revision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, revision.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const publications = await schedulePublications({
      requestId:parsed.data.requestId,
      contentHash:parsed.data.contentHash,
      revisionId: parsed.data.revisionId,
      destinations: parsed.data.destinations,
      createdBy: user.id,
    })

    return NextResponse.json({ publications }, { status: 201 })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Publications POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
