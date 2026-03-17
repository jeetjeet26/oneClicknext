import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';

function asMessageArray(value: unknown): Array<{ id: string; content: string | null; created_at: string | null }> {
  if (!Array.isArray(value)) return []

  return value.map(item => {
    const record = item as Record<string, unknown>
    return {
      id: typeof record.id === 'string' ? record.id : '',
      content: typeof record.content === 'string' ? record.content : null,
      created_at: typeof record.created_at === 'string' ? record.created_at : null,
    }
  })
}

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/conversations')
  ctx.logStart()
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-convos')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...rateLimitHeaders(rl), ...ctx.responseHeaders })
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders);
    }

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100); // Cap at 100

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders);
    }

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/conversations' })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId })
      return forbidden(ctx.responseHeaders);
    }

    const supabase = createServiceClient();

    // Get conversations with lead info and message count
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        is_human_mode,
        created_at,
        leads (
          first_name,
          last_name,
          email
        ),
        messages (
          id,
          content,
          created_at
        )
      `)
      .eq('property_id', propertyId)
      .eq('channel', 'widget')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_admin_conversations', propertyId })
      return serverError(error, ctx.responseHeaders);
    }

    // Transform data
    const transformedConversations = (conversations || []).map((conv) => {
      const leadData = conv.leads ? (Array.isArray(conv.leads) ? conv.leads[0] : conv.leads) : null
      const lead: { first_name: string; last_name: string; email: string } | null = leadData || null
      const messages = asMessageArray(conv.messages)
      const lastMessage = messages && messages.length > 0
        ? messages.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
        : null;

      return {
        id: conv.id,
        lead_name: lead ? `${lead.first_name} ${lead.last_name}`.trim() || null : null,
        lead_email: lead?.email || null,
        message_count: messages.length,
        is_human_mode: conv.is_human_mode,
        created_at: conv.created_at,
        last_message: lastMessage?.content || null,
      };
    });

    ctx.logSuccess(200, { propertyId, count: transformedConversations.length })
    return NextResponse.json({ conversations: transformedConversations }, { headers: ctx.responseHeaders });
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_admin_conversations' })
    return serverError(error, ctx.responseHeaders);
  }
}
