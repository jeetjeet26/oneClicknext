import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { syncLeadToCRM } from '@/utils/services/crm-sync';
import { startWorkflow } from '@/utils/services/workflow-processor';
import { chatLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { buildCorsHeaders, corsPreflightResponse, serverError, rateLimited, badRequest } from '@/utils/services/api-helpers';
import { validateBody, chatRequestSchema } from '@/utils/services/validation';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';
import { bookLumaLeasingTour } from '@/utils/services/lumaleasing-tour-booking';
import { trackEngagementEvent } from '@/utils/services/engagement-tracker';
import { getPropertyTypeConfig } from '@/utils/property-types';
import { buildPropertyOnlyResponse, isPropertyChatInScope } from '@/utils/chat-scope';
import { loadPropertyChatbotContext } from '@/utils/services/chatbot-context-editor';
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

function buildLeadUpdatePayload(params: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}): Record<string, string> {
  const updates: Record<string, string> = {}

  if (params.firstName) updates.first_name = params.firstName
  if (params.lastName) updates.last_name = params.lastName
  if (params.email) updates.email = params.email
  if (params.phone) updates.phone = params.phone
  if (params.notes) updates.notes = params.notes

  return updates
}

async function findExistingLeadIdByContact(
  supabase: ReturnType<typeof createServiceClient>,
  propertyId: string,
  params: {
    email?: string | null
    phone?: string | null
  }
): Promise<string | null> {
  if (params.email) {
    const { data: existingByEmail } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', propertyId)
      .eq('email', params.email)
      .limit(1)

    if (existingByEmail?.[0]?.id) {
      return existingByEmail[0].id
    }
  }

  if (params.phone) {
    const { data: existingByPhone } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', propertyId)
      .eq('phone', params.phone)
      .limit(1)

    if (existingByPhone?.[0]?.id) {
      return existingByPhone[0].id
    }
  }

  return null
}

