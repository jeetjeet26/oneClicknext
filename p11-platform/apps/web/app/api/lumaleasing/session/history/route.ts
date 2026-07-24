import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { getRateLimitKey, publicReadLimiter, rateLimitHeaders } from '@/utils/services/rate-limiter';
import {
  badRequest,
  buildCorsHeaders,
  corsPreflightResponse,
  rateLimited,
  safeError,
  serverError,
} from '@/utils/services/api-helpers';
import { createRequestContext } from '@/utils/services/request-context';

/**
 * GET /api/lumaleasing/session/history
 *
 * Widget-facing endpoint that returns the stored transcript for a widget
 * session so the embed script can rehydrate the chat after a page
 * navigation, and poll for human-agent replies while in human mode.
 *
 * Auth: property API key (X-API-Key) + the widget session id. The session
 * must belong to the property resolved from the API key.
 */

/** Sessions idle longer than this are treated as expired (48 hours). */
const SESSION_MAX_IDLE_MS = 48 * 60 * 60 * 1000;

/** Hard cap on transcript size returned to the widget. */
const MAX_MESSAGES = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function OPTIONS(req: NextRequest) {
  return corsPreflightResponse(req.headers.get('origin'), 'GET, OPTIONS');
}

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/session/history');
  ctx.logStart();
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'), 'GET, OPTIONS');
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders };

  try {
    const rlKey = getRateLimitKey(req, 'lumaleasing-history');
    const rl = publicReadLimiter.check(rlKey);
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' });
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) });
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key' });
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim() || '';
    if (!UUID_PATTERN.test(sessionId)) {
      ctx.logSuccess(400, { reason: 'invalid_session_id' });
      return badRequest('Valid sessionId required', responseHeaders);
    }

    const supabase = createServiceClient();

    // 1. Resolve property from API key.
    const { data: config, error: configError } = await supabase
      .from('lumaleasing_config')
      .select('property_id, is_active')
      .eq('api_key', apiKey)
      .single();

    if (configError || !config?.property_id) {
      ctx.logSuccess(401, { reason: 'invalid_api_key' });
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401, headers: responseHeaders }
      );
    }

    if (!config.is_active) {
      ctx.logSuccess(403, { reason: 'widget_inactive' });
      return NextResponse.json(
        { error: 'Widget is not active' },
        { status: 403, headers: responseHeaders }
      );
    }

    const propertyId = config.property_id;

    // 2. Load the session and confirm it belongs to this property.
    const { data: session } = await supabase
      .from('widget_sessions')
      .select('id, lead_id, started_at, last_activity_at')
      .eq('id', sessionId)
      .eq('property_id', propertyId)
      .single();

    if (!session) {
      ctx.logSuccess(404, { reason: 'session_not_found', sessionId });
      return safeError('Session not found', 404, undefined, responseHeaders);
    }

    // 3. Enforce session freshness so stale chats don't resurrect.
    const lastActivity = session.last_activity_at || session.started_at;
    if (lastActivity && Date.now() - new Date(lastActivity).getTime() > SESSION_MAX_IDLE_MS) {
      ctx.logSuccess(410, { reason: 'session_expired', sessionId });
      return safeError('Session expired', 410, undefined, responseHeaders);
    }

    // 4. Find the latest conversation for this session (mirrors chat route).
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, is_human_mode')
      .eq('widget_session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!conversation) {
      ctx.logSuccess(200, { sessionId, hasConversation: false });
      return NextResponse.json(
        {
          sessionId,
          conversationId: null,
          isHumanMode: false,
          leadCaptured: Boolean(session.lead_id),
          messages: [],
        },
        { headers: responseHeaders }
      );
    }

    // 5. Load the transcript.
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(MAX_MESSAGES);

    if (messagesError) {
      ctx.logError(500, messagesError, { operation: 'fetch_session_history', sessionId });
      return serverError(messagesError, responseHeaders);
    }

    const messages = (messageRows || [])
      .filter((m) => typeof m.content === 'string' && m.content.length > 0)
      .map((m) => ({
        id: m.id,
        role: m.role || 'assistant',
        content: m.content,
        createdAt: m.created_at,
      }));

    ctx.logSuccess(200, {
      sessionId,
      conversationId: conversation.id,
      messageCount: messages.length,
      isHumanMode: Boolean(conversation.is_human_mode),
    });

    return NextResponse.json(
      {
        sessionId,
        conversationId: conversation.id,
        isHumanMode: Boolean(conversation.is_human_mode),
        leadCaptured: Boolean(session.lead_id),
        messages,
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_session_history' });
    return serverError(error, responseHeaders);
  }
}
