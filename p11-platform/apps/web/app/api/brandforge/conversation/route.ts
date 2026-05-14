import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' })

type ConversationRole = 'user' | 'assistant'
type ConversationMessage = {
  role: ConversationRole
  content: string
}

function normalizeConversationHistory(input: unknown): ConversationMessage[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is { role?: unknown; content?: unknown } => typeof item === 'object' && item !== null)
    .map((item) => {
      const role: ConversationRole = item.role === 'assistant' ? 'assistant' : 'user'
      return {
        role,
        content: typeof item.content === 'string' ? item.content : '',
      }
    })
    .filter((item) => item.content.length > 0)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const BRAND_STRATEGIST_SYSTEM_PROMPT = `
You are a world-class brand strategist specializing in multifamily real estate.

Your goal: Extract comprehensive brand strategy through natural conversation (8-10 exchanges).

Process:
1. Acknowledge competitive landscape
2. Ask about vision, target audience, positioning goals (1-2 questions at a time)
3. Explore brand personality and voice preferences
4. Discuss visual preferences (colors, mood, style)
5. Explore messaging direction (headlines, key messages)
6. Co-create photo/visual style guidelines
7. Summarize and confirm

When conversation is complete and user confirms, extract structured JSON with:
{
  "brandName": "Suggested name",
  "vision": "User's vision for the property",
  "targetAudience": "Primary audience description",
  "brandVoice": "1-2 word description",
  "brandPersonality": ["trait1", "trait2", "trait3"],
  "positioningDirection": "How to position vs competitors",
  "colorPreferences": ["warm", "modern", "earthy"],
  "moodKeywords": ["authentic", "energetic", "welcoming"],
  "messagingStyle": "Casual/Professional/Mix",
  "photoStyleNotes": "Natural light, real people, etc",
  "conversationComplete": true
}

Stay conversational, ask follow-up questions, and build on previous answers.
`

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { 
      propertyId, 
      brandAssetId, 
      action, 
      message, 
      conversationHistory: initialHistory = [],
      competitiveContext 
    } = await req.json()
    
    let conversationHistory = normalizeConversationHistory(initialHistory)

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get or create brand asset
    let brand
    if (brandAssetId) {
      const { data } = await supabase
        .from('property_brand_assets')
        .select('*')
        .eq('id', brandAssetId)
        .single()
      brand = data
    } else if (action === 'start') {
      // First check if brand already exists for this property
      const { data: existingBrand } = await supabase
        .from('property_brand_assets')
        .select('*')
        .eq('property_id', propertyId)
        .single()
      
      if (existingBrand) {
        // Use existing brand and restore conversation
        brand = existingBrand
        if (existingBrand.gemini_conversation_history) {
          conversationHistory = normalizeConversationHistory(existingBrand.gemini_conversation_history)
        }
      } else {
        // Create new brand asset
        const { data, error } = await supabase
          .from('property_brand_assets')
          .insert({
            property_id: propertyId,
            generated_by: user.id,
            generation_status: 'conversation',
            competitive_analysis: competitiveContext
          })
          .select()
          .single()
        
        if (error) {
          console.error('Failed to create brand asset:', error)
          return NextResponse.json({ error: 'Failed to create brand asset', details: error.message }, { status: 500 })
        }
        brand = data
      }
    }

    if (!brand) {
      return NextResponse.json({ error: 'Brand asset not found' }, { status: 404 })
    }

    if (!brand.property_id) {
      return NextResponse.json({ error: 'Brand asset missing property' }, { status: 400 })
    }

    const brandAccess = await validatePropertyAccess(user.id, brand.property_id)
    if (!brandAccess.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build system context
    const contextPrompt = competitiveContext ? `
Current Market Context:
- Competitors analyzed: ${competitiveContext.competitorCount}
- Market gaps: ${competitiveContext.marketGaps?.join(', ')}
- Dominant positioning: ${competitiveContext.competitors?.slice(0, 3).map((c: { brandVoice?: string }) => c.brandVoice).join(', ')}
    ` : ''

    const systemPrompt = BRAND_STRATEGIST_SYSTEM_PROMPT + contextPrompt

    let aiResponse = ''
    let extractedData: Record<string, unknown> | null = null

    // Helper function to call Gemini 3
    async function callGemini3(prompt: string, history?: ConversationMessage[]) {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-3-pro-preview', // Gemini 3 Pro
        systemInstruction: systemPrompt
      })
      
      if (history && history.length > 0) {
        const chat = model.startChat({
          history: history.map((msg) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }))
        })
        const result = await chat.sendMessage(prompt)
        return result.response.text()
      } else {
        const result = await model.generateContent(prompt)
        return result.response.text()
      }
    }

    // Helper function to call OpenAI (fallback)
    async function callOpenAI(messages: { role: 'system' | 'user' | 'assistant', content: string }[]) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: 1000
      })
      return completion.choices[0]?.message?.content || ''
    }

    if (action === 'start') {
      const initialPrompt = "Start the brand strategy conversation by acknowledging the competitive landscape and asking about their vision."
      
      // Try Gemini 3 first, fall back to OpenAI
      try {
        aiResponse = await callGemini3(initialPrompt)
      } catch (geminiError: unknown) {
        console.warn('Gemini 3 failed, falling back to OpenAI:', getErrorMessage(geminiError))
        aiResponse = await callOpenAI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: initialPrompt }
        ])
      }
      
      if (!aiResponse) {
        aiResponse = "Hello! I'm excited to help you create a distinctive brand for your property. Based on our analysis of your market, I see some interesting opportunities. Let's start by understanding your vision - what feeling do you want residents to have when they think of your community?"
      }
      
      conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      })
    } else if (action === 'message' && message) {
      // Add user message to history first
      conversationHistory.push({
        role: 'user',
        content: message
      })

      // Try Gemini 3 first, fall back to OpenAI
      try {
        const historyForChat = conversationHistory.slice(0, -1) // Exclude the message we just added
        aiResponse = await callGemini3(message, historyForChat)
      } catch (geminiError: unknown) {
        console.warn('Gemini 3 failed, falling back to OpenAI:', getErrorMessage(geminiError))
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...conversationHistory.map((msg) => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }))
        ]
        aiResponse = await callOpenAI(messages)
      }

      if (!aiResponse) {
        aiResponse = "I understand. Let me help you refine that further. Could you tell me more about your target audience?"
      }

      conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      })

      // Check if conversation is complete (look for JSON in response)
      if (aiResponse.includes('"conversationComplete": true')) {
        try {
          const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            extractedData = JSON.parse(jsonMatch[0])
          }
        } catch (e) {
          console.error('Failed to parse extracted data:', e)
        }
      }
    }

    // Update brand asset
    const updates: Record<string, unknown> = {
      gemini_conversation_history: conversationHistory
    }

    if (extractedData?.conversationComplete) {
      updates.conversation_summary = extractedData
      updates.generation_status = 'generating'
      updates.current_step = 1
      updates.current_step_name = 'introduction'
    }

    await supabase
      .from('property_brand_assets')
      .update(updates as never)
      .eq('id', brand.id)

    return NextResponse.json({
      brandAssetId: brand.id,
      message: aiResponse,
      conversationHistory,
      extractedData,
      status: extractedData?.conversationComplete ? 'ready_to_generate' : 'in_progress'
    })

  } catch (error) {
    console.error('BrandForge Conversation Error:', error)
    return NextResponse.json({ 
      error: 'Conversation failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}


