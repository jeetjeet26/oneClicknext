import { admitLumaRead } from '@/utils/services/luma-public-read'
import { NextRequest, NextResponse } from 'next/server';
import { isWidgetSessionExpired } from '@/utils/services/widget-session';
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
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders, 'Cache-Control': 'no-store' };

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

    const beforeId = new URL(req.url).searchParams.get('beforeId');
    if(beforeId!==null&&!UUID_PATTERN.test(beforeId))return badRequest('Valid earlier-message cursor required',responseHeaders);
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

    const denied = await admitLumaRead(supabase,req,propertyId,responseHeaders)
    if(denied) return denied

    // 2. Load the session and confirm it belongs to this property.
    const { data: session, error: sessionError } = await supabase
      .from('widget_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('property_id', propertyId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) {
      ctx.logSuccess(404, { reason: 'session_not_found', sessionId });
      return safeError('Session not found', 404, undefined, responseHeaders);
    }

    // 3. Enforce session freshness so stale chats don't resurrect.
    if (isWidgetSessionExpired(session)) {
      ctx.logSuccess(410, { reason: 'session_expired', sessionId });
      return safeError('Session expired', 410, undefined, responseHeaders);
    }

    // 4. Find the latest conversation for this session (mirrors chat route).
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, is_human_mode')
      .eq('widget_session_id', sessionId)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationError) throw conversationError;

    if (!conversation) {
      ctx.logSuccess(200, { sessionId, hasConversation: false });
      return NextResponse.json(
        {
          sessionId,
          conversationId: null,
          isHumanMode: false,
          leadCaptured: Boolean(session.lead_id),
          messages: [],
          hasEarlierMessages: false,
          nextBeforeId: null,
        },
        { headers: responseHeaders }
      );
    }

    const {data: page,error: messagesError}=await(supabase as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:{state:string;messages:Array<{id:string;role:string;content:string;createdAt:string|null}>;hasEarlierMessages:boolean;nextBeforeId:string|null}|null;error:unknown}>}).rpc('read_luma_visitor_messages',{p_property_id:propertyId,p_conversation_id:conversation.id,p_before_id:beforeId});
    if(messagesError||!page)return serverError(messagesError||new Error('Transcript read unavailable'),responseHeaders);
    if(page.state!=='ready')return safeError('Conversation changed. Reload its history.',409,undefined,responseHeaders);
    const {messages,hasEarlierMessages,nextBeforeId}=page;

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
        hasEarlierMessages,
        nextBeforeId,
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_session_history' });
    return serverError(error, responseHeaders);
  }
}
