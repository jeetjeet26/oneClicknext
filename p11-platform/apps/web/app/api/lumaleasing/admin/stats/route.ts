import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers';
import { createRequestContext } from '@/utils/services/request-context';

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/stats')
  ctx.logStart()
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders);
    }

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders);
    }

    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId })
      return forbidden(ctx.responseHeaders);
    }

    const supabase = createServiceClient();

    // Get total sessions
    const { count: totalSessions } = await supabase
      .from('widget_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    // Get total conversations
    const { count: totalConversations } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('channel', 'widget');

    // Get leads captured (sessions that converted)
    const { count: leadsCapture } = await supabase
      .from('widget_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .not('lead_id', 'is', null);

    // Get tours booked
    const { count: toursBooked } = await supabase
      .from('tour_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('source', 'lumaleasing');

    // Calculate conversion rate
    const conversionRate = totalSessions && totalSessions > 0 
      ? Math.round(((leadsCapture || 0) / totalSessions) * 100) 
      : 0;

    // Approximate average response time (ms) from recent widget message pairs.
    let avgResponseTime = 0;
    const { data: recentConversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('property_id', propertyId)
      .eq('channel', 'widget')
      .order('created_at', { ascending: false })
      .limit(50);

    const conversationIds = (recentConversations || []).map((c) => c.id);
    if (conversationIds.length > 0) {
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('conversation_id, role, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: true });

      if (recentMessages && recentMessages.length > 0) {
        const pendingUserAt: Record<string, number | null> = {};
        const responseTimes: number[] = [];

        for (const msg of recentMessages) {
          const convId = msg.conversation_id as string;
          const timestamp = new Date(msg.created_at as string).getTime();

          if (msg.role === 'user') {
            pendingUserAt[convId] = timestamp;
          } else if (msg.role === 'assistant' && pendingUserAt[convId]) {
            responseTimes.push(timestamp - (pendingUserAt[convId] as number));
            pendingUserAt[convId] = null;
          }
        }

        if (responseTimes.length > 0) {
          avgResponseTime = Math.round(
            responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
          );
        }
      }
    }

    ctx.logSuccess(200, {
      propertyId,
      totalSessions: totalSessions || 0,
      totalConversations: totalConversations || 0,
    })

    return NextResponse.json({
      totalSessions: totalSessions || 0,
      totalConversations: totalConversations || 0,
      leadsCapture: leadsCapture || 0,
      toursBooked: toursBooked || 0,
      avgResponseTime,
      conversionRate,
    }, { headers: ctx.responseHeaders });
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_luma_admin_stats' })
    return serverError(error, ctx.responseHeaders);
  }
}

