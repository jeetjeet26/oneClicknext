import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

interface SentimentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative'
  sentimentScore: number
  topics: string[]
  isUrgent: boolean
  summary: string
}

async function analyzeReviewSentiment(reviewText: string, rating: number | null): Promise<SentimentAnalysis> {
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
    console.error('Error analyzing review with OpenAI:', error)
    throw new Error(
      `Review sentiment analysis provider is unavailable: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}

// POST: Analyze all unanalyzed reviews for a property
export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, limit = 50 } = body

    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Get all reviews without sentiment analysis
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, review_text, rating, property_id, reviewer_name')
      .eq('property_id', propertyId)
      .is('sentiment', null)
      .limit(limit)

    if (error) {
      console.error('Error fetching reviews:', error)
      return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
    }

    if (!reviews || reviews.length === 0) {
      return NextResponse.json({
        success: true,
        analyzed: 0,
        message: 'No unanalyzed reviews found'
      })
    }

    console.log(`Starting batch analysis of ${reviews.length} reviews...`)

    let analyzed = 0
    let errors = 0
    let providerFailures = 0
    const results: Array<{
      id: string
      status: 'analyzed' | 'manual_review_required'
      sentiment?: string
      score?: number
      error?: string
    }> = []

    // Process reviews sequentially to avoid rate limits
    for (const review of reviews) {
      try {
        console.log(`Analyzing review ${review.id} from ${review.reviewer_name}...`)
        
        const analysis = await analyzeReviewSentiment(review.review_text || '', review.rating)
        
        // Update the review
        const { error: updateError } = await supabase
          .from('reviews')
          .update({
            sentiment: analysis.sentiment,
            sentiment_score: analysis.sentimentScore,
            topics: analysis.topics,
            is_urgent: analysis.isUrgent,
            auto_respond_eligible: analysis.sentiment === 'positive' && (review.rating || 0) >= 4,
            updated_at: new Date().toISOString()
          })
          .eq('id', review.id)

        if (updateError) {
          console.error(`Error updating review ${review.id}:`, updateError)
          errors++
          continue
        }

        // Create ticket for negative/urgent reviews
        if (analysis.sentiment === 'negative' || analysis.isUrgent) {
          await supabase.from('review_tickets').upsert({
            review_id: review.id,
            property_id: review.property_id,
            title: analysis.isUrgent 
              ? `🚨 URGENT: Review from ${review.reviewer_name || 'Anonymous'}`
              : `Negative review from ${review.reviewer_name || 'Anonymous'}`,
            description: analysis.summary,
            priority: analysis.isUrgent ? 'urgent' : (analysis.sentimentScore < -0.5 ? 'high' : 'medium'),
            status: 'open'
          }, {
            onConflict: 'review_id'
          })
        }

        analyzed++
        results.push({
          id: review.id,
          status: 'analyzed',
          sentiment: analysis.sentiment,
          score: analysis.sentimentScore
        })

        console.log(`✅ ${analyzed}/${reviews.length}: ${review.reviewer_name} -> ${analysis.sentiment} (${analysis.sentimentScore})`)

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (err) {
        console.error(`Error analyzing review ${review.id}:`, err)
        providerFailures++
        results.push({
          id: review.id,
          status: 'manual_review_required',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    const responseBody = {
      success: analyzed > 0 && providerFailures === 0 && errors === 0,
      analyzed,
      errors,
      providerFailures,
      manualReviewRequired: providerFailures > 0,
      total: reviews.length,
      results,
    }

    if (analyzed === 0 && providerFailures > 0) {
      return NextResponse.json(
        {
          ...responseBody,
          error: 'Review analysis unavailable',
        },
        { status: 503 }
      )
    }

    return NextResponse.json(responseBody)

  } catch (error) {
    console.error('Batch analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch analysis failed' },
      { status: 500 }
    )
  }
}

