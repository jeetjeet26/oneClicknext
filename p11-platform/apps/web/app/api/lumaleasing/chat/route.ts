import { buildPropertyOnlyResponse,containsContactInfo,detectTourIntent,detectTourOffer,isPropertyChatInScope,stripMarkdownFormatting } from '@/utils/chat-scope';
import { getPropertyTypeConfig } from '@/utils/property-types';
import { badRequest,buildCorsHeaders,corsPreflightResponse,rateLimited,serverError } from '@/utils/services/api-helpers';
import { auditLog,getRequestIp } from '@/utils/services/audit-logger';
import { loadPropertyChatbotContext } from '@/utils/services/chatbot-context-editor';
import { upsertLeadByContact } from '@/utils/services/lead-upsert';
import { budgetedLumaCompletion } from '@/utils/services/luma-ai-budget';
import { linkLumaVisitorLead,saveLumaMessage,withLumaRequest } from '@/utils/services/luma-requests';
import { chatLimiter,getRateLimitKey,rateLimitHeaders } from '@/utils/services/rate-limiter';
import { createRequestContext } from '@/utils/services/request-context';
import { chatRequestSchema,validateBody } from '@/utils/services/validation';
import { isWidgetSessionExpired } from '@/utils/services/widget-session';
import { createServiceClient } from '@/utils/supabase/admin';
import { NextRequest,NextResponse } from 'next/server';
import OpenAI from 'openai';

// Type for extracted conversation data
interface ExtractedData {
  lead: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  tour: {
    requested: boolean;
    date: string | null; // ISO date string
    time: string | null; // HH:MM format
    notes: string | null;
  } | null;
}

type RecentMessageRow = {
  role: string | null
  content: string | null
  created_at: string | null
}

type DuplicateReplyResult = {
  assistantReply: string
}

async function incrementSessionMessageCount(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string
): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current } = await supabase
      .from('widget_sessions')
      .select('message_count')
      .eq('id', sessionId)
      .single();

    const currentCount = current?.message_count || 0;
    const { data: updated, error } = await supabase
      .from('widget_sessions')
      .update({
        last_activity_at: new Date().toISOString(),
        message_count: currentCount + 1
      })
      .eq('id', sessionId)
      .eq('message_count', currentCount)
      .select('message_count')
      .single();

    if (!error && updated) {
      return updated.message_count as number;
    }
  }

  await supabase
    .from('widget_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', sessionId);
  return null;
}

function findRecentDuplicateReply(
  recentMessages: RecentMessageRow[],
  userMessage: string
): DuplicateReplyResult | null {
  try {
    const nowMs = Date.now()

    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
      const row = recentMessages[index]
      if (row.role !== 'user' || row.content !== userMessage || !row.created_at) {
        continue
      }

      const createdMs = Date.parse(row.created_at)
      if (!Number.isFinite(createdMs) || nowMs - createdMs > 2 * 60 * 1000) {
        continue
      }

      for (let replyIndex = index + 1; replyIndex < recentMessages.length; replyIndex += 1) {
        const replyRow = recentMessages[replyIndex]
        if (replyRow.role === 'assistant' && typeof replyRow.content === 'string' && replyRow.content) {
          return { assistantReply: replyRow.content }
        }
      }
    }
  } catch (error) {
    console.error('[LumaLeasing] Duplicate reply lookup failed:', error)
  }

  return null
}

async function loadTrustedConversationHistory(
  supabase: ReturnType<typeof createServiceClient>,
  conversationId: string
): Promise<RecentMessageRow[]> {
  try {
    const messagesTable = supabase.from('messages') as unknown as {
      select?: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (count: number) => Promise<{ data: unknown[] | null; error: unknown }>
          }
        }
      }
    }
    if (typeof messagesTable.select !== 'function') return []

    const { data, error } = await messagesTable
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12)

    if (error || !data) throw new Error('Could not load saved conversation history')
    return (data as RecentMessageRow[])
      .filter(row => (
        (row.role === 'user' || row.role === 'assistant') &&
        typeof row.content === 'string' &&
        row.content.length > 0
      ))
      .slice()
      .reverse()
  } catch (error) {
    throw error
  }
}

