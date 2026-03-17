import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

type ResponseTone = 'professional' | 'empathetic' | 'friendly' | 'apologetic'

interface GenerateResponseParams {
  reviewText: string
  rating: number | null
  sentiment: string
  topics: string[]
  propertyName?: string
  propertyPersonality?: string
  tone: ResponseTone
  reviewerName?: string
}

async function generateResponse(params: GenerateResponseParams): Promise<string> {
  const { reviewText, rating, sentiment, topics, propertyName, propertyPersonality, tone, reviewerName } = params

  const toneInstructions: Record<ResponseTone, string> = {
    professional: 'Be professional, courteous, and business-like.',
    empathetic: 'Show genuine empathy and understanding. Acknowledge their feelings.',
    friendly: 'Be warm, conversational, and personable.',
    apologetic: 'Express sincere apology for any issues. Show accountability.'
  }

  const systemPrompt = `You are responding to an online review for ${propertyName || 'our apartment community'}.
${propertyPersonality ? `Property personality: ${propertyPersonality}` : ''}

Guidelines:
- ${toneInstructions[tone]}
- Keep the response between 50-150 words
- ${sentiment === 'negative' ? 'Address their concerns and offer to make it right' : 'Thank them for their kind words'}
- ${sentiment === 'negative' ? 'Never be defensive or dismissive' : 'Mention specific things they appreciated if possible'}
- Include a call to action when appropriate (visit again, contact us, etc.)
- Do NOT use clichéd phrases like "We appreciate your feedback"
- Make it feel personal and genuine, not templated
- ${reviewerName ? `Address them by name: ${reviewerName}` : 'Do not assume their name'}
${topics.length > 0 ? `- Reference these specific topics mentioned: ${topics.join(', ')}` : ''}

Original Review Rating: ${rating || 'N/A'}/5
Detected Sentiment: ${sentiment}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please write a response to this review:\n\n"${reviewText}"` }
    ],
    temperature: 0.7,
    max_tokens: 300
  })

  return completion.choices[0].message.content || 'Thank you for your review. We value your feedback.'
}