function appendConversationSummaryIfMissing(
  currentNotes: string | null | undefined,
  conversationSummary: string | null
): string | null {
  if (!conversationSummary) {
    return currentNotes || null
  }

  if (currentNotes?.includes(conversationSummary)) {
    return currentNotes
  }

  const timestamp = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
  const newNote = `[${timestamp}] ${conversationSummary}`
  return currentNotes ? `${currentNotes}\n\n${newNote}` : newNote
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

async function findRecentDuplicateReply(
  supabase: ReturnType<typeof createServiceClient>,
  conversationId: string,
  userMessage: string
): Promise<DuplicateReplyResult | null> {
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
    if (typeof messagesTable.select !== 'function') {
      return null
    }

    const { data, error } = await messagesTable
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12)

    if (error || !data || data.length === 0) {
      return null
    }

    const nowMs = Date.now()
    const recentMessages = (data as RecentMessageRow[]).slice().reverse()

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

// LLM-based extraction of lead info and tour requests from conversation
async function extractAndProcessConversation(
  openai: OpenAI,
  supabase: ReturnType<typeof createServiceClient>,
  messages: Array<{ role: string; content: string }>,
  propertyId: string,
  sessionId: string | null,
  conversationId: string | null,
  existingLeadId: string | null,
  config: {
    properties?: { name?: string; address?: { street?: string; full?: string } } | null
    widget_name?: string | null
  }
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
    .join('\n');

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
    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const rawJson = extraction.choices[0].message.content;
    if (!rawJson) return;

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

    const summaryResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.3,
      max_tokens: 150,
    });

    const conversationSummary = summaryResponse.choices[0].message.content?.trim() || null;

    // Process lead info if we found new contact data
    let leadId = existingLeadId;
    const leadData = data.lead;

    if (leadData && (leadData.email || leadData.phone)) {
      if (!leadId) {
        leadId = await findExistingLeadIdByContact(supabase, propertyId, {
          email: leadData.email,
          phone: leadData.phone,
        })
      }

      if (leadId) {
        const updates = buildLeadUpdatePayload({
          firstName: leadData.first_name,
          lastName: leadData.last_name,
          phone: leadData.phone,
          email: leadData.email,
        })

        if (conversationSummary) {
          const { data: currentLead } = await supabase
            .from('leads')
            .select('notes')
            .eq('id', leadId)
            .single();

          const nextNotes = appendConversationSummaryIfMissing(currentLead?.notes, conversationSummary)
          if (nextNotes && nextNotes !== currentLead?.notes) {
            updates.notes = nextNotes
          }
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('leads').update(updates).eq('id', leadId);
          console.log('[LumaLeasing] lead_updated', {
            leadId,
            updatedFields: Object.keys(updates),
          });
        }
      } else {
        // Create new lead
        console.log('[LumaLeasing] creating_new_lead', {
          propertyId,
          hasEmail: Boolean(leadData.email),
          hasPhone: Boolean(leadData.phone),
          hasFirstName: Boolean(leadData.first_name),
          hasLastName: Boolean(leadData.last_name),
        });
        
        // Prepare lead notes with conversation summary
        const timestamp = new Date().toLocaleString('en-US', { 
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
        });
        const leadNotes = conversationSummary 
          ? `[${timestamp}] ${conversationSummary}`
          : 'Initial contact via LumaLeasing widget';
        
        const { data: newLead, error } = await supabase
          .from('leads')
          .insert({
            property_id: propertyId,
            first_name: leadData.first_name || '',
            last_name: leadData.last_name || '',
            email: leadData.email || '',
            phone: leadData.phone || '',
            source: 'LumaLeasing Widget',
            status: 'new',
            notes: leadNotes,
          })
          .select('id')
          .single();

        if (error) {
          console.error('[LumaLeasing] Failed to create lead:', error);
        } else if (newLead) {
          leadId = newLead.id;
          console.log('[LumaLeasing] lead_created', { leadId, propertyId });

          // Score the new lead
          try {
            const { data: scoreId } = await supabase.rpc('score_lead', { p_lead_id: leadId });
            if (scoreId) {
              // Get the score and update the lead
              const { data: scoreData } = await supabase
                .from('lead_scores')
                .select('total_score, score_bucket')
                .eq('id', scoreId)
                .single();
              
              if (scoreData) {
                await supabase
                  .from('leads')
                  .update({ 
                    score: scoreData.total_score, 
                    score_bucket: scoreData.score_bucket 
                  })
                  .eq('id', leadId);
                console.log('[LumaLeasing] lead_scored', {
                  leadId,
                  scoreBucket: scoreData.score_bucket,
                });
              }
            }
          } catch (scoreError) {
            console.error('[LumaLeasing] Failed to score lead:', scoreError);
          }

          // Sync lead to CRM (if configured)
          if (leadId) {
            try {
              const crmResult = await syncLeadToCRM(propertyId, leadId, {
                first_name: leadData.first_name || undefined,
                last_name: leadData.last_name || undefined,
                email: leadData.email || undefined,
                phone: leadData.phone || undefined,
                source: 'LumaLeasing Widget',
                status: 'new',
                notes: leadNotes,
              });
              console.log('[LumaLeasing] CRM sync result:', crmResult.action);
            } catch (crmError) {
              console.error('[LumaLeasing] CRM sync failed (non-blocking):', crmError);
              // CRM sync failures should not block the chat flow
            }
          }

          // Start follow-up workflow for new leads (non-blocking)
          if (leadId) {
            startWorkflow(leadId, propertyId, 'lead_created').catch(e =>
              console.error('[LumaLeasing Chat] Workflow start failed (non-blocking):', e)
            )
          }

          // Update session and conversation with lead
          if (sessionId) {
            const { error: sessionError } = await supabase
              .from('widget_sessions')
              .update({ lead_id: leadId, converted_at: new Date().toISOString() })
            .eq('id', sessionId)
            .eq('property_id', propertyId);
            if (sessionError) {
              console.error('[LumaLeasing] Failed to update session:', sessionError);
            } else {
              console.log('[LumaLeasing] session_lead_linked', { sessionId, leadId });
            }
          } else {
            console.warn('[LumaLeasing] No sessionId to update with lead');
          }
          if (conversationId) {
            const { error: convError } = await supabase
              .from('conversations')
              .update({ lead_id: leadId })
              .eq('id', conversationId)
              .eq('property_id', propertyId);
            if (convError) {
              console.error('[LumaLeasing] Failed to update conversation:', convError);
            }
          }
        }
      }
    }

    // Process tour request if detected with date/time. The shared booking
    // service is the single canonical write path, so chat extraction goes
    // through the same availability validation + side effects as the public
    // tours POST endpoint.
    const tourData = data.tour;
    if (tourData?.requested && tourData.date && leadId && leadData?.email) {
      const requestedTourTime = tourData.time || '10:00';
      const propertyName = config.properties?.name || 'our community';
      const propertyAddress =
        config.properties?.address?.street || config.properties?.address?.full;

      const bookingResult = await bookLumaLeasingTour({
        supabase,
        propertyId,
        propertyName,
        propertyAddress,
        leadId,
        leadInfo: {
          first_name: leadData.first_name || undefined,
          last_name: leadData.last_name || undefined,
          email: leadData.email,
          phone: leadData.phone || undefined,
        },
        bookingDate: tourData.date,
        bookingTime: requestedTourTime,
        specialRequests: tourData.notes || null,
        source: 'lumaleasing_extraction',
        conversationId: conversationId ?? null,
      });

      if (!bookingResult.ok) {
        console.error(
          '[LumaLeasing] Chat extraction tour booking rejected:',
          bookingResult.reason,
          bookingResult.message
        );
      }
    }
  } catch (error) {
    console.error('[LumaLeasing] Extraction failed:', error);
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

    const lastMessage = messages[messages.length - 1]?.content;
    if (!lastMessage) {
      ctx.logSuccess(400, { reason: 'missing_message' })
      return NextResponse.json(
        { error: 'Message required' },
        { status: 400, headers: responseHeaders }
      );
    }

    const supabase = createServiceClient();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      const { data: existingSession } = await supabase
        .from('widget_sessions')
        .select('*')
        .eq('id', activeSessionId)
        .eq('property_id', propertyId)
        .maybeSingle();
      
      widgetSession = existingSession;

      if (!widgetSession) {
        ctx.logSuccess(400, { reason: 'invalid_session_id', sessionId: activeSessionId, propertyId })
        return badRequest('Invalid sessionId for this property', responseHeaders);
      }
    }

    if (!widgetSession && visitorId) {
      // Create new session
      const { data: newSession } = await supabase
        .from('widget_sessions')
        .insert({
          property_id: propertyId,
          visitor_id: visitorId,
          user_agent: req.headers.get('user-agent'),
          referrer_url: req.headers.get('referer'),
        })
        .select()
        .single();
      
      widgetSession = newSession;
      activeSessionId = newSession?.id || null;
    }

    // 3. Handle lead capture if info provided
    let leadId: string | null = widgetSession?.lead_id ?? null;

    if (leadInfo && !leadId) {
      leadId = await findExistingLeadIdByContact(supabase, propertyId, {
        email: leadInfo.email,
        phone: leadInfo.phone,
      })

      if (leadId) {
        const updates = buildLeadUpdatePayload({
          firstName: leadInfo.first_name,
          lastName: leadInfo.last_name,
          email: leadInfo.email,
          phone: leadInfo.phone,
        })

        if (Object.keys(updates).length > 0) {
          await supabase
            .from('leads')
            .update(updates)
            .eq('id', leadId)
        }
      }

      // Create new lead if not found
      if (!leadId) {
        const { data: newLead } = await supabase
          .from('leads')
          .insert({
            property_id: propertyId,
            first_name: leadInfo.first_name || '',
            last_name: leadInfo.last_name || '',
            email: leadInfo.email || '',
            phone: leadInfo.phone || '',
            source: 'LumaLeasing Widget',
            status: 'new',
          })
          .select('id')
          .single();

        leadId = newLead?.id || null;

        // Sync new lead to CRM (if configured)
        if (leadId) {
          try {
            const crmResult = await syncLeadToCRM(propertyId, leadId, {
              first_name: leadInfo.first_name || undefined,
              last_name: leadInfo.last_name || undefined,
              email: leadInfo.email || undefined,
              phone: leadInfo.phone || undefined,
              source: 'LumaLeasing Widget',
              status: 'new',
            });
            console.log('[LumaLeasing] CRM sync for direct lead:', crmResult.action);
          } catch (crmError) {
            console.error('[LumaLeasing] CRM sync failed (non-blocking):', crmError);
          }

          // Start follow-up workflow for new leads (non-blocking)
          startWorkflow(leadId, propertyId, 'lead_created').catch(e =>
            console.error('[LumaLeasing Chat] Workflow start failed (non-blocking):', e)
          )
        }
      }

      // Update session with lead
      if (widgetSession && leadId && activeSessionId) {
        await supabase
          .from('widget_sessions')
          .update({ lead_id: leadId, converted_at: new Date().toISOString() })
          .eq('id', activeSessionId)
          .eq('property_id', propertyId);
      }
    }

    // 4. Get or create conversation
    let conversationId: string | null = null;

    if (widgetSession && activeSessionId) {
      // Check for existing conversation
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id, is_human_mode')
        .eq('widget_session_id', activeSessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingConv) {
        conversationId = existingConv.id;

        // If in human mode, save message but don't generate AI response
        if (existingConv.is_human_mode) {
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: lastMessage,
          });

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
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({
            property_id: propertyId,
            lead_id: leadId,
            widget_session_id: activeSessionId,
            channel: 'widget',
          })
          .select('id')
          .single();

        conversationId = newConv?.id || null;

        // Track chat_started engagement event for new conversations (non-blocking)
        if (leadId && conversationId) {
          trackEngagementEvent({
            leadId,
            propertyId,
            eventType: 'chat_started',
            metadata: { conversation_id: conversationId, source: 'lumaleasing_widget' },
          }).catch(e => console.error('[LumaLeasing Chat] Chat started tracking failed (non-blocking):', e))
        }
      }
    }

    // 5. Save user message
    if (conversationId) {
      const duplicateReply = await findRecentDuplicateReply(supabase, conversationId, lastMessage)
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

    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: lastMessage,
      });
    }

    if (!isPropertyChatInScope(lastMessage, propertyName)) {
      const reply = buildPropertyOnlyResponse(propertyName);
      if (conversationId) {
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: reply,
        });
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
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: reply,
        });
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

    // 6. Detect intent for tour booking
    const tourKeywords = ['tour', 'visit', 'see', 'showing', 'appointment', 'schedule', 'book', 'come by', 'stop by', 'check out'];
    const wantsTour = tourKeywords.some(kw => lastMessage.toLowerCase().includes(kw));

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

