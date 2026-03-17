import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { leadLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { buildCorsHeaders, corsPreflightResponse, serverError, rateLimited, badRequest } from '@/utils/services/api-helpers';
import { validateBody, leadCaptureSchema } from '@/utils/services/validation';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';

const LEAD_CAPTURE_ACTIVITY_DEDUPE_WINDOW_MS = 5 * 60 * 1000

function buildLeadUpdatePayload(params: {
  firstName: string
  lastName: string
  email: string
  phone: string
}): Record<string, string> {
  const payload: Record<string, string> = {}

  if (params.firstName) payload.first_name = params.firstName
  if (params.lastName) payload.last_name = params.lastName
  if (params.email) payload.email = params.email
  if (params.phone) payload.phone = params.phone

  return payload
}

// Handle CORS preflight — origin-restricted in production
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return corsPreflightResponse(origin, 'POST, OPTIONS', 'Content-Type, X-API-Key, X-Visitor-ID')
}

// POST - Capture lead information
export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/lead')
  ctx.logStart()
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'POST, OPTIONS', 'Content-Type, X-API-Key, X-Visitor-ID')
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }

  try {
    // Rate limit — 15 per minute per IP
    const rlKey = getRateLimitKey(req, 'lead')
    const rl = leadLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'lumaleasing/lead' })
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key');

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    // Validate input with Zod
    const rawBody = await req.json();
    const validation = validateBody(rawBody, leadCaptureSchema);
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return badRequest(validation.error, responseHeaders);
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
      ctx.logSuccess(400, { reason: 'missing_contact_method' })
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400, headers: responseHeaders }
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
      ctx.logSuccess(401, { reason: 'invalid_api_key' })
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401, headers: responseHeaders }
      );
    }

    if (!config.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found' })
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: responseHeaders }
      );
    }

    const propertyId = config.property_id

    if (sessionId) {
      const { data: session } = await supabase
        .from('widget_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (!session) {
        ctx.logSuccess(400, { reason: 'invalid_session_id', sessionId, propertyId })
        return badRequest('Invalid sessionId for this property', responseHeaders)
      }
    }

    if (conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (!conversation) {
        ctx.logSuccess(400, { reason: 'invalid_conversation_id', conversationId, propertyId })
        return badRequest('Invalid conversationId for this property', responseHeaders)
      }
    }

    // Check if lead already exists (email first, then phone) so widget retries
    // reuse the same lead instead of creating duplicates.
    let leadId: string | null = null;
    const leadUpdatePayload = buildLeadUpdatePayload({
      firstName,
      lastName,
      email,
      phone,
    })

    if (email) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('property_id', propertyId)
        .eq('email', email)
        .limit(1);

      if (existingLead?.[0]?.id) {
        leadId = existingLead[0].id;
      }
    }

    if (!leadId && phone) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('property_id', propertyId)
        .eq('phone', phone)
        .limit(1);

      if (existingLead?.[0]?.id) {
        leadId = existingLead[0].id;
      }
    }

    if (leadId && Object.keys(leadUpdatePayload).length > 0) {
      await supabase
        .from('leads')
        .update(leadUpdatePayload)
        .eq('id', leadId);
    }

    // Create new lead if not found
    if (!leadId) {
      const { data: newLead, error } = await supabase
        .from('leads')
        .insert({
          property_id: propertyId,
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
        ctx.logError(500, error, { operation: 'capture_luma_lead' });
        return serverError(error, responseHeaders);
      }

      leadId = newLead?.id;

      auditLog({
        eventType: 'lead_created',
        propertyId,
        ip: getRequestIp(req),
        details: { source: 'lumaleasing_widget', hasEmail: !!email, hasPhone: !!phone },
      })
    }

    // Add notes as activity if provided, but suppress duplicate retry writes
    if (leadId && (notes || moveInDate || bedroomPreference)) {
      const details = [];
      if (moveInDate) details.push(`Move-in: ${moveInDate}`);
      if (bedroomPreference) details.push(`Bedrooms: ${bedroomPreference}`);
      if (notes) details.push(`Notes: ${notes}`);
      const description = `Widget Lead Capture: ${details.join(', ')}`
      const duplicateCutoff = new Date(
        Date.now() - LEAD_CAPTURE_ACTIVITY_DEDUPE_WINDOW_MS
      ).toISOString()

      const { data: existingActivity } = await supabase
        .from('lead_activities')
        .select('id')
        .eq('lead_id', leadId)
        .eq('type', 'note')
        .eq('description', description)
        .gte('created_at', duplicateCutoff)
        .maybeSingle()

      if (!existingActivity) {
        await supabase
          .from('lead_activities')
          .insert({
            lead_id: leadId,
            type: 'note',
            description,
            metadata: { moveInDate, bedroomPreference, notes },
          });
      }
    }

    // Update session with lead
    if (sessionId && leadId) {
      await supabase
        .from('widget_sessions')
        .update({
          lead_id: leadId,
          converted_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('property_id', propertyId);

      // Also update any conversations linked to this session
      await supabase
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('widget_session_id', sessionId)
        .eq('property_id', propertyId);
    }

    // Update specific conversation if provided
    if (conversationId && leadId) {
      await supabase
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('id', conversationId)
        .eq('property_id', propertyId);
    }

    return NextResponse.json({
      success: true,
      leadId,
      message: `Thanks${firstName ? `, ${firstName}` : ''}! We've saved your information and will be in touch soon.`,
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'capture_luma_lead' })
    return serverError(error, responseHeaders);
  }
}
