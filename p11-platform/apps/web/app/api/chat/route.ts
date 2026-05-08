import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';
import OpenAI from 'openai';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { getPropertyTypeConfig } from '@/utils/property-types';
import { buildRagContext, fetchKeywordFallbackDocuments, type RagDocument } from '@/utils/chat-rag';

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

    // 4. Generate Embedding for User Query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: lastMessage,
    });
    const embedding = embeddingResponse.data[0].embedding;

    // 5. Search Knowledge Base (Supabase Vector)
    const { data: documents, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: embedding as unknown as string,
      match_threshold: 0.5,
      match_count: 3,
      filter_property: propertyId
    });

    if (matchError) {
      console.error('Vector search error:', matchError);
      return NextResponse.json({ 
        role: 'assistant', 
        content: "I'm having trouble accessing my knowledge base right now. Please try again.",
        conversationId: activeConversationId,
      });
    }

    // 6. Construct Context for LLM
    const vectorDocuments = (Array.isArray(documents) ? documents : []) as RagDocument[];
    const keywordDocuments = await fetchKeywordFallbackDocuments(
      supabase,
      propertyId,
      lastMessage,
      vectorDocuments,
      Math.max(0, 5 - vectorDocuments.length)
    );
    const contextText = buildRagContext([...vectorDocuments, ...keywordDocuments]) || "No specific documents found.";
    
    const systemPrompt = `You are Luma, a helpful AI assistant for ${propertyName}.

PROPERTY CONTEXT:
- Property name: ${propertyName}
- Property type: ${propertyTypeConfig.label}
- Category: ${propertyTypeConfig.isForSaleResidential ? 'for-sale residential' : 'rental residential'}
    
    CONTEXT FROM KNOWLEDGE BASE:
    ${contextText}
    
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
    
    RESPONSE GUIDELINES:
    - Answer questions based ONLY on the context provided
    - Pricing, rents, deposits, availability, bedroom counts, floor plans, home plans, and unit types are high-risk facts. Only state them when they appear in the context for ${propertyName}.
    - If the context does not include current pricing or availability, say you do not have that specific information handy and offer to have the team follow up.
    - Never reuse pricing, floor plan names, unit types, amenities, specials, or availability from another property or from examples.
    - If the answer is not in the context, say "I don't have that information handy, but I'd be happy to have someone from our team follow up with you!"
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
