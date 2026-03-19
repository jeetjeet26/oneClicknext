import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

interface SentimentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative'
  sentimentScore: number // -1 to 1
  topics: string[]
  isUrgent: boolean
  summary: string
}

async function analyzeReview(reviewText: string, rating: number | null): Promise<SentimentAnalysis> {
  const systemPrompt = `You are a sentiment analysis expert for property reviews. Analyze the review and provide:
1. Sentiment: positive, neutral, or negative
2. Sentiment score: -1 (very negative) to 1 (very positive)
3. Topics: Array of key topics mentioned (e.g., "maintenance", "noise", "management", "amenities", "cleanliness", "parking", "staff")
4. Is Urgent: true if the review mentions safety concerns, legal issues, discrimination, or severe problems requiring immediate attention
5. Summary: A brief 1-sentence summary of the review

Respond ONLY with valid JSON in this format:
{
  "sentiment": "positive|neutral|negative",
  "sentimentScore": 0.0,
  "topics": ["topic1", "topic2"],
  "isUrgent": false,
  "summary": "Brief summary"
}`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Review (Rating: ${rating || 'N/A'}/5):\n${reviewText}` }
      ],
      temperature: 0.3,
      max_tokens: 500
    })

    const responseText = completion.choices[0].message.content || '{}'
    const analysis = JSON.parse(responseText)
    
    return {
      sentiment: analysis.sentiment || 'neutral',
      sentimentScore: analysis.sentimentScore || 0,
      topics: analysis.topics || [],
      isUrgent: analysis.isUrgent || false,
      summary: analysis.summary || ''
    }
  } catch (error) {
    console.error('Error analyzing review:', error)
    throw new Error(
      `Review sentiment analysis provider is unavailable: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  const { reviewId, reviewText, rating, propertyId } = body

  let textToAnalyze: string = typeof reviewText === 'string' ? reviewText : ''
  let reviewRating: number | null = typeof rating === 'number' ? rating : null
  let reviewPropertyId: string | null = typeof propertyId === 'string' ? propertyId : null
  let reviewerName: string | null = null

  if (!reviewId && (!textToAnalyze || !reviewPropertyId)) {
    return NextResponse.json(
      { error: 'reviewId or (reviewText and propertyId) is required' },
      { status: 400 }
    )
  }

  // If reviewId is provided, fetch the review
  if (reviewId) {
    const { data: review, error } = await supabase
      .from('reviews')
      .select('review_text, rating, property_id, reviewer_name')
      .eq('id', reviewId)
      .single()

    if (error || !review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    if (typeof review.property_id !== 'string') {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, review.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    textToAnalyze = review.review_text || ''
    reviewRating = review.rating
    reviewPropertyId = review.property_id
    reviewerName = review.reviewer_name
  } else {
    if (typeof reviewPropertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }
    const access = await validatePropertyAccess(user.id, reviewPropertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (!textToAnalyze) {
    return NextResponse.json({ error: 'Review text is required' }, { status: 400 })
  }

  let analysis: SentimentAnalysis
  try {
    analysis = await analyzeReview(textToAnalyze, reviewRating)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Review analysis unavailable',
        details: error instanceof Error ? error.message : 'Unknown error',
        manualReviewRequired: true,
      },
      { status: 503 }
    )
  }

  // If reviewId provided, update the review with analysis results
  if (reviewId) {
    const { error: updateError } = await supabase
      .from('reviews')
      .update({
        sentiment: analysis.sentiment,
        sentiment_score: analysis.sentimentScore,
        topics: analysis.topics,
        is_urgent: analysis.isUrgent,
        auto_respond_eligible: analysis.sentiment === 'positive' && (reviewRating || 0) >= 4,
        updated_at: new Date().toISOString()
      })
      .eq('id', reviewId)

    if (updateError) {
      console.error('Error updating review with analysis:', updateError)
    }

    // If negative/urgent, create a ticket
    if ((analysis.sentiment === 'negative' || analysis.isUrgent) && reviewPropertyId) {
      await supabase.from('review_tickets').upsert({
        review_id: reviewId,
        property_id: reviewPropertyId,
        title: analysis.isUrgent
          ? `🚨 URGENT: Review from ${reviewerName || 'Anonymous'}`
          : `Negative review from ${reviewerName || 'Anonymous'}`,
        description: analysis.summary,
        priority: analysis.isUrgent ? 'urgent' : (analysis.sentimentScore < -0.5 ? 'high' : 'medium'),
        status: 'open'
      }, {
        onConflict: 'review_id'
      })
    }
  }

  return NextResponse.json({ analysis })
}

