// SiteForge: Conversational Planning API
// POST /api/siteforge/plan
// Handles conversation with Architecture/Design agents
// Returns updated plan based on user feedback
// Created: December 16, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { 
      propertyId, 
      brandContext, 
      conversationHistory, 
      userMessage 
    } = await request.json()

    if (!propertyId || !brandContext) {
      return NextResponse.json(
        { error: 'propertyId and brandContext required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build conversation for Claude
    const systemPrompt = `You are a website planning assistant for SiteForge. You help users plan their website structure through conversation, similar to how BrandForge creates brand books.

Your role:
1. Present initial plan based on brand context
2. Ask clarifying questions
3. Adjust plan based on user feedback
4. Suggest improvements
5. Explain your reasoning

You're planning polished, conversion-focused WordPress sites for multifamily properties without copying any single reference property.

Be conversational, insightful, and collaborative.`

    // Pass the FULL brand context to Claude
    const initialContext = `
Brand Context for ${brandContext.propertyName || 'this property'}:

COMPLETE BRAND ANALYSIS:
${JSON.stringify(brandContext, null, 2)}

Based on this brand analysis, I'm planning:

Key findings:
- Personality: ${brandContext.brandPersonality?.primary || 'Not specified'}
- Target Audience: ${brandContext.targetAudience?.demographics || 'Not specified'}
- Key Traits: ${brandContext.brandPersonality?.traits?.join(', ') || 'Not specified'}
- Differentiators: ${brandContext.positioning?.differentiators?.join(', ') || 'Not specified'}
- Photo Style: ${brandContext.visualIdentity?.photoStyle?.mood || 'Not specified'}

I'm planning a website that expresses this brand through:
• Hero section that showcases ${brandContext.positioning?.differentiators?.[0] || 'key features'}
• ${brandContext.visualIdentity?.photoStyle?.composition || 'Professional'} photography
• Content focused on ${brandContext.targetAudience?.priorities?.[0] || 'lifestyle'}
• Design that conveys ${brandContext.brandPersonality?.primary || 'modern professionalism'}

What would you like to emphasize or adjust in this plan?`

    // Build message history
    const messages: Anthropic.MessageParam[] = []

    // Add conversation history (must alternate user/assistant, must start with user)
    if (conversationHistory && conversationHistory.length > 0) {
      // If history starts with assistant (the initial AI response), prepend
      // the original user context so Claude has the full conversation
      if (conversationHistory[0].role === 'assistant') {
        messages.push({
          role: 'user',
          content: `Please present your initial plan for the website.\n\nHere's the brand analysis:\n${initialContext}`
        })
      }
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      }
    }

    // Add user's new message (or initial request if first turn)
    if (userMessage) {
      messages.push({
        role: 'user',
        content: userMessage
      })
    } else if (messages.length === 0) {
      // First message - user asks for initial plan
      messages.push({
        role: 'user',
        content: `Please present your initial plan for the website.

Here's the brand analysis:
${initialContext}`
      })
    }

    // Get Claude's response
    console.log('Calling Claude with messages:', messages.length, 'messages')
    console.log('Last message role:', messages[messages.length - 1]?.role)
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,  // Increased for longer responses
      temperature: 1.0,
      system: systemPrompt,
      messages
    })
    
    console.log('Claude response:', {
      contentBlocks: response.content.length,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason
    })

    // Extract text content
    let aiResponse = ''
    for (const content of response.content) {
      if (content.type === 'text') {
        aiResponse += content.text
      }
    }
    
    if (!aiResponse) {
      console.error('Claude response structure:', JSON.stringify(response, null, 2))
      throw new Error('Claude returned no text content')
    }
    
    // Update conversation history
    const updatedHistory = [
      ...messages,
      {
        role: 'assistant',
        content: aiResponse
      }
    ]

    // Check if user is ready to generate (look for confirmation words)
    const readyToGenerate = 
      userMessage?.toLowerCase().includes('yes') ||
      userMessage?.toLowerCase().includes('looks good') ||
      userMessage?.toLowerCase().includes('perfect') ||
      userMessage?.toLowerCase().includes('generate') ||
      userMessage?.toLowerCase().includes('proceed') ||
      userMessage?.toLowerCase().includes('build it') ||
      userMessage?.toLowerCase().includes('build the site') ||
      userMessage?.toLowerCase().includes('create it') ||
      userMessage?.toLowerCase().includes('go ahead') ||
      userMessage?.toLowerCase().includes('approved') ||
      userMessage?.toLowerCase().includes('do it')

    return NextResponse.json({
      aiResponse,
      conversationHistory: updatedHistory,
      readyToGenerate,
      suggestedActions: readyToGenerate 
        ? ['Generate Website', 'Make More Changes']
        : ['Continue Conversation', 'Start Over']
    })

  } catch (error) {
    console.error('Planning conversation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Planning failed' },
      { status: 500 }
    )
  }
}










