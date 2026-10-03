import { NextRequest, NextResponse } from 'next/server'
import {z} from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { recordAttributionEvent } from '@/utils/forgestudio/attribution'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if(!z.string().uuid().safeParse(token).success)return NextResponse.json({error:'Tracking destination not found'},{status:404})
  const { data: publication } = await createServiceClient()
    .from('social_publications')
    .select('social_content_variants ( link_url )')
    .eq('tracking_token', token)
    .eq('status','published')
    .not('published_at','is',null)
    .lte('published_at',new Date().toISOString())
    .single()
  const destination = publication?.social_content_variants?.link_url
  if (!destination || !destination.startsWith('https://')) {
    return NextResponse.json({ error: 'Tracking destination not found' }, { status: 404 })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const anonymousSubject = [
    forwardedFor || 'unknown',
    request.headers.get('user-agent') || 'unknown',
  ].join(':')
  await recordAttributionEvent({
    trackingToken: token,
    eventType: 'landing_view',
    anonymousSubject,
    metadata: { source: 'tracked_redirect' },
  }).catch((error) => {
    console.error('[forgestudio.attribution] redirect event failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  return NextResponse.redirect(destination, 307)
}
