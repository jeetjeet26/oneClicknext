import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';
import OpenAI from 'openai';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { getPropertyTypeConfig } from '@/utils/property-types';
import { buildPropertyOnlyResponse, isPropertyChatInScope } from '@/utils/chat-scope';
import { loadPropertyChatbotContext } from '@/utils/services/chatbot-context-editor';

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabaseAuth = await createClient();
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messages, propertyId, conversationId, isHumanMessage } = await req.json();

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const messageList = Array.isArray(messages) ? messages : [];
    const last = messageList[messageList.length - 1];
    if (!last || typeof last.content !== 'string') {
      return NextResponse.json({ error: 'messages are required' }, { status: 400 });
    }
    const lastMessage = last.content;

    // 1. Initialize Clients
    const supabase = createServiceClient();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { data: property } = await supabase
      .from('properties')
      .select('id, name, property_type')
      .eq('id', propertyId)
      .single();

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const propertyTypeConfig = getPropertyTypeConfig(property.property_type);
    const propertyName = property.name || 'this property';

    // 2. Get or create conversation
    let activeConversationId = conversationId;
    
    if (!activeConversationId) {
      const userEmail = typeof user.email === 'string' ? user.email : null;
      if (!userEmail) {
        return NextResponse.json({ error: 'User email is required' }, { status: 400 });
      }

      // Reuse an existing property lead if one already exists for this user.
      let leadId: string | null = null;

      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('property_id', propertyId)
        .eq('email', userEmail)
        .single();
      
      if (existingLead) {
        leadId = existingLead.id;
      }

      // Create new conversation
      const { data: newConversation } = await supabase
        .from('conversations')
        .insert({
          property_id: propertyId,
          lead_id: leadId,
          channel: 'chat',
        })
        .select('id')
        .single();
      
      activeConversationId = newConversation?.id;
    }

    // 3. Validate conversation ownership and human-mode state before writing messages.
    if (activeConversationId) {
      const { data: convState } = await supabase
        .from('conversations')
        .select('is_human_mode, property_id')
        .eq('id', activeConversationId)
        .single();

      if (!convState || convState.property_id !== propertyId) {
        return NextResponse.json({ error: 'Invalid conversationId for this property' }, { status: 400 });
      }

      await supabase.from('messages').insert({
        conversation_id: activeConversationId,
        role: isHumanMessage ? 'assistant' : 'user',
        content: lastMessage,
      });
      
      // If in human mode and this is from a user (not agent), just save message, no AI response
      if (convState?.is_human_mode && !isHumanMessage) {
        return NextResponse.json({ 
          role: 'assistant', 
          content: null, // No AI response in human mode
          conversationId: activeConversationId,
          isHumanMode: true,
          waitingForHuman: true,
        });
      }
      
      // If this is a human agent message, just save and return
      if (isHumanMessage) {
        return NextResponse.json({
          role: 'assistant',
          content: lastMessage,
          conversationId: activeConversationId,
          isHumanMode: true,
          fromAgent: true,
        });
      }
    }

    if (!isPropertyChatInScope(lastMessage)) {
      const reply = buildPropertyOnlyResponse(propertyName);
      if (activeConversationId) {
        await supabase.from('messages').insert({
          conversation_id: activeConversationId,
          role: 'assistant',
          content: reply,
        });
      }

      return NextResponse.json({
        role: 'assistant',
        content: reply,
        conversationId: activeConversationId,
      });
    }

    const generatedContext = await loadPropertyChatbotContext(supabase, propertyId);
    if (!generatedContext) {
      const reply = `I'm still getting ${propertyName}'s property information ready. I can have someone from our team follow up with you about that.`;
      if (activeConversationId) {
        await supabase.from('messages').insert({
          conversation_id: activeConversationId,
          role: 'assistant',
          content: reply,
        });
      }

      return NextResponse.json({
        role: 'assistant',
        content: reply,
        conversationId: activeConversationId,
      });
    }
    
    const systemPrompt = `You are Luma, a helpful AI assistant for ${propertyName}.

PROPERTY CONTEXT:
- Property name: ${propertyName}
- Property type: ${propertyTypeConfig.label}
- Category: ${propertyTypeConfig.isForSaleResidential ? 'for-sale residential' : 'rental residential'}
    
    CLIENT CHATBOT CONTEXT:
    ${generatedContext.contextMarkdown}
    
    FORMATTING RULES (CRITICAL):
    - NEVER use markdown formatting (**, *, -, #, bullets) in your responses
    - Present information in clean, natural sentences or simple paragraphs
    - Do not use example prices, example floor plans, or sample unit names
    - Keep numbers clean without markdown formatting
    - Your response should read like a text message conversation
    
    CUSTOMER SERVICE EXCELLENCE:
    - Listen carefully and answer the specific question asked
    - Anticipate needs and offer relevant next steps
    - Be empathetic and acknowledge their concerns
    - Build rapport through personalized, conversational responses
    - If they express urgency (moving soon, need info quickly), prioritize accordingly
    - Always end with an invitation for more questions or next action

    CONCIERGE RESPONSE STYLE:
    - Speak like a professional property manager or leasing concierge, not like a database report.
    - For broad prompts like "pricing", "floor plans", "availability", or "what do you have", do NOT list every floor plan/unit. Give a concise overview by home size or price range, then ask a helpful qualifying question such as preferred bedrooms, budget, move-in timing, or tour interest.
    - Only provide a full itemized list if the user explicitly asks for all floor plans, all pricing, a complete list, or a specific bedroom category.
    - Lead with the most useful summary first, then offer to narrow the options.
    - Keep the customer experience warm, polished, and easy to act on.
    
    RESPONSE GUIDELINES:
    - Answer questions based ONLY on the context provided
    - Pricing, rents, deposits, availability, bedroom counts, floor plans, home plans, and unit types are high-risk facts. Only state them when they appear in the context for ${propertyName}.
    - If the context does not include current pricing or availability, say you do not have that specific information handy and offer to have the team follow up.
    - Never reuse pricing, floor plan names, unit types, amenities, specials, or availability from another property or from examples.
    - If the answer is not in the context, say "I don't have that information handy, but I'd be happy to have someone from our team follow up with you!"
    - Do not answer unrelated general questions, including math, coding, recipes, trivia, news, or personal advice. Redirect them to property-related questions.
    - Be warm, professional, and concise (under 150 words unless detailed info requested)
    - Do not make up facts or speculate
    - If asked about tours, be helpful and guide them toward booking
    - Match their communication style: formal → professional, casual → friendly
    `;

    // 7. Generate Response (GPT-4o-mini)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messageList.map((m: { role: string; content: string }) => ({ 
          role: m.role as 'user' | 'assistant', 
          content: m.content 
        }))
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const reply = completion.choices[0].message.content || "I'm sorry, I couldn't generate a response.";

    // 8. Save assistant message to database
    if (activeConversationId) {
      await supabase.from('messages').insert({
        conversation_id: activeConversationId,
        role: 'assistant',
        content: reply,
      });
    }

    return NextResponse.json({ 
      role: 'assistant', 
      content: reply,
      conversationId: activeConversationId,
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ 
      role: 'assistant', 
      content: "I'm sorry, I encountered an error processing your request." 
    }, { status: 500 });
  }
}
