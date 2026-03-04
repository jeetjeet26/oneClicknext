import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { validateBody, adminConfigUpdateSchema } from '@/utils/services/validation';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';

// GET - Fetch config for property (authenticated + authorized)
export async function GET(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-config')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'admin/config' })
      return rateLimited(rateLimitHeaders(rl))
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');
    if (!propertyId) return badRequest('Property ID required');

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/config' })
      return forbidden();
    }

    const supabase = createServiceClient();

    // Check if config exists
    let { data: config } = await supabase
      .from('lumaleasing_config')
      .select('*')
      .eq('property_id', propertyId)
      .single();

    // Create default config if doesn't exist
    if (!config) {
      const { data: newConfig, error } = await supabase
        .from('lumaleasing_config')
        .insert({ property_id: propertyId })
        .select()
        .single();

      if (error) return serverError(error);
      config = newConfig;
    }

    auditLog({ eventType: 'property_access_granted', userId: user.id, propertyId, resource: 'admin/config' })
    return NextResponse.json({ config });
  } catch (error) {
    return serverError(error);
  }
}

// PUT - Update config (authenticated + authorized)
export async function PUT(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-config')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) return rateLimited(rateLimitHeaders(rl))

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return unauthorized();

    // Validate input
    const body = await req.json();
    const validation = validateBody(body, adminConfigUpdateSchema);
    if (!validation.success) return badRequest(validation.error);

    const { propertyId, config } = validation.data;

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/config/update' })
      return forbidden();
    }

    const supabase = createServiceClient();

    // Update config (excluding api_key which shouldn't be changed this way)
    const { error } = await supabase
      .from('lumaleasing_config')
      .update({
        widget_name: config.widget_name,
        primary_color: config.primary_color,
        secondary_color: config.secondary_color,
        logo_url: config.logo_url,
        welcome_message: config.welcome_message,
        offline_message: config.offline_message,
        auto_popup_delay_seconds: config.auto_popup_delay_seconds,
        require_email_before_chat: config.require_email_before_chat,
        collect_name: config.collect_name,
        collect_email: config.collect_email,
        collect_phone: config.collect_phone,
        lead_capture_prompt: config.lead_capture_prompt,
        tours_enabled: config.tours_enabled,
        tour_duration_minutes: config.tour_duration_minutes,
        tour_buffer_minutes: config.tour_buffer_minutes,
        business_hours: config.business_hours,
        timezone: config.timezone,
        is_active: config.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId);

    if (error) return serverError(error);

    auditLog({ eventType: 'config_updated', userId: user.id, propertyId, ip: getRequestIp(req) })
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
