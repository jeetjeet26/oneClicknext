import { NextRequest, NextResponse } from 'next/server'
import {z} from 'zod'
import {responseIdSchema as uuid} from '@/utils/reviewflow/response-contracts'
const readSchema=z.object({propertyId:uuid,reviewId:uuid.optional(),platform:z.string().max(40).optional(),sentiment:z.enum(['positive','neutral','negative']).optional(),status:z.string().max(100).optional(),search:z.string().trim().max(200).optional(),limit:z.coerce.number().int().min(1).max(200).default(50),offset:z.coerce.number().int().min(0).default(0)}).strict()
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    const parsed=readSchema.safeParse(Object.fromEntries(searchParams));if(!parsed.success)return NextResponse.json({error:'Choose a property and valid review filters.'},{status:400})
    const {propertyId,reviewId,platform,sentiment,status,search,limit,offset}=parsed.data

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const columns=`
        id,property_id,platform,platform_review_id,source_version,reviewer_name,reviewer_avatar_url,rating,review_text,review_date,sentiment,sentiment_score,is_urgent,response_status,topics,created_at,
        review_responses (
          id,
          response_text,
          response_type,
          status,
          tone,
          decision_reason,
          superseded_at,
          posting_mode,
          platform_response_id,
          provider_post_url,
          approved_at,
          posted_at,
          created_at
        ),
        review_tickets (
          id,
          title,
          priority,
          status,
          resolution_notes,
          resolved_at,
          created_at
        ),
        reputation_cases (
          id,
          version,
          status,
          priority,
          risk_class,
          policy_class,
          journey_stage,
          owner_profile_id,
          sla_due_at,
          remediation_state
        ),
        review_testimonial_approvals (
          id,
          status,
          rights_basis,
          rights_evidence,
          approved_at,
          revoked_at,
          revocation_reason
        )
      `
    let query=(search?supabase.rpc('search_reviewflow_reviews',{p_property_id:propertyId,p_query:search},{count:'exact'}).select(columns):supabase.from('reviews').select(columns,{count:'exact'}))
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false }).order('id',{ascending:false})
      .order('created_at', { referencedTable: 'review_responses', ascending: false })
      .range(offset, offset + limit - 1)

    if (reviewId) {
      query = query.eq('id', reviewId)
    }
    if (platform) {
      query = query.eq('platform', platform)
    }
    if (sentiment) {
      query = query.eq('sentiment', sentiment)
    }
    if (status) {
      // Supports comma-separated status lists (e.g. "pending,draft_ready").
      const statuses = status.split(',').map((value) => value.trim()).filter(Boolean)
      query = statuses.length > 1
        ? query.in('response_status', statuses)
        : query.eq('response_status', statuses[0] || status)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Review list could not be read.')
      return NextResponse.json({ error: 'Reviews could not be loaded. Reload and try again.' }, { status: 500 })
    }

    return NextResponse.json({ reviews: data, total: count })
  } catch (error) {
    console.error('ReviewFlow GET /reviews error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(){return NextResponse.json({error:'Use the saved import workspace to preview and apply review sources with a recorded decision.'},{status:410})}
export const PATCH=POST
export const DELETE=POST