function parseTone(value: unknown, fallback: ResponseTone = 'professional'): ResponseTone {
  if (value === 'professional' || value === 'empathetic' || value === 'friendly' || value === 'apologetic') {
    return value
  }
  return fallback
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  
  const { reviewId, tone = 'professional', customPrompt } = body

  if (!reviewId) {
    return NextResponse.json({ error: 'reviewId is required' }, { status: 400 })
  }

  // Fetch the review with property info
  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select(`
      *,
      properties (
        name,
        settings
      )
    `)
    .eq('id', reviewId)
    .single()

  if (reviewError || !review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  if (typeof review.property_id !== 'string') {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  const access = await validatePropertyAccess(user.id, review.property_id)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch ReviewFlow config for property personality
  const { data: config } = await supabase
    .from('reviewflow_config')
    .select('property_personality, default_tone')
    .eq('property_id', review.property_id)
    .single()

  // Generate the response
  let responseText: string
  try {
    const resolvedTone = parseTone(tone, parseTone(config?.default_tone))
    responseText = await generateResponse({
      reviewText: review.review_text || '',
      rating: typeof review.rating === 'number' ? review.rating : null,
      sentiment: review.sentiment || 'neutral',
      topics: Array.isArray(review.topics)
        ? review.topics.filter((topic): topic is string => typeof topic === 'string')
        : [],
      propertyName: review.properties?.name || undefined,
      propertyPersonality: config?.property_personality || undefined,
      tone: resolvedTone,
      reviewerName: review.reviewer_name || undefined
    })
  } catch (aiError) {
    console.error('OpenAI error:', aiError)
    return NextResponse.json({ 
      error: aiError instanceof Error ? aiError.message : 'Failed to generate AI response' 
    }, { status: 500 })
  }

  // Save the generated response
  const { data: savedResponse, error: saveError } = await supabase
    .from('review_responses')
    .insert({
      review_id: reviewId,
      response_text: responseText,
      response_type: 'ai_generated',
      status: 'draft',
      tone: parseTone(tone),
      ai_model: 'gpt-4o-mini',
      generation_prompt: customPrompt || null
    })
    .select()
    .single()

  if (saveError) {
    console.error('Error saving response:', saveError)
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  // Update review status
  await supabase
    .from('reviews')
    .update({ 
      response_status: 'draft_ready',
      updated_at: new Date().toISOString()
    })
    .eq('id', reviewId)

  return NextResponse.json({ 
    response: savedResponse,
    responseText 
  })
}

// Approve and optionally post a response
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const body = await request.json()
  
  const { responseId, action, editedText } = body

  if (!responseId || !action) {
    return NextResponse.json({ error: 'responseId and action are required' }, { status: 400 })
  }

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existingResponse, error: existingResponseError } = await supabase
    .from('review_responses')
    .select(`
      id,
      review_id,
      status,
      reviews (
        property_id
      )
    `)
    .eq('id', responseId)
    .single()

  if (existingResponseError || !existingResponse) {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const responsePropertyId = Array.isArray(existingResponse.reviews)
    ? existingResponse.reviews[0]?.property_id
    : existingResponse.reviews?.property_id
  if (typeof responsePropertyId !== 'string') {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const access = await validatePropertyAccess(user.id, responsePropertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (action === 'approve') {
    const { data, error } = await supabase
      .from('review_responses')
      .update({
        status: 'approved',
        response_text: editedText || undefined,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', responseId)
      .select('review_id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Update review status
    if (data && typeof data.review_id === 'string') {
      await supabase
        .from('reviews')
        .update({ 
          response_status: 'approved',
          updated_at: new Date().toISOString()
        })
        .eq('id', data.review_id)
    }

    return NextResponse.json({ success: true, status: 'approved' })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('review_responses')
      .update({
        status: 'rejected',
        rejected_reason: body.reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', responseId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: 'rejected' })
  }

  if (action === 'post') {
    if (existingResponse.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only approved responses can be marked as posted' },
        { status: 409 }
      )
    }

    if (body.manualConfirmed !== true) {
      return NextResponse.json(
        { error: 'manualConfirmed is required to mark a response as posted' },
        { status: 400 }
      )
    }

    const providerPostId = normalizeOptionalString(body.providerPostId)
    const providerPostUrl = normalizeOptionalString(body.providerPostUrl)
    const providerNotes = normalizeOptionalString(body.providerNotes)

    if (!providerPostId && !providerPostUrl) {
      return NextResponse.json(
        { error: 'providerPostId or providerPostUrl is required to confirm provider-side execution' },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()
    const { data: responseForPosting, error: responseForPostingError } = await supabase
      .from('review_responses')
      .select(`
        review_id,
        reviews (
          id,
          platform,
          property_id
        )
      `)
      .eq('id', responseId)
      .single()

    if (responseForPostingError || !responseForPosting) {
      return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    }

    const responseReview = Array.isArray(responseForPosting.reviews)
      ? responseForPosting.reviews[0]
      : responseForPosting.reviews
    const reviewId = typeof responseForPosting.review_id === 'string' ? responseForPosting.review_id : null
    const reviewPropertyId = typeof responseReview?.property_id === 'string' ? responseReview.property_id : null
    const reviewPlatform = typeof responseReview?.platform === 'string' ? responseReview.platform : 'unknown'
    if (!reviewId || !reviewPropertyId) {
      return NextResponse.json({ error: 'Response review is missing property context' }, { status: 409 })
    }

    // Create an auditable provider execution record before status mutation.
    const { data: auditTicket, error: auditTicketError } = await supabase
      .from('review_tickets')
      .insert({
        review_id: reviewId,
        property_id: reviewPropertyId,
        title: `Provider response posted (${reviewPlatform})`,
        description: 'Provider-side response execution was operator-confirmed for this approved response.',
        priority: 'low',
        status: 'resolved',
        resolution_notes: JSON.stringify({
          action: 'provider_post_confirmed',
          response_id: responseId,
          provider_post_id: providerPostId,
          provider_post_url: providerPostUrl,
          provider_notes: providerNotes,
          confirmed_by: user.id,
          confirmed_at: nowIso,
          mode: 'manual_confirmed',
        }),
      })
      .select('id')
      .single()

    if (auditTicketError || !auditTicket?.id) {
      return NextResponse.json(
        { error: auditTicketError?.message || 'Failed to persist provider execution audit record' },
        { status: 500 }
      )
    }

    // Provider posting is still operator-manual for now. This endpoint records
    // explicit evidence + audit ticket after the operator posts externally.
    const { data, error } = await supabase
      .from('review_responses')
      .update({
        status: 'posted',
        posted_at: nowIso,
        updated_at: new Date().toISOString()
      })
      .eq('id', responseId)
      .select('review_id')
      .single()

    if (error) {
      // Best-effort rollback of audit ticket to avoid stale confirmation records.
      await supabase.from('review_tickets').delete().eq('id', auditTicket.id)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Update review status
    if (data && typeof data.review_id === 'string') {
      await supabase
        .from('reviews')
        .update({ 
          response_status: 'posted',
          updated_at: new Date().toISOString()
        })
        .eq('id', data.review_id)
    }

    return NextResponse.json({
      success: true,
      status: 'posted',
      postingMode: 'manual_confirmed',
      auditTicketId: auditTicket.id,
      providerEvidence: {
        providerPostId,
        providerPostUrl,
      },
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

