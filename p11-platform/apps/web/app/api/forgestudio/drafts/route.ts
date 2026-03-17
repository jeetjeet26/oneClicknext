import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { evaluateForgeStudioDraftReadiness } from '@/utils/services/forgestudio-draft-readiness'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - Fetch content drafts
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const status = searchParams.get('status')
    const contentType = searchParams.get('contentType')
    const platform = searchParams.get('platform')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!propertyId) {
      return NextResponse.json(
        { error: 'Property ID required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let query = supabase
      .from('content_drafts')
      .select(`
        *,
        content_templates (
          id,
          name,
          content_type
        ),
        profiles:approved_by (
          id,
          full_name
        )
      `, { count: 'exact' })
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    if (contentType) {
      query = query.eq('content_type', contentType)
    }

    if (platform) {
      query = query.eq('platform', platform)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching drafts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch drafts' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      drafts: data,
      total: count,
      limit,
      offset
    })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH - Update a draft (approve, reject, edit, attach media)
export async function PATCH(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      draftId,
      status,
      caption,
      hashtags,
      callToAction,
      scheduledFor,
      rejectionReason,
      // New media attachment fields
      mediaUrls,
      mediaType,
      thumbnailUrl
    } = body

    if (!draftId) {
      return NextResponse.json(
        { error: 'Draft ID required' },
        { status: 400 }
      )
    }

    const { data: existingDraft, error: existingDraftError } = await supabase
      .from('content_drafts')
      .select('id, property_id, status, caption, platform, content_type, media_type, media_urls, generation_params')
      .eq('id', draftId)
      .single()

    if (existingDraftError || !existingDraft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      )
    }

    const access = await validatePropertyAccess(user.id, existingDraft.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    const candidateDraft = {
      caption: caption !== undefined ? caption : existingDraft.caption,
      platform: existingDraft.platform,
      contentType: existingDraft.content_type,
      mediaType: mediaType !== undefined ? mediaType : existingDraft.media_type,
      mediaUrls: mediaUrls !== undefined ? mediaUrls : existingDraft.media_urls,
    }
    const readiness = evaluateForgeStudioDraftReadiness(candidateDraft)
    const nextGenerationParams = {
      ...(typeof existingDraft.generation_params === 'object' && existingDraft.generation_params !== null
        ? existingDraft.generation_params as Record<string, unknown>
        : {}),
      readiness: {
        state: readiness.state,
        blockers: readiness.blockers,
      },
    }
    updateData.generation_params = nextGenerationParams

    if (status) {
      if ((status === 'approved' || status === 'scheduled') && !readiness.isReady) {
        return NextResponse.json(
          {
            error: 'Draft is partial and not ready for approval/scheduling',
            blockers: readiness.blockers,
          },
          { status: 409 }
        )
      }

      updateData.status = status
      
      if (status === 'approved') {
        updateData.approved_at = new Date().toISOString()
        updateData.approved_by = user.id
      }
      
      if (status === 'rejected' && rejectionReason) {
        updateData.rejection_reason = rejectionReason
      }
      
      if (status === 'scheduled' && scheduledFor) {
        updateData.scheduled_for = scheduledFor
      }
    }

    if (caption !== undefined) updateData.caption = caption
    if (hashtags !== undefined) updateData.hashtags = hashtags
    if (callToAction !== undefined) updateData.call_to_action = callToAction
    
    // Handle media attachment updates
    if (mediaUrls !== undefined) updateData.media_urls = mediaUrls
    if (mediaType !== undefined) updateData.media_type = mediaType
    if (thumbnailUrl !== undefined) updateData.thumbnail_url = thumbnailUrl

    const statusNotExplicitlySet = !status
    if (statusNotExplicitlySet && ['draft', 'draft_partial', 'pending_review'].includes(existingDraft.status || 'draft')) {
      updateData.status = readiness.isReady ? 'pending_review' : 'draft_partial'
    }

    const { data, error } = await supabase
      .from('content_drafts')
      .update(updateData)
      .eq('id', draftId)
      .select()
      .single()

    if (error) {
      console.error('Error updating draft:', error)
      return NextResponse.json(
        { error: 'Failed to update draft' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      draft: data
    })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE - Delete a draft
export async function DELETE(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const draftId = searchParams.get('draftId')

    if (!draftId) {
      return NextResponse.json(
        { error: 'Draft ID required' },
        { status: 400 }
      )
    }

    const { data: existingDraft, error: existingDraftError } = await supabase
      .from('content_drafts')
      .select('id, property_id')
      .eq('id', draftId)
      .single()

    if (existingDraftError || !existingDraft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      )
    }

    const access = await validatePropertyAccess(user.id, existingDraft.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('content_drafts')
      .delete()
      .eq('id', draftId)

    if (error) {
      console.error('Error deleting draft:', error)
      return NextResponse.json(
        { error: 'Failed to delete draft' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true
    })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

