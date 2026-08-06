import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'

const reviewIdSchema = z.string().uuid()
const approvalSchema = z
  .object({
    attributionApproved: z.literal(true),
    rightsBasis: z.enum([
      'platform_terms',
      'direct_consent',
      'property_license',
      'other',
    ]),
    evidenceNote: z.string().trim().min(3).max(1000),
  })
  .strict()
const revocationSchema = z
  .object({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()

function fingerprintReview(review: {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  platform: string
  review_date: string
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        review.id,
        review.reviewer_name,
        review.review_text,
        review.rating,
        review.platform,
        review.review_date,
      ])
    )
    .digest('hex')
}

async function authenticatedManager(
  reviewId: string
): Promise<
  | {
      userId: string
      review: {
        id: string
        property_id: string
        reviewer_name: string
        review_text: string
        rating: number
        platform: string
        review_date: string
        content_fingerprint: string | null
      }
    }
  | { error: string; status: number }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 }

  const client = createServiceClient()
  const { data: review, error } = await client
    .from('reviews')
    .select(
      'id, property_id, reviewer_name, review_text, rating, platform, review_date, content_fingerprint'
    )
    .eq('id', reviewId)
    .single()
  if (
    error ||
    !review ||
    !review.property_id ||
    !review.reviewer_name ||
    !review.review_text ||
    !review.rating ||
    !review.platform ||
    !review.review_date
  ) {
    return {
      error: error ? 'Review not found' : 'Review is incomplete for publication',
      status: error ? 404 : 409,
    }
  }

  const access = await validatePropertyManagerAccess(user.id, review.property_id)
  if (!access.authorized) return { error: 'Forbidden', status: 403 }

  return {
    userId: user.id,
    review: {
      ...review,
      property_id: review.property_id,
      reviewer_name: review.reviewer_name,
      review_text: review.review_text,
      rating: review.rating,
      platform: review.platform,
      review_date: review.review_date,
    },
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/reviewflow/testimonials/[reviewId]'
  )
  ctx.logStart()
  try {
    const { reviewId } = await params
    const parsed = approvalSchema.safeParse(
      await request.json().catch(() => ({}))
    )
    if (!reviewIdSchema.safeParse(reviewId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Valid publication approval and rights evidence are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const authorization = await authenticatedManager(reviewId)
    if ('error' in authorization) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const { review, userId } = authorization
    const contentFingerprint =
      review.content_fingerprint &&
      /^[a-f0-9]{64}$/.test(review.content_fingerprint)
        ? review.content_fingerprint
        : fingerprintReview(review)
    const { data: approval, error } = await createServiceClient()
      .from('review_testimonial_approvals')
      .insert({
        review_id: review.id,
        property_id: review.property_id,
        content_fingerprint: contentFingerprint,
        reviewer_name_snapshot: review.reviewer_name,
        review_text_snapshot: review.review_text,
        rating_snapshot: review.rating,
        platform_snapshot: review.platform,
        review_date_snapshot: review.review_date,
        attribution_approved: parsed.data.attributionApproved,
        rights_basis: parsed.data.rightsBasis,
        rights_evidence: {
          note: parsed.data.evidenceNote,
          source: 'reviewflow_operator_approval',
        } satisfies Json,
        approved_by: userId,
      })
      .select()
      .single()
    if (error) {
      const status = error.code === '23505' ? 409 : 500
      return NextResponse.json(
        {
          error:
            status === 409
              ? 'This review already has an active testimonial approval'
              : 'Failed to approve testimonial publication',
        },
        { status, headers: ctx.responseHeaders }
      )
    }

    ctx.logSuccess(201)
    return NextResponse.json(
      { approval },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to approve testimonial publication' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/reviewflow/testimonials/[reviewId]'
  )
  ctx.logStart()
  try {
    const { reviewId } = await params
    const parsed = revocationSchema.safeParse(
      await request.json().catch(() => ({}))
    )
    if (!reviewIdSchema.safeParse(reviewId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'A valid review and revocation reason are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const authorization = await authenticatedManager(reviewId)
    if ('error' in authorization) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const now = new Date().toISOString()
    const { data: approval, error } = await createServiceClient()
      .from('review_testimonial_approvals')
      .update({
        status: 'revoked',
        revoked_by: authorization.userId,
        revoked_at: now,
        revocation_reason: parsed.data.reason,
        updated_at: now,
      })
      .eq('review_id', reviewId)
      .eq('status', 'active')
      .select()
      .maybeSingle()
    if (error) {
      throw error
    }
    if (!approval) {
      return NextResponse.json(
        { error: 'No active testimonial approval was found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    ctx.logSuccess(200)
    return NextResponse.json(
      { approval },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to revoke testimonial publication' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