// LLM-based extraction of lead info and tour requests from conversation
async function extractAndProcessConversation(
  openai: OpenAI,
  supabase: ReturnType<typeof createServiceClient>,
  messages: Array<{ role: string; content: string }>,
  propertyId: string,
  sessionId: string | null,
  conversationId: string | null,
  existingLeadId: string | null,
  modeRevision: number,

): Promise<void> {
  // Low-PII trace; conversation content is intentionally excluded.
  console.log('[LumaLeasing] extraction_started', {
    propertyId,
    sessionId,
    conversationId,
    messageCount: messages.length,
  });
  
  // Build conversation text for analysis
  const conversationText = messages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n').slice(-6000);

  // Extract structured data using LLM
  const extractionPrompt = `Analyze this conversation and extract any contact information and tour booking requests.

CONVERSATION:
${conversationText}

Extract the following if mentioned by the USER (not the assistant):
1. Lead contact info: first name, last name, email, phone number
2. Tour request: whether they want a tour, preferred date, preferred time, any special notes

IMPORTANT:
- Only extract info explicitly provided by the user
- For dates, convert relative dates (like "tomorrow", "next Monday") to actual dates based on today being ${new Date().toISOString().split('T')[0]}
- For times, use 24-hour format (HH:MM)
- If info is not provided, use null

Respond with ONLY valid JSON in this exact format:
{
  "lead": {
    "first_name": "string or null",
    "last_name": "string or null", 
    "email": "string or null",
    "phone": "string or null"
  },
  "tour": {
    "requested": true/false,
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "notes": "string or null"
  }
}`;

  try {
    const extraction = await budgetedLumaCompletion(openai, supabase, propertyId, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 500,
    }, 'extraction', {conversationId,modeRevision});

    const rawJson = extraction.choices[0].message.content;
    if (!rawJson) throw new Error('The retained contact extraction returned no usable result.');

    const data: ExtractedData = JSON.parse(rawJson);
    // Avoid logging extracted PII (name/email/phone/notes). Capture only
    // structured presence flags so we keep observability without leaking
    // contact data into shared log sinks.
    console.log('[LumaLeasing] extraction_result', {
      propertyId,
      hasLead: Boolean(data.lead),
      hasEmail: Boolean(data.lead?.email),
      hasPhone: Boolean(data.lead?.phone),
      hasFirstName: Boolean(data.lead?.first_name),
      tourRequested: Boolean(data.tour?.requested),
      hasTourDate: Boolean(data.tour?.date),
      hasTourTime: Boolean(data.tour?.time),
    });

    // Generate conversation summary for lead notes
    const summaryPrompt = `Summarize this conversation in 2-3 concise sentences for a CRM note. Focus on:
- What the prospect is interested in (unit types, amenities, etc.)
- Their timeline/urgency
- Any specific questions or concerns
- Tour preferences if mentioned

CONVERSATION:
${conversationText}

Write a professional CRM note (no bullet points, just flowing text):`;

    const summaryResponse = await budgetedLumaCompletion(openai, supabase, propertyId, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.3,
      max_tokens: 150,
    }, 'summary', {conversationId,modeRevision});

    const conversationSummary = summaryResponse.choices[0].message.content?.trim() || null;

    // Process lead info if we found new contact data
    let leadId = existingLeadId;
    const leadData = data.lead;

    if (leadData && (leadData.email || leadData.phone)) {
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const leadNotes = conversationSummary
        ? `[${timestamp}] ${conversationSummary}`
        : 'Initial contact via LumaLeasing widget';
      const leadResult = await upsertLeadByContact({
        client: supabase,
        propertyId,
        existingLeadId: leadId,
        email: leadData.email,
        phone: leadData.phone,
        create: {
          first_name: leadData.first_name || '',
          last_name: leadData.last_name || '',
          email: leadData.email || '',
          phone: leadData.phone || '',
          source: 'LumaLeasing Widget',
          status: 'new',
          notes: leadNotes,
        },
        update: {
          ...(leadData.first_name ? { first_name: leadData.first_name } : {}),
          ...(leadData.last_name ? { last_name: leadData.last_name } : {}),
          ...(leadData.email ? { email: leadData.email } : {}),
          ...(leadData.phone ? { phone: leadData.phone } : {}),
          ...(conversationSummary ? { notes: conversationSummary } : {}),
        },
        repeatActivity: {
          description: `Returned via LumaLeasing Chat: ${
            conversationSummary || 'Updated contact information'
          }`,
          metadata: {
            source: 'lumaleasing_chat_extraction',
            conversationSummary,
          },
        },
      });
      leadId = leadResult.leadId;

      if (leadResult.isExisting) {
        console.log('[LumaLeasing] lead_updated', { leadId });
      } else {
        console.log('[LumaLeasing] lead_created', { leadId, propertyId });


      }


    }

    if (leadId && !existingLeadId) {
      await linkLumaVisitorLead(supabase,propertyId,leadId,sessionId,conversationId);
    }

    // Tour intent is shown as a visitor-confirmed scheduling CTA. Extracted
    // relative dates or an inferred default time must not create a reservation.
  } catch (error) {
    console.error('[LumaLeasing] Extraction failed:', error);
    throw error;
  }
}

