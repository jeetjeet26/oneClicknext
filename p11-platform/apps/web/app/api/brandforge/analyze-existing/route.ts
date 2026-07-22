import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

/**
 * Analyze existing knowledge base documents to extract brand insights
 * Used for properties that already have documents but no formal brand book
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { propertyId } = await req.json()

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if property has documents
    const { data: docs, error: docsError } = await supabase
      .from('documents')
      .select('content, metadata')
      .eq('property_id', propertyId)
      .limit(50) // Sample up to 50 chunks

    if (docsError || !docs || docs.length === 0) {
      return NextResponse.json({ 
        error: 'No documents found',
        hasDocs: false 
      }, { status: 404 })
    }

    // Combine document content for analysis
    const combinedContent = docs
      .map(d => d.content)
      .join('\n\n')
      .substring(0, 30000) // Limit to ~30k chars

    // Use Gemini to extract brand insights
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    
    const analysisPrompt = `
Analyze these property documents and extract brand insights:

${combinedContent}

Extract and return JSON with:
{
  "brandVoice": "1-2 word description (modern/luxury/community-focused/etc)",
  "brandPersonality": ["trait1", "trait2", "trait3"],
  "colorsMentioned": ["#hex or color names"],
  "targetAudience": "Who the property targets",
  "keyMessages": ["message 1", "message 2", "message 3"],
  "amenitiesHighlighted": ["top 5 amenities mentioned"],
  "toneAnalysis": "Formal/Casual/Mixed",
  "confidence": 0-100
}

Only extract what's clearly present in the documents. If something isn't mentioned, use null.
`

    const result = await model.generateContent(analysisPrompt)
    const responseText = result.response.text()
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to extract insights')
    }

    const insights = JSON.parse(jsonMatch[0])

    // Save insights to a lightweight format (not full brand asset)
    // Store in property settings or create a brand_insights table
    await supabase
      .from('properties')
      .update({
        settings: {
          brand_insights: {
            ...insights,
            analyzed_at: new Date().toISOString(),
            document_count: docs.length
          }
        }
      })
      .eq('id', propertyId)

    return NextResponse.json({
      success: true,
      insights,
      documentCount: docs.length
    })

  } catch (error) {
    console.error('Brand Analysis Error:', error)
    return NextResponse.json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}























