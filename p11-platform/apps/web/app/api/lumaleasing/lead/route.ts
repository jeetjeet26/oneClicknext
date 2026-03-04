import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { leadLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { buildCorsHeaders, corsPreflightResponse, serverError, rateLimited, badRequest } from '@/utils/services/api-helpers';
import { validateBody, leadCaptureSchema } from '@/utils/services/validation';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';

// Handle CORS preflight — origin-restricted in production
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return corsPreflightResponse(origin, 'POST, OPTIONS', 'Content-Type, X-API-Key, X-Visitor-ID')
}

// POST - Capture lead information
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'POST, OPTIONS', 'Content-Type, X-API-Key, X-Visitor-ID')

  try {
    // Rate limit — 15 per minute per IP
    const rlKey = getRateLimitKey(req, 'lead')
    const rl = leadLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'lumaleasing/lead' })
      return rateLimited({ ...corsHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Validate input with Zod
    const rawBody = await req.json();
    const validation = validateBody(rawBody, leadCaptureSchema);
    if (!validation.success) {
      return badRequest(validation.error, corsHeaders);
    }

    const body = validation.data;

    // Support both direct fields and leadInfo wrapper
    const leadInfo = body.leadInfo || body;
    const sessionId = body.sessionId;
    const conversationId = body.conversationId;

    const firstName = leadInfo.first_name || leadInfo.firstName || '';
    const lastName = leadInfo.last_name || leadInfo.lastName || '';
    const email = leadInfo.email || (body as Record<string, string>).email || '';
    const phone = leadInfo.phone || (body as Record<string, string>).phone || '';
    const moveInDate = (leadInfo as Record<string, string>).moveInDate;
    const bedroomPreference = (leadInfo as Record<string, string>).bedroomPreference;
    const notes = (leadInfo as Record<string, string>).notes;

    if (!email && !phone) {
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createServiceClient();

    // Validate API key
    const { data: config } = await supabase
      .from('lumaleasing_config')
      .select('property_id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (!config) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Check if lead already exists
    let leadId: string | null = null;

    if (email) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('property_id', config.property_id)
        .eq('email', email)
        .single();

      if (existingLead) {
        leadId = existingLead.id;
        // Update existing lead
        await supabase
          .from('leads')
          .update({
            first_name: firstName || undefined,
            last_name: lastName || undefined,
            phone: phone || undefined,
          })
          .eq('id', leadId);
      }
    }

    // Create new lead if not found
    if (!leadId) {
      const { data: newLead, error } = await supabase
        .from('leads')
        .insert({
          property_id: config.property_id,
          first_name: firstName || '',
          last_name: lastName || '',
          email: email || '',
          phone: phone || '',
          source: 'LumaLeasing Widget',
          status: 'new',
        })
        .select('id')
        .single();

      if (error) {
        return serverError(error, corsHeaders);
      }

      leadId = newLead?.id;

      auditLog({
        eventType: 'lead_created',
        propertyId: config.property_id,
        ip: getRequestIp(req),
        details: { source: 'lumaleasing_widget', hasEmail: !!email, hasPhone: !!phone },
      })
    }

    // Add notes as activity if provided
    if (leadId && (notes || moveInDate || bedroomPreference)) {
      const details = [];
      if (moveInDate) details.push(`Move-in: ${moveInDate}`);
      if (bedroomPreference) details.push(`Bedrooms: ${bedroomPreference}`);
      if (notes) details.push(`Notes: ${notes}`);

      await supabase
        .from('lead_activities')
        .insert({
          lead_id: leadId,
          type: 'note',
          description: `Widget Lead Capture: ${details.join(', ')}`,
          metadata: { moveInDate, bedroomPreference, notes },
        });
    }

    // Update session with lead
    if (sessionId && leadId) {
      await supabase
        .from('widget_sessions')
        .update({
          lead_id: leadId,
          converted_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      // Also update any conversations linked to this session
      await supabase
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('widget_session_id', sessionId);
    }

    // Update specific conversation if provided
    if (conversationId && leadId) {
      await supabase
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('id', conversationId);
    }

    return NextResponse.json({
      success: true,
      leadId,
      message: `Thanks${firstName ? `, ${firstName}` : ''}! We've saved your information and will be in touch soon.`,
    }, { headers: corsHeaders });

  } catch (error) {
    return serverError(error);
  }
}