${leadId ? '' : `
LEAD CAPTURE:
If this conversation is going well (3+ exchanges) and you haven't captured their info yet, naturally ask for their name and email/phone so the team can follow up with more details.
`}

Remember: You represent ${propertyName}. Provide exceptional customer service with clean, human-friendly responses!`;

    // 10. Generate AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: (() => {
        const recent = messages.slice(-10).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        while (recent.reduce((sum, m) => sum + m.content.length, 0) > 6000 && recent.length > 1) {
          recent.shift();
        }
        return [
        { role: 'system', content: systemPrompt },
          ...recent,
        ];
      })(),
      temperature: 0.7,
      max_tokens: 400,
    });

    const reply = completion.choices[0].message.content || "I'm sorry, I couldn't generate a response. Please try again!";

    // 11. Save AI response
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: reply,
      });
    }

    // 12. LLM-based extraction of lead info and tour requests
    // Must await in serverless environment or it may not complete
    let extractionRan = false;
    let extractionError = null;
    const priorCount = widgetSession?.message_count || 0;
    const extractionDue = Boolean(leadInfo?.email || leadInfo?.phone) || ((priorCount + 1) % 3 === 0);
    try {
      if (extractionDue) {
        await extractAndProcessConversation(
          openai,
          supabase,
          messages,
          propertyId,
          activeSessionId ? activeSessionId : null,
          conversationId,
          leadId,
          {
            widget_name: config.widget_name,
            properties:
              config.properties &&
              typeof config.properties === 'object' &&
              !Array.isArray(config.properties)
                ? {
                    name: config.properties.name,
                    address:
                      config.properties.address &&
                      typeof config.properties.address === 'object' &&
                      !Array.isArray(config.properties.address)
                        ? {
                            street: (config.properties.address as { street?: string }).street,
                            full: (config.properties.address as { full?: string }).full,
                          }
                        : undefined,
                  }
                : null,
          }
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

    ctx.logSuccess(200, {
      conversationId,
      sessionId: activeSessionId,
      hasLeadId: !!leadId,
      wantsTour,
      promptedLeadCapture: shouldPromptLeadCapture,
    })
    return NextResponse.json({
      content: reply,
      sessionId: activeSessionId,
      conversationId,
      shouldPromptLeadCapture,
      leadCapturePrompt: shouldPromptLeadCapture ? config.lead_capture_prompt : null,
      wantsTour,
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

