import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Data Engine URL for scraping operations
const DATA_ENGINE_URL = getDataEngineUrl()

// ============================================================================
// SENTIMENT ANALYSIS WITH OPENAI
// ============================================================================
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

// Review type definition
interface ReviewData {
  reviewer_name: string
  rating: number
  review_text: string
  review_date: string
  platform_review_id: string
  reviewer_avatar_url: string | null
}

// ============================================================================
// GOOGLE PLACES API - Via Data Engine (uses legacy API that works)
// ============================================================================
async function fetchGoogleReviewsViaAPI(placeId: string): Promise<ReviewData[]> {
  // Use data-engine which has the Google Maps API configured and working
  const response = await fetch(`${DATA_ENGINE_URL}/scraper/google-reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ place_id: placeId, max_reviews: 50 })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Data engine error: ${response.status}`)
  }

  const data = await response.json()
  
  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch Google reviews')
  }

  return (data.reviews || []).map((review: {
    reviewer_name?: string
    reviewer_avatar_url?: string
    rating?: number
    review_text?: string
    review_date?: string
    platform_review_id?: string
  }) => ({
    reviewer_name: review.reviewer_name || 'Anonymous',
    reviewer_avatar_url: review.reviewer_avatar_url || null,
    rating: review.rating || 0,
    review_text: review.review_text || '',
    review_date: review.review_date || new Date().toISOString(),
    platform_review_id: review.platform_review_id || `google-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }))
}

// ============================================================================
// GOOGLE REVIEWS VIA DATA-ENGINE SCRAPER (FULL - All Reviews)
// ============================================================================
async function fetchGoogleReviewsViaScraper(placeId: string): Promise<ReviewData[]> {
  try {
    // Use the FULL scraper endpoint which uses Playwright to get ALL reviews
    const response = await fetch(`${DATA_ENGINE_URL}/scraper/google-reviews/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place_id: placeId, max_reviews: 100 })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Scraper error: ${response.status}`)
    }

    const data = await response.json()
    
    // Consider it successful if we have any reviews (even from fallback)
    if (!data.reviews || data.reviews.length === 0) {
      throw new Error(data.error || 'No reviews returned from scraper')
    }
    
    // Log if we used fallback
    if (data.method === 'api_fallback') {
      console.log('Scraper used API fallback:', data.note)
    }

    return data.reviews.map((review: {
      platform_review_id: string
      reviewer_name: string
      reviewer_avatar_url?: string
      rating: number
      review_text: string
      review_date: string
    }) => ({
      platform_review_id: review.platform_review_id,
      reviewer_name: review.reviewer_name || 'Anonymous',
      reviewer_avatar_url: review.reviewer_avatar_url || null,
      rating: review.rating || 0,
      review_text: review.review_text || '',
      review_date: review.review_date || new Date().toISOString()
    }))
  } catch (error) {
    console.error('Google scraper error:', error)
    throw error
  }
}

// ============================================================================
// YELP REVIEWS VIA DATA-ENGINE
// ============================================================================
async function fetchYelpReviews(businessId: string): Promise<ReviewData[]> {
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scraper/yelp-reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Yelp API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Yelp API request failed')
    }

    return data.reviews.map((review: {
      platform_review_id: string
      reviewer_name: string
      reviewer_avatar_url?: string
      rating: number
      review_text: string
      review_date: string
    }) => ({
      platform_review_id: review.platform_review_id,
      reviewer_name: review.reviewer_name || 'Anonymous',
      reviewer_avatar_url: review.reviewer_avatar_url || null,
      rating: review.rating || 0,
      review_text: review.review_text || '',
      review_date: review.review_date || new Date().toISOString()
    }))
  } catch (error) {
    console.error('Yelp API error:', error)
    throw error
  }
}

// ============================================================================
// YELP REVIEWS VIA URL (extracts business ID)
// ============================================================================
async function fetchYelpReviewsFromUrl(yelpUrl: string): Promise<ReviewData[]> {
  try {
    const response = await fetch(`${DATA_ENGINE_URL}/scraper/yelp-reviews/from-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: yelpUrl })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Yelp URL error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Yelp URL request failed')
    }

    return data.reviews.map((review: {
      platform_review_id: string
      reviewer_name: string
      reviewer_avatar_url?: string
      rating: number
      review_text: string
      review_date: string
    }) => ({
      platform_review_id: review.platform_review_id,
      reviewer_name: review.reviewer_name || 'Anonymous',
      reviewer_avatar_url: review.reviewer_avatar_url || null,
      rating: review.rating || 0,
      review_text: review.review_text || '',
      review_date: review.review_date || new Date().toISOString()
    }))
  } catch (error) {
    console.error('Yelp URL error:', error)
    throw error
  }
}

