import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';

export async function GET(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-convos')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) return rateLimited(rateLimitHeaders(rl))

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100); // Cap at 100

    if (!propertyId) return badRequest('Property ID required');

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/conversations' })
      return forbidden();
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

    if (error) return serverError(error);

    // Transform data
    const transformedConversations = (conversations || []).map((conv) => {
      const leadData = conv.leads ? (Array.isArray(conv.leads) ? conv.leads[0] : conv.leads) : null
      const lead: { first_name: string; last_name: string; email: string } | null = leadData || null
      const messages: { id: string; content: string; created_at: string }[] | null = Array.isArray(conv.messages) ? conv.messages : null
      const lastMessage = messages && messages.length > 0
        ? messages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        : null;

      return {
        id: conv.id,
        lead_name: lead ? `${lead.first_name} ${lead.last_name}`.trim() || null : null,
        lead_email: lead?.email || null,
        message_count: messages?.length || 0,
        is_human_mode: conv.is_human_mode,
        created_at: conv.created_at,
        last_message: lastMessage?.content || null,
      };
    });

    return NextResponse.json({ conversations: transformedConversations });
  } catch (error) {
    return serverError(error);
  }
}
