import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { sendEmail } from '@/utils/services/messaging';
import { syncLeadToCRM } from '@/utils/services/crm-sync';
import { getCalendarConfig, createCalendarEvent } from '@/utils/services/google-calendar';
import { startWorkflow } from '@/utils/services/workflow-processor';
import { trackEngagementEvent } from '@/utils/services/engagement-tracker';
import { chatLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { buildCorsHeaders, corsPreflightResponse, serverError, rateLimited, badRequest } from '@/utils/services/api-helpers';
import { validateBody, chatRequestSchema } from '@/utils/services/validation';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';
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
    const messagesTable = supabase.from('messages') as {
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
  console.log('[LumaLeasing] Starting extraction for property:', propertyId, 'session:', sessionId, 'conversation:', conversationId);
  
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
    console.log('[LumaLeasing] Extracted data:', JSON.stringify(data));

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
          console.log('[LumaLeasing] Updated lead:', leadId, updates);
        }
      } else {
        // Create new lead
        console.log('[LumaLeasing] Creating new lead for property:', propertyId, 'with data:', leadData);
        
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
          console.log('[LumaLeasing] Created new lead:', leadId);

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
                console.log('[LumaLeasing] Scored new lead:', leadId, scoreData);
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
              console.log('[LumaLeasing] Updated session', sessionId, 'with lead', leadId);
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

    // Process tour request if detected with date/time
    const tourData = data.tour;
    if (tourData?.requested && tourData.date && leadId) {
      const requestedTourTime = tourData.time || '10:00';
      // Check if tour already exists for this lead on this date
      const { data: existingTour } = await supabase
        .from('tour_bookings')
        .select('id')
        .eq('lead_id', leadId)
        .eq('scheduled_date', tourData.date)
        .eq('scheduled_time', `${requestedTourTime}:00`)
        .in('status', ['scheduled', 'confirmed'])
        .maybeSingle();

      if (!existingTour) {
        // Create tour booking
        const tourTime = requestedTourTime;
        const { data: booking, error: bookingError } = await supabase
          .from('tour_bookings')
          .insert({
            property_id: propertyId,
            lead_id: leadId,
            scheduled_date: tourData.date,
            scheduled_time: tourTime,
            duration_minutes: 30,
            special_requests: tourData.notes,
            source: 'lumaleasing',
            booked_via_conversation_id: conversationId,
            status: 'confirmed',
          })
          .select()
          .single();

        if (!bookingError && booking) {
          console.log('[LumaLeasing] Created tour booking:', booking.id);

          // Create activity on lead
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            type: 'tour_booked',
            description: `Tour booked for ${tourData.date} at ${tourTime} via AI chat`,
            metadata: { booking_id: booking.id, source: 'lumaleasing_extraction' },
          });

          // Track tour_scheduled engagement event (non-blocking)
          trackEngagementEvent({
            leadId,
            propertyId,
            eventType: 'tour_scheduled',
            metadata: { booking_id: booking.id, source: 'lumaleasing_chat_extraction' },
          }).catch(e => console.error('[LumaLeasing Chat] Tour engagement tracking failed (non-blocking):', e))

          // Update lead status
          await supabase
            .from('leads')
            .update({ status: 'tour_booked' })
            .eq('id', leadId);

          // Create Google Calendar event (if calendar connected)
          const propertyName = config.properties?.name || 'our community';
          const propertyAddress = config.properties?.address?.street || config.properties?.address?.full;
          
          try {
            const calendarConfig = await getCalendarConfig(propertyId);
            
            if (calendarConfig && calendarConfig.token_status === 'healthy') {
              console.log(`[LumaLeasing] Creating Google Calendar event for booking ${booking.id}`);
              
              const calendarEvent = await createCalendarEvent(calendarConfig, {
                propertyName,
                prospectName: `${leadData?.first_name || ''} ${leadData?.last_name || ''}`.trim() || 'Guest',
                prospectEmail: leadData?.email || '',
                prospectPhone: leadData?.phone || undefined,
                tourDate: tourData.date,
                tourTime: tourTime,
                specialRequests: tourData.notes || undefined,
                propertyAddress,
              });

              // Store event ID for two-way sync
              await supabase
                .from('calendar_events')
                .insert({
                  agent_calendar_id: calendarConfig.id,
                  tour_booking_id: booking.id,
                  google_event_id: calendarEvent.eventId,
                  sync_status: 'synced',
                  last_synced_at: new Date().toISOString(),
                });

              console.log(`[LumaLeasing] ✅ Created Google Calendar event: ${calendarEvent.eventId}`);
            } else {
              console.log(`[LumaLeasing] ⚠️ Google Calendar not connected or unhealthy, skipping event creation`);
            }
          } catch (calendarError) {
            // Calendar event creation is non-blocking - don't fail the extraction
            console.error(`[LumaLeasing] ⚠️ Google Calendar event creation failed (non-blocking):`, calendarError);
            await supabase.from('lead_activities').insert({
              lead_id: leadId,
              type: 'calendar_sync_failed',
              description: `Google Calendar sync failed for booking ${booking.id}`,
              metadata: {
                booking_id: booking.id,
                reason: calendarError instanceof Error ? calendarError.message : 'unknown_error',
              },
            });
          }

          // Re-score the lead (tour booking adds points)
          try {
            const { data: scoreId } = await supabase.rpc('score_lead', { p_lead_id: leadId });
            if (scoreId) {
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
                console.log('[LumaLeasing] Re-scored lead after tour:', leadId, scoreData);
              }
            }
          } catch (scoreError) {
            console.error('[LumaLeasing] Failed to re-score lead:', scoreError);
          }

          // Send confirmation email if we have an email
          if (leadData?.email) {
            const formattedDate = new Date(tourData.date + 'T00:00:00').toLocaleDateString('en-US', { 
              weekday: 'long', month: 'long', day: 'numeric' 
            });
            const hour = parseInt(tourTime.split(':')[0]);
            const formattedTime = `${hour % 12 || 12}:${tourTime.split(':')[1]} ${hour >= 12 ? 'PM' : 'AM'}`;

            sendEmail(
              leadData.email,
              `Your Tour at ${propertyName} is Confirmed! 📅`,
              `Hi ${leadData.first_name || 'there'}!\n\nYour tour at ${propertyName} is confirmed!\n\n📅 Date: ${formattedDate}\n🕐 Time: ${formattedTime}\n\nWe look forward to seeing you!\n\nThe ${propertyName} Team`,
            ).then(result => {
              if (result.success) {
                console.log('[LumaLeasing] Tour confirmation email sent to', leadData.email);
              } else {
                console.error('[LumaLeasing] Failed to send tour email:', result.error);
              }
            }).catch(err => console.error('[LumaLeasing] Email error:', err));
          }
        }
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
      .select('*, properties(id, name, address, settings)')
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

    // 6. Generate embedding for RAG search
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: lastMessage,
    });
    const embedding = embeddingResponse.data[0].embedding;

    // 7. Search knowledge base
    const { data: documents } = await supabase.rpc('match_documents', {
      query_embedding: embedding as unknown as string,
      match_threshold: 0.7,
      match_count: 5,
      filter_property: propertyId,
    });

    const contextText = documents?.map((doc: { content: string }) => doc.content).join('\n---\n') || '';

    // 8. Detect intent for tour booking
    const tourKeywords = ['tour', 'visit', 'see', 'showing', 'appointment', 'schedule', 'book', 'come by', 'stop by', 'check out'];
    const wantsTour = tourKeywords.some(kw => lastMessage.toLowerCase().includes(kw));

    // 9. Build system prompt
    const systemPrompt = `You are ${config.widget_name || 'Luma'}, a friendly AI leasing assistant for ${propertyName}.

PERSONALITY:
- Warm, helpful, and professional
- Conversational but concise
- Enthusiastic about the property without being pushy
- Use emoji sparingly (1-2 max per response)

KNOWLEDGE BASE:
${contextText || 'No specific documents loaded yet.'}

FORMATTING RULES (CRITICAL):
1. NEVER use markdown formatting (**, *, -, #) in your responses
2. Present information in clean, natural sentences or simple paragraphs
3. When listing floor plans/pricing, use simple text like:
   "We have Studios starting at $2,915, 1-bedrooms from $3,060, and 2-bedrooms from $4,208"
4. For multiple items, use natural language: "We offer A, B, and C" instead of bullet lists
5. Keep numbers clean: "$2,915" not "**$2,915**"
6. Your response should read like a text message, not a formatted document

CUSTOMER SERVICE EXCELLENCE:
- Listen carefully and answer the specific question asked
- Anticipate follow-up questions and offer relevant next steps
- Be empathetic and acknowledge their needs/concerns
- Build rapport through personalized, conversational responses
- If they express urgency, prioritize their request
- Always end with an invitation for more questions or action (tour, call, etc.)

RESPONSE GUIDELINES:
1. Answer questions based ONLY on the knowledge base above
2. If info isn't available, say "I don't have that specific information, but I'd be happy to have someone from our team follow up with you!"
3. Keep responses under 150 words unless detailed info is requested
4. Be proactive: suggest tours, mention specials, highlight unique features
5. Match their energy: formal inquiry → professional tone, casual chat → friendly tone

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