// ============================================================================
// MAIN SYNC ENDPOINT
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { propertyId, platform, connectionId, method } = body

    if (!propertyId || !platform) {
      return NextResponse.json(
        { error: 'propertyId and platform are required' },
        { status: 400 }
      )
    }

    const isCronRequest = hasValidCronAuth(request)

    if (!isCronRequest) {
      const supabaseAuth = await createClient()
      const {
        data: { user },
        error: authError,
      } = await supabaseAuth.auth.getUser()

      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const supabase = createServiceClient()

    // Get the connection details
    let query = supabase
      .from('review_platform_connections')
      .select('*')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .eq('is_active', true)

    if (connectionId) {
      query = query.eq('id', connectionId)
    }

    const { data: connection, error: connError } = await query.single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'No active connection found for this platform' },
        { status: 404 }
      )
    }

    // Determine which method to use
    const connectionType = method || connection.connection_type || 'api'
    
    let reviews: ReviewData[] = []
    let syncMethod = connectionType
    
    try {
      switch (platform) {
        case 'google':
          if (connectionType === 'scraper' || connectionType === 'both') {
            // Try scraper first if configured
            if (connection.place_id) {
              try {
                reviews = await fetchGoogleReviewsViaScraper(connection.place_id)
                syncMethod = 'scraper'
              } catch (scraperError) {
                console.warn('Google scraper failed, falling back to API:', scraperError)
                // Fall back to API if scraper fails and connection type is 'both'
                if (connectionType === 'both' && connection.place_id) {
                  reviews = await fetchGoogleReviewsViaAPI(connection.place_id)
                  syncMethod = 'api'
                } else {
                  throw scraperError
                }
              }
            } else {
              throw new Error('Google Place ID not configured for scraping')
            }
          } else {
            // Use API method (default)
            if (!connection.place_id) {
              throw new Error('Google Place ID not configured')
            }
            reviews = await fetchGoogleReviewsViaAPI(connection.place_id)
            syncMethod = 'api'
          }
          break
          
        case 'yelp':
          // Check which identifier we have
          if (connection.yelp_business_id) {
            reviews = await fetchYelpReviews(connection.yelp_business_id)
          } else if (connection.yelp_business_url) {
            reviews = await fetchYelpReviewsFromUrl(connection.yelp_business_url)
          } else {
            throw new Error('Yelp Business ID or URL not configured. Please provide either yelp_business_id or yelp_business_url.')
          }
          syncMethod = 'api' // Yelp always uses API via data-engine
          break
          
        default:
          throw new Error(`Unsupported platform: ${platform}`)
      }
    } catch (fetchError) {
      // Update connection with error
      await supabase
        .from('review_platform_connections')
        .update({
          error_count: (connection.error_count || 0) + 1,
          last_error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
          updated_at: new Date().toISOString()
        })
        .eq('id', connection.id)

      throw fetchError
    }

    if (reviews.length === 0) {
      // Update last sync time even with no new reviews
      await supabase
        .from('review_platform_connections')
        .update({
          last_sync_at: new Date().toISOString(),
          error_count: 0,
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', connection.id)

      return NextResponse.json({
        success: true,
        imported: 0,
        message: 'No reviews found',
        syncMethod
      })
    }

    // Prepare reviews for upsert
    const reviewsToUpsert = reviews.map(review => ({
      property_id: propertyId,
      platform,
      platform_review_id: review.platform_review_id,
      reviewer_name: review.reviewer_name,
      reviewer_avatar_url: review.reviewer_avatar_url,
      rating: review.rating,
      review_text: review.review_text,
      review_date: review.review_date,
      response_status: 'pending',
      updated_at: new Date().toISOString()
    }))

    // Upsert reviews (update if exists, insert if new)
    const { data: upserted, error: upsertError } = await supabase
      .from('reviews')
      .upsert(reviewsToUpsert, {
        onConflict: 'property_id,platform,platform_review_id'
      })
      .select()

    if (upsertError) {
      console.error('Error upserting reviews:', upsertError)
      throw new Error(upsertError.message)
    }

    // Update connection stats
    await supabase
      .from('review_platform_connections')
      .update({
        last_sync_at: new Date().toISOString(),
        error_count: 0,
        last_error: null,
        total_reviews_synced: (connection.total_reviews_synced || 0) + (upserted?.length || 0),
        last_review_date: reviews.length > 0 ? reviews[0].review_date : connection.last_review_date,
        updated_at: new Date().toISOString()
      })
      .eq('id', connection.id)

    // Analyze new reviews with OpenAI (in background, don't await)
    const newReviews = (upserted || [])
      .filter(r => !r.sentiment)
      .map(r => ({
        id: r.id,
        review_text: r.review_text || '',
        rating: r.rating,
        property_id: r.property_id,
        reviewer_name: r.reviewer_name,
      }))
    if (newReviews.length > 0) {
      // Analyze reviews asynchronously - don't block the response
      analyzeReviewsBatch(newReviews)
    }

    // Add limitation note for Yelp
    let note: string | undefined
    if (platform === 'yelp') {
      note = 'Yelp API returns only 3 most recent reviews per business'
    }

    return NextResponse.json({
      success: true,
      imported: upserted?.length || 0,
      newReviews: newReviews.length,
      analyzingInBackground: newReviews.length > 0,
      syncMethod,
      note
    })

  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}

// Analyze reviews directly with OpenAI (no HTTP calls)
async function analyzeReviewsBatch(
  reviews: {
    id: string
    review_text: string
    rating: number | null
    property_id: string | null
    reviewer_name: string | null
  }[]
) {
  const supabase = createServiceClient()

  for (const review of reviews) {
    try {
      if (!review.property_id) {
        console.warn(`Skipping review ${review.id}: missing property_id`)
        continue
      }

      const reviewerName = review.reviewer_name || 'Anonymous'
      const ratingValue = review.rating ?? 0
      console.log(`Analyzing review ${review.id} from ${reviewerName}...`)
      
      // Get sentiment analysis from OpenAI
      const analysis = await analyzeReviewSentiment(review.review_text, review.rating)
      
      // Update the review with analysis results
      const { error: updateError } = await supabase
        .from('reviews')
        .update({
          sentiment: analysis.sentiment,
          sentiment_score: analysis.sentimentScore,
          topics: analysis.topics,
          is_urgent: analysis.isUrgent,
          auto_respond_eligible: analysis.sentiment === 'positive' && ratingValue >= 4,
          updated_at: new Date().toISOString()
        })
        .eq('id', review.id)

      if (updateError) {
        console.error(`Error updating review ${review.id}:`, updateError)
        continue
      }

      console.log(`✅ Analyzed review ${review.id}: ${analysis.sentiment} (${analysis.sentimentScore})`)

      // Auto-generate draft response for eligible positive reviews
      if (analysis.sentiment === 'positive' && ratingValue >= 4) {
        try {
          const { data: rfConfig } = await supabase
            .from('reviewflow_config')
            .select('auto_respond_positive, auto_respond_threshold, property_personality, default_tone')
            .eq('property_id', review.property_id)
            .single()

          if (rfConfig?.auto_respond_positive && ratingValue >= (rfConfig.auto_respond_threshold || 4)) {
            const { data: property } = await supabase
              .from('properties')
              .select('name')
              .eq('id', review.property_id)
              .single()

            const tone = rfConfig.default_tone || 'friendly'

            const responsePrompt = `You are responding to an online review for ${property?.name || 'our apartment community'}.
${rfConfig.property_personality ? `Property personality: ${rfConfig.property_personality}` : ''}
Guidelines:
- Be ${tone} in tone. Keep the response between 50-150 words.
- Thank them for their kind words. Mention specific things they appreciated.
- Make it feel personal and genuine, not templated.
- ${review.reviewer_name ? `Address them by name: ${review.reviewer_name}` : 'Do not assume their name'}
${analysis.topics.length > 0 ? `- Reference these topics: ${analysis.topics.join(', ')}` : ''}
Rating: ${ratingValue}/5`

            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: responsePrompt },
                { role: 'user', content: `Write a response to this review:\n\n"${review.review_text}"` }
              ],
              temperature: 0.7,
              max_tokens: 300
            })

            const responseText = completion.choices[0].message.content
            if (responseText) {
              await supabase.from('review_responses').insert({
                review_id: review.id,
                response_text: responseText,
                response_type: 'ai_generated',
                status: 'draft',
                tone,
                ai_model: 'gpt-4o-mini',
              })
              await supabase.from('reviews')
                .update({ response_status: 'draft_ready', updated_at: new Date().toISOString() })
                .eq('id', review.id)
              console.log(`✅ Auto-generated draft response for review ${review.id}`)
            }
          }
        } catch (autoRespondError) {
          console.error(`Auto-respond failed for review ${review.id} (non-blocking):`, autoRespondError)
        }
      }

      // Create ticket for negative/urgent reviews
      if (analysis.sentiment === 'negative' || analysis.isUrgent) {
        await supabase.from('review_tickets').upsert({
          review_id: review.id,
          property_id: review.property_id,
          title: analysis.isUrgent 
            ? `🚨 URGENT: Review from ${reviewerName}`
            : `Negative review from ${reviewerName}`,
          description: analysis.summary,
          priority: analysis.isUrgent ? 'urgent' : (analysis.sentimentScore < -0.5 ? 'high' : 'medium'),
          status: 'open'
        }, {
          onConflict: 'review_id'
        })
      }
    } catch (error) {
      console.error(`Error analyzing review ${review.id}:`, error)
    }
  }
}