function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key');
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const authKey = authHeader?.replace(/^Bearer\s+/i, '');
  const urlKey = new URL(req.url).searchParams.get('apiKey') || new URL(req.url).searchParams.get('api_key');

  const raw = headerKey || authKey || urlKey;
  if (!raw) return null;

  const normalized = raw.trim();
  return normalized.length ? normalized : null;
}

// Handle CORS preflight — origin-restricted in production
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return corsPreflightResponse(origin, 'POST, OPTIONS')
}

export async function POST(req: NextRequest) {
  return withLumaRequest(req, 'chat', handlePost)
}

async function handlePost(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/chat')
  ctx.logStart()
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'POST, OPTIONS')
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }

  try {
    // Rate limit — 20 requests/minute per IP (protects OpenAI spend)
    const rlKey = getRateLimitKey(req, 'chat')
    const rl = chatLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'lumaleasing/chat' })
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = extractApiKey(req);
    const visitorId = req.headers.get('X-Visitor-ID');

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    // Validate input with Zod
    const rawBody = await req.json();
    const validation = validateBody(rawBody, chatRequestSchema);
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return badRequest(validation.error, responseHeaders);
    }

    const { messages, sessionId, leadInfo } = validation.data;

    const lastMessage = messages[0]?.content;
    if (!lastMessage) {
      ctx.logSuccess(400, { reason: 'missing_message' })
      return NextResponse.json(
        { error: 'Message required' },
        { status: 400, headers: responseHeaders }
      );
    }

    const supabase = createServiceClient();


    // 1. Validate API key and get config
    const { data: config, error: configError } = await supabase
      .from('lumaleasing_config')
      // Avoid !inner join so an orphaned config row doesn't look like "invalid key"
      .select('*, properties(id, name, address, settings, property_type)')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      // This is the error users see in WordPress; log details for Vercel runtime logs.
      ctx.logError(401, configError || 'Missing config', {
        operation: 'validate_luma_api_key',
        hasConfig: Boolean(config),
        hasConfigError: Boolean(configError),
      });
      return NextResponse.json(
        { error: 'Invalid or inactive API key' },
        { status: 401, headers: responseHeaders }
      );
    }

    const propertyId = config.property_id;
    if (!propertyId) {
      ctx.logSuccess(404, { reason: 'property_not_found' })
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: responseHeaders }
      );
    }
    const propertyName = config.properties?.name || 'our community';
    const propertyTypeConfig = getPropertyTypeConfig(config.properties?.property_type);

    // 2. Get or create widget session
    let activeSessionId: string | null = sessionId || null;
    let widgetSession: { id?: string; lead_id?: string | null; message_count?: number | null } | null = null;

    if (activeSessionId) {
      const { data: existingSession, error: sessionError } = await supabase
        .from('widget_sessions')
        .select('*')
        .eq('id', activeSessionId)
        .eq('property_id', propertyId)
        .maybeSingle();
      
      if (sessionError) throw sessionError;
      widgetSession = existingSession;

      if (!widgetSession) {
        ctx.logSuccess(404, { reason: 'invalid_session_id', sessionId: activeSessionId, propertyId })
        return NextResponse.json({ error: 'Session not found', code: 'invalid_widget_session' }, { status: 404, headers: responseHeaders });
      }
      if (isWidgetSessionExpired(existingSession!)) {
        return NextResponse.json({ error: 'Session expired', code: 'session_expired' }, { status: 410, headers: responseHeaders });
      }
    }

    if (!widgetSession) {
      // Create new session
      const { data: newSession, error: newSessionError } = await supabase
        .from('widget_sessions')
        .insert({
          property_id: propertyId,
          visitor_id: visitorId || crypto.randomUUID(),
          user_agent: req.headers.get('user-agent'),
          referrer_url: req.headers.get('referer'),
        })
        .select()
        .single();
      
      if (newSessionError || !newSession?.id) throw new Error('Could not confirm the new widget session');
      widgetSession = newSession;
      activeSessionId = newSession?.id || null;
    }

    // 3. Handle lead capture if info provided
    let leadId: string | null = widgetSession?.lead_id ?? null;

    if (leadInfo) {
      const directLeadResult = await upsertLeadByContact({
        client: supabase,
        propertyId,
        existingLeadId: leadId,
        email: leadInfo.email,
        phone: leadInfo.phone,
        create: {
          first_name: leadInfo.first_name || '',
          last_name: leadInfo.last_name || '',
          email: leadInfo.email || '',
          phone: leadInfo.phone || '',
          source: 'LumaLeasing Widget',
          status: 'new',
        },
        update: {
          ...(leadInfo.first_name ? { first_name: leadInfo.first_name } : {}),
          ...(leadInfo.last_name ? { last_name: leadInfo.last_name } : {}),
          ...(leadInfo.email ? { email: leadInfo.email } : {}),
          ...(leadInfo.phone ? { phone: leadInfo.phone } : {}),
        },
        repeatActivity: {
          description: 'Returned via LumaLeasing Chat: Updated contact information',
          metadata: { source: 'lumaleasing_chat' },
        },
      });
      leadId = directLeadResult.leadId;

      if (leadId && activeSessionId) {
        await linkLumaVisitorLead(supabase,propertyId,leadId,activeSessionId,null);
      }
    }

    // 4. Get or create conversation
    let conversationId: string | null = null;
    let trustedHistory: RecentMessageRow[] = [];

    if (widgetSession && activeSessionId) {
      // Check for existing conversation
      const { data: existingConv, error: conversationError } = await supabase
        .from('conversations')
        .select('id, is_human_mode')
        .eq('widget_session_id', activeSessionId)
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conversationError) throw conversationError;

      if (existingConv) {
        conversationId = existingConv.id;

        // If in human mode, save message but don't generate AI response
        if (existingConv.is_human_mode) {
          await saveLumaMessage(supabase,propertyId,conversationId,'user',lastMessage);

          // Update session activity
          if (activeSessionId) {
            await incrementSessionMessageCount(supabase, activeSessionId);
          }

          ctx.logSuccess(200, {
            conversationId,
            sessionId: activeSessionId,
            humanMode: true,
          })
          return NextResponse.json({
            content: null,
            sessionId: activeSessionId,
            conversationId,
            isHumanMode: true,
            waitingForHuman: true,
          }, { headers: responseHeaders });
        }
      } else {
        // Create new conversation
        const { data: newConv, error: newConversationError } = await supabase
          .from('conversations')
          .insert({
            property_id: propertyId,
            lead_id: leadId,
            widget_session_id: activeSessionId,
            channel: 'widget',
          })
          .select('id')
          .single();

        if (newConversationError || !newConv?.id) throw new Error('Could not confirm the new conversation');
        conversationId = newConv.id;
      }
    }

    if (conversationId) {
      trustedHistory = await loadTrustedConversationHistory(supabase, conversationId)
    }

    // 5. Save user message
    if (conversationId) {
      const duplicateReply = validation.data.requestId ? null : findRecentDuplicateReply(trustedHistory, lastMessage)
      if (duplicateReply) {
        const messageCount = widgetSession?.message_count || 0
        const shouldPromptLeadCapture = !leadId && config.collect_email && messageCount >= 3

        ctx.logSuccess(200, {
          conversationId,
          sessionId: activeSessionId,
          hasLeadId: !!leadId,
          retryDuplicateSuppressed: true,
        })

        return NextResponse.json(
          {
            content: duplicateReply.assistantReply,
            sessionId: activeSessionId,
            conversationId,
            shouldPromptLeadCapture,
            leadCapturePrompt: shouldPromptLeadCapture ? config.lead_capture_prompt : null,
            wantsTour: false,
            duplicate: true,
          },
          { headers: responseHeaders }
        )
      }
    }

    let modeRevision:number|undefined;
    if (conversationId) {
      const saved=await saveLumaMessage(supabase, propertyId, conversationId, 'user', lastMessage);
      modeRevision=saved.modeRevision;
      if(saved.human)return NextResponse.json({content:null,sessionId:activeSessionId,conversationId,isHumanMode:true,waitingForHuman:true},{headers:responseHeaders});
    }

    const trustedMessages = [
      ...trustedHistory.map(message => ({
        role: message.role as 'user' | 'assistant',
        content: message.content as string,
      })),
      { role: 'user' as const, content: lastMessage },
    ]

    if (!isPropertyChatInScope(lastMessage, propertyName)) {
      const reply = buildPropertyOnlyResponse(propertyName);
      if (conversationId) {
        const saved = await saveLumaMessage(supabase, propertyId, conversationId, 'assistant', reply, modeRevision);
        if (saved.human||saved.stale) return NextResponse.json({content:null,sessionId:activeSessionId,conversationId,isHumanMode:saved.human,waitingForHuman:saved.human,responseSuperseded:!!saved.stale},{headers:responseHeaders});
      }

      const messageCount = activeSessionId
        ? await incrementSessionMessageCount(supabase, activeSessionId)
        : widgetSession?.message_count ?? null;
      const shouldPromptLeadCapture = !leadId && config.collect_email && (messageCount ?? widgetSession?.message_count ?? 0) >= 3;

      ctx.logSuccess(200, {
        conversationId,
        sessionId: activeSessionId,
        hasLeadId: !!leadId,
        outOfScope: true,
      })

      return NextResponse.json({
        content: reply,
        sessionId: activeSessionId,
        conversationId,
        shouldPromptLeadCapture,
        leadCapturePrompt: shouldPromptLeadCapture ? config.lead_capture_prompt : null,
        wantsTour: false,
      }, { headers: responseHeaders });
    }

    const generatedContext = await loadPropertyChatbotContext(supabase, propertyId);

    if (!generatedContext) {
      const reply = `I'm still getting ${propertyName}'s property information ready. I can have someone from our team follow up with you about that.`;
      if (conversationId) {
        const saved = await saveLumaMessage(supabase, propertyId, conversationId, 'assistant', reply, modeRevision);
        if (saved.human||saved.stale) return NextResponse.json({content:null,sessionId:activeSessionId,conversationId,isHumanMode:saved.human,waitingForHuman:saved.human,responseSuperseded:!!saved.stale},{headers:responseHeaders});
      }

      const messageCount = activeSessionId
        ? await incrementSessionMessageCount(supabase, activeSessionId)
        : widgetSession?.message_count ?? null;
      const shouldPromptLeadCapture = !leadId && config.collect_email && (messageCount ?? widgetSession?.message_count ?? 0) >= 3;

      ctx.logSuccess(200, {
        conversationId,
        sessionId: activeSessionId,
        hasLeadId: !!leadId,
        missingGeneratedContext: true,
      })

      return NextResponse.json({
        content: reply,
        sessionId: activeSessionId,
        conversationId,
        shouldPromptLeadCapture,
        leadCapturePrompt: shouldPromptLeadCapture ? config.lead_capture_prompt : null,
        wantsTour: false,
      }, { headers: responseHeaders });
    }

    if (generatedContext.servingMode === 'degraded') {
      const reply = `${propertyName}'s latest property details are being reviewed. I can have someone from the team follow up with verified information.`;
      if (conversationId) {
        const saved = await saveLumaMessage(supabase, propertyId, conversationId, 'assistant', reply, modeRevision);
        if (saved.human||saved.stale) return NextResponse.json({content:null,sessionId:activeSessionId,conversationId,isHumanMode:saved.human,waitingForHuman:saved.human,responseSuperseded:!!saved.stale},{headers:responseHeaders});
      }
      const messageCount = activeSessionId
        ? await incrementSessionMessageCount(supabase, activeSessionId)
        : widgetSession?.message_count ?? null;
      ctx.logSuccess(200, {
        conversationId,
        sessionId: activeSessionId,
        degradedContext: true,
      })
      return NextResponse.json({
        content: reply,
        sessionId: activeSessionId,
        conversationId,
        shouldPromptLeadCapture: !leadId && config.collect_email && (messageCount ?? 0) >= 3,
        leadCapturePrompt: null,
        wantsTour: false,
      }, { headers: responseHeaders });
    }

    // 6. Detect intent for tour booking. Affirmative or scheduling follow-ups
    // ("I would love to", "is there availability next week?") count when the
    // assistant's previous message brought up a tour.
    const previousAssistantMessage = [...trustedMessages]
      .slice(0, -1)
      .reverse()
      .find((m: { role: string; content: string }) => m.role === 'assistant')?.content ?? null;
    const wantsTour = detectTourIntent(lastMessage, previousAssistantMessage);

    // Detect contact info in the latest message so the model acknowledges it
    // instead of claiming it cannot accept personal details.
    const sharedContactInfo = containsContactInfo(lastMessage);

    // 7. Build system prompt
    const systemPrompt = `You are ${config.widget_name || 'Luma'}, a friendly AI assistant for ${propertyName}.

PROPERTY CONTEXT:
- Property name: ${propertyName}
- Property type: ${propertyTypeConfig.label}
- Category: ${propertyTypeConfig.isForSaleResidential ? 'for-sale residential' : 'rental residential'}

PERSONALITY:
- Warm, helpful, and professional
- Conversational but concise
- Enthusiastic about the property without being pushy
- Use emoji sparingly (1-2 max per response)

KNOWLEDGE BASE:
${generatedContext.contextMarkdown}

FORMATTING RULES (CRITICAL):
1. NEVER use markdown formatting (**, *, -, #) in your responses
2. Present information in clean, natural sentences or simple paragraphs
3. Do not use example prices, example floor plans, sample unit names, or placeholder availability
4. For multiple items, use natural language: "We offer A, B, and C" instead of bullet lists
5. Keep numbers clean without markdown formatting
6. Your response should read like a text message, not a formatted document

CUSTOMER SERVICE EXCELLENCE:
- Listen carefully and answer the specific question asked
- Anticipate follow-up questions and offer relevant next steps
- Be empathetic and acknowledge their needs/concerns
- Build rapport through personalized, conversational responses
- If they express urgency, prioritize their request
- Always end with an invitation for more questions or action (tour, call, etc.)

CONCIERGE RESPONSE STYLE:
- Speak like a professional property manager or leasing concierge, not like a database report.
- For broad prompts like "pricing", "floor plans", "availability", or "what do you have", do NOT list every floor plan/unit. Give a concise overview by home size or price range, then ask a helpful qualifying question such as preferred bedrooms, budget, move-in timing, or tour interest.
- Only provide a full itemized list if the user explicitly asks for all floor plans, all pricing, a complete list, or a specific bedroom category.
- Lead with the most useful summary first, then offer to narrow the options.
- Keep the customer experience warm, polished, and easy to act on.

${config.floor_plans_url || config.availability_url ? `
PROPERTY LINKS:
${config.floor_plans_url ? `- Floor plans page: ${config.floor_plans_url}` : ''}
${config.availability_url ? `- Availability page: ${config.availability_url}` : ''}
- When the visitor asks about floor plans, layouts, or a specific plan, include the floor plans page link in your reply so they can explore the plans.
- When the visitor asks about availability, available homes, homesites, current pricing, or move-in dates, include the availability page link in your reply.
- Share links as plain URLs in a natural sentence, for example "You can browse all the floor plans here: <link>". Never use markdown link syntax.
- Only share these exact links. Never invent or guess other URLs.
` : ''}

CONTACT INFO HANDLING (CRITICAL):
- Contact-save status for this turn: ${leadId ? "saved for the property team" : "not yet confirmed"}. Never claim that information was saved or sent unless this status confirms it.
- Thank visitors for contact details. Do not promise a follow-up, email, calendar event or confirmed tour. Use the scheduling button for explicit reservations.
- NEVER say you cannot collect, store, accept, or process contact information. The platform handles that for you, so refusing is incorrect and confuses visitors.

RESPONSE GUIDELINES:
1. Answer questions based ONLY on the knowledge base above
2. Pricing, rents, deposits, availability, bedroom counts, floor plans, home plans, and unit types are high-risk facts. Only state them when they appear in the knowledge base for ${propertyName}.
3. If info isn't available, say "I don't have that specific information, but I'd be happy to have someone from our team follow up with you!"
4. Never reuse pricing, floor plan names, unit types, amenities, specials, or availability from another property or from examples.
5. Keep responses under 150 words unless detailed info is requested
6. Be proactive: suggest tours, mention specials, highlight unique features
7. Match their energy: formal inquiry → professional tone, casual chat → friendly tone
8. Do not answer unrelated general questions, including math, coding, recipes, trivia, news, or personal advice. Redirect them to property-related questions.

${wantsTour ? `
TOUR BOOKING:
The user seems interested in scheduling a tour! Be enthusiastic and ask:
- What day/time works best for them
- If they have any specific things they'd like to see
Let them know you can help them book a tour.
` : ''}

${sharedContactInfo ? `
CONTACT INFO JUST SHARED:
The visitor's most recent message includes their contact details. ${leadId ? "Contact details are saved for the property team." : "Contact saving is not yet confirmed."} Thank them warmly and continue answering their property question. Do not promise delivery or a response time.
` : ''}

${leadId ? `
LEAD STATUS:
This visitor's contact info is already saved and the team can follow up. Do not ask for their contact details again.
` : `
LEAD CAPTURE:
The platform automatically shows a contact-info request at the right moment and saves anything the visitor shares, so do not proactively ask for their name, email, or phone yourself. If the visitor wants follow-up from the team, invite them to share their contact details right here in the chat.
`}

Remember: You represent ${propertyName}. Provide exceptional customer service with clean, human-friendly responses!`;

    if (!conversationId || modeRevision === undefined) throw new Error('Conversation authority could not be confirmed.');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25000, maxRetries: 0 });

    // 10. Generate AI response
    const completion = await budgetedLumaCompletion(openai, supabase, propertyId, {
      model: 'gpt-4o-mini',
      messages: (() => {
        const recent = trustedMessages.slice(-10).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        while (recent.reduce((sum, m) => sum + m.content.length, 0) > 6000 && recent.length > 1) {
          recent.shift();
        }
        return [
        { role: 'system', content: systemPrompt.slice(0, 24000) },
          ...recent,
        ];
      })(),
      temperature: 0.7,
      max_tokens: 400,
    }, 'answer', {conversationId,modeRevision,assistantContext:generatedContext});

    // Deterministic backstop: the model sometimes ignores the prompt's
    // no-markdown rule, and the widget renders plain text.
    const reply = stripMarkdownFormatting(
      completion.choices[0].message.content || "I'm sorry, I couldn't generate a response. Please try again!"
    );

    // 11. Save AI response
    if (conversationId) {
      const saved = await saveLumaMessage(supabase, propertyId, conversationId, 'assistant', reply, modeRevision);
        if (saved.human||saved.stale) return NextResponse.json({content:null,sessionId:activeSessionId,conversationId,isHumanMode:saved.human,waitingForHuman:saved.human,responseSuperseded:!!saved.stale},{headers:responseHeaders});
    }

    // 12. LLM-based extraction of lead info and tour requests
    // Must await in serverless environment or it may not complete
    let extractionRan = false;
    let extractionError = null;
    const priorCount = widgetSession?.message_count || 0;
    // Run extraction when the widget pre-extracted contact info, when the
    // latest message itself contains contact details, or every 3rd message.
    const extractionDue =
      Boolean(leadInfo?.email || leadInfo?.phone) ||
      sharedContactInfo ||
      ((priorCount + 1) % 3 === 0);
    try {
      if (extractionDue) {
        await extractAndProcessConversation(
          openai,
          supabase,
          trustedMessages,
          propertyId,
          activeSessionId ? activeSessionId : null,
          conversationId,
          leadId,
          modeRevision,
        );
        extractionRan = true;
        console.log('[LumaLeasing] Extraction completed successfully');
      }
    } catch (err) {
      extractionError = err instanceof Error ? err.message : String(err);
      console.error('[LumaLeasing] Extraction error:', err);
    }

    // 13. Update session activity
    let updatedMessageCount = widgetSession?.message_count || 0;
    if (activeSessionId) {
      const incremented = await incrementSessionMessageCount(supabase, activeSessionId);
      if (typeof incremented === 'number') {
        updatedMessageCount = incremented;
      } else {
        updatedMessageCount += 1;
      }
    }

    // 14. Check if we should prompt for lead capture
    const shouldPromptLeadCapture = !leadId && 
      config.collect_email && 
      updatedMessageCount >= 3;

    // 15. Offer a schedule-a-tour button when the visitor showed tour intent
    // or the assistant's reply itself suggests touring. The widget renders a
    // pressable CTA instead of auto-opening the booking calendar.
    const tourCta = Boolean(config.tours_enabled) && (wantsTour || detectTourOffer(reply));

    ctx.logSuccess(200, {
      conversationId,
      sessionId: activeSessionId,
      hasLeadId: !!leadId,
      wantsTour,
      tourCta,
      promptedLeadCapture: shouldPromptLeadCapture,
    })
    return NextResponse.json({
      content: reply,
      sessionId: activeSessionId,
      conversationId,
      shouldPromptLeadCapture,
      leadCapturePrompt: shouldPromptLeadCapture ? config.lead_capture_prompt : null,
      wantsTour,
      tourCta,
      // Debug info only in development
      ...(process.env.NODE_ENV !== 'production' ? {
        _debug: {
          extractionRan,
          extractionError,
          hasLeadId: !!leadId,
        }
      } : {})
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'lumaleasing_chat' })
    return serverError(error, responseHeaders);
  }
}

