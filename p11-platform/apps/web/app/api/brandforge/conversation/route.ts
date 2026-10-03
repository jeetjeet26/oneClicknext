import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

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

import { z } from 'zod'
import { createAdminClient } from '@/utils/supabase/admin'
import { brandId, brandHeaders, brandRpc, brandReply } from '@/utils/brandforge/operations'
const conversationRequest = z.object({ propertyId: brandId, brandAssetId: brandId.optional(), requestId: brandId, revision: z.number().int().min(0), action: z.enum(['start','message']), message: z.string().trim().max(8000).optional(), competitiveContext: z.record(z.string(),z.unknown()).optional(), researchId: brandId.optional() }).strict()
export async function POST(req: NextRequest) {
 let claim: { id: string; token: string } | null = null
 let terminalState: string | undefined
 try {
  const auth = await createClient()
  const { data: { user }, error } = await auth.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: brandHeaders })
  const parsed = conversationRequest.safeParse(await req.json().catch(() => null))
  if (!parsed.success || (parsed.data.action === 'message' && !parsed.data.message)) return NextResponse.json({ error: 'Invalid brief request' }, { status: 400, headers: brandHeaders })
  const { propertyId, brandAssetId, requestId, revision, action, message, competitiveContext, researchId } = parsed.data
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: brandHeaders })
  const admin = createAdminClient()
  const { data: existing } = await admin.from('property_brand_assets').select('*').eq('property_id', propertyId).maybeSingle()
  if (brandAssetId && existing?.id !== brandAssetId) return NextResponse.json({ error: 'Brand not found' }, { status: 404, headers: brandHeaders })
  if (action === 'start' && existing && Array.isArray(existing.gemini_conversation_history) && existing.gemini_conversation_history.length) {
   return NextResponse.json({ brandAssetId: existing.id, revision: (existing as unknown as { revision: number }).revision, conversationHistory: normalizeConversationHistory(existing.gemini_conversation_history), status: existing.generation_status === 'conversation' ? 'in_progress' : 'ready_to_generate' }, { headers: brandHeaders })
  }
  let researchContext = competitiveContext
  if (researchId) {
    const {data:research,error:researchError} = await admin.from('brand_research_runs').select('result').eq('id',researchId).eq('property_id',propertyId).eq('state','succeeded').single()
    if(researchError || !research)return NextResponse.json({error:'The selected saved research is unavailable for this property.'},{status:409,headers:brandHeaders})
    researchContext = (research as unknown as {result:Record<string,unknown>}).result
  }
  const started = await brandRpc('begin_brand_operation', { p_property_id: propertyId, p_brand_asset_id: brandAssetId || existing?.id || null, p_actor_id: user.id, p_request_id: requestId, p_revision: revision, p_kind: 'brief', p_input: { action, message: message || null, competitiveContext: researchContext || null, researchId: researchId || null } })
  if (started.state !== 'claimed') return brandReply(started)
  claim = { id: requestId, token: String(started.claimToken) }
  const brand = existing || { id: String(started.brandAssetId) }
  const conversationHistory = normalizeConversationHistory(existing?.gemini_conversation_history)
    // Build system context
    const effectiveContext = (existing?.competitive_analysis || researchContext) as Record<string, unknown> | null
    const contextPrompt = effectiveContext ? `
Current Market Context:
- Competitors analyzed: ${effectiveContext.competitorCount}
- Market gaps: ${(Array.isArray(effectiveContext.marketGaps) ? effectiveContext.marketGaps : []).join(', ')}
- Dominant positioning: ${(Array.isArray(effectiveContext.competitors) ? effectiveContext.competitors : []).slice(0, 3).map((c: { brandVoice?: string }) => c.brandVoice).join(', ')}
    ` : ''

    const systemPrompt = BRAND_STRATEGIST_SYSTEM_PROMPT + contextPrompt

    let aiResponse = ''
    let extractedData: Record<string, unknown> | null = null

    // Helper function to call Gemini 3
    async function callGemini3(prompt: string, history?: ConversationMessage[]) {
      const active = await brandRpc('check_brand_operation', { p_request_id: requestId, p_claim_token: claim!.token })
      if (active.state !== 'active') throw new Error('Brand request is no longer active')
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
      const active = await brandRpc('check_brand_operation', { p_request_id: requestId, p_claim_token: claim!.token })
      if (active.state !== 'active') throw new Error('Brand request is no longer active')
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
        throw new Error('The brand provider returned an empty response')
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

    if (!aiResponse.trim()) throw new Error('The brand provider returned an empty response')

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

    if (!extractedData?.conversationComplete) updates.generation_status = 'conversation'
    if (researchContext && !existing?.competitive_analysis) updates.competitive_analysis = researchContext
    return brandReply(await brandRpc('finish_brand_operation', { p_request_id: claim.id, p_claim_token: claim.token, p_updates: updates, p_result: { brandAssetId: brand.id, message: aiResponse, conversationHistory, extractedData, status: extractedData?.conversationComplete ? 'ready_to_generate' : 'in_progress' } }))
 } catch {
  if (claim) try {
   const result = await brandRpc('finish_brand_operation', { p_request_id: claim.id, p_claim_token: claim.token, p_updates: {}, p_result: {}, p_error: 'generation_failed' })
   if (result.state === 'replayed') return brandReply(result)
   if (result.state === 'failed' || result.state === 'cancelled') terminalState = String(result.state)
  } catch { /* Keep the unconfirmed request for operator review. */ }
  return NextResponse.json({ ...(terminalState ? { state: terminalState } : {}), error: 'The brief response could not be saved. Reload to check the saved conversation before retrying.' }, { status: 503, headers: brandHeaders })
 }
}
