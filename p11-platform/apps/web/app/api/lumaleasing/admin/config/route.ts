import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import type { Json } from '@/types/supabase';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { validateBody, adminConfigUpdateSchema } from '@/utils/services/validation';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';

function toJsonRecord(value: Record<string, unknown> | undefined): Json | undefined {
  if (!value) return undefined
  return value as Json
}

function mapBusinessHoursToWorkingHours(
  businessHours: Record<string, unknown> | undefined
): Json | undefined {
  if (!businessHours) return undefined

  const dayMap: Record<string, string> = {
    monday: 'mon',
    tuesday: 'tue',
    wednesday: 'wed',
    thursday: 'thu',
    friday: 'fri',
    saturday: 'sat',
    sunday: 'sun',
  }

  const workingHours: Record<string, unknown> = {}
  for (const [day, shortDay] of Object.entries(dayMap)) {
    const dayConfig = businessHours[day]
    if (
      dayConfig &&
      typeof dayConfig === 'object' &&
      !Array.isArray(dayConfig) &&
      typeof (dayConfig as { start?: unknown }).start === 'string' &&
      typeof (dayConfig as { end?: unknown }).end === 'string'
    ) {
      workingHours[shortDay] = {
        start: (dayConfig as { start: string }).start,
        end: (dayConfig as { end: string }).end,
        enabled: true,
      }
    } else {
      workingHours[shortDay] = {
        start: '00:00',
        end: '00:00',
        enabled: false,
      }
    }
  }

  return workingHours as Json
}

// GET - Fetch config for property (authenticated + authorized)
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/config')
  ctx.logStart()
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-config')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'admin/config' })
      ctx.logSuccess(429, { reason: 'rate_limited', method: 'GET' })
      return rateLimited({ ...rateLimitHeaders(rl), ...ctx.responseHeaders })
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      ctx.logSuccess(401, { reason: 'unauthorized', method: 'GET' })
      return unauthorized(ctx.responseHeaders);
    }

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId');
    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id', method: 'GET' })
      return badRequest('Property ID required', ctx.responseHeaders);
    }

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/config' })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, method: 'GET' })
      return forbidden(ctx.responseHeaders);
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
      const apiKey = `luma_${crypto.randomUUID().replace(/-/g, '')}`
      const { data: newConfig, error } = await supabase
        .from('lumaleasing_config')
        .insert({ property_id: propertyId, api_key: apiKey })
        .select()
        .single();

      if (error) {
        ctx.logError(500, error, { operation: 'create_default_luma_config', propertyId })
        return serverError(error, ctx.responseHeaders);
      }
      config = newConfig;
    }

    auditLog({ eventType: 'property_access_granted', userId: user.id, propertyId, resource: 'admin/config' })
    ctx.logSuccess(200, { propertyId, method: 'GET' })
    return NextResponse.json({ config }, { headers: ctx.responseHeaders });
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_luma_admin_config' })
    return serverError(error, ctx.responseHeaders);
  }
}

// PUT - Update config (authenticated + authorized)
export async function PUT(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/config')
  ctx.logStart()
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-config')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited', method: 'PUT' })
      return rateLimited({ ...rateLimitHeaders(rl), ...ctx.responseHeaders })
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      ctx.logSuccess(401, { reason: 'unauthorized', method: 'PUT' })
      return unauthorized(ctx.responseHeaders);
    }

    // Validate input
    const body = await req.json();
    const validation = validateBody(body, adminConfigUpdateSchema);
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed', method: 'PUT' })
      return badRequest(validation.error, ctx.responseHeaders);
    }

    const { propertyId, config } = validation.data;

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/config/update' })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, method: 'PUT' })
      return forbidden(ctx.responseHeaders);
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
        business_hours: toJsonRecord(config.business_hours),
        timezone: config.timezone,
        is_active: config.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId);

    if (error) {
      ctx.logError(500, error, { operation: 'update_luma_admin_config', propertyId })
      return serverError(error, ctx.responseHeaders);
    }

    // Keep connected Google Calendar settings aligned with operator-configured
    // LumaLeasing tour duration/buffer/business hours/timezone.
    const calendarSyncUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof config.tour_duration_minutes === 'number') {
      calendarSyncUpdate.tour_duration_minutes = config.tour_duration_minutes
    }
    if (typeof config.tour_buffer_minutes === 'number') {
      calendarSyncUpdate.buffer_minutes = config.tour_buffer_minutes
    }
    if (typeof config.timezone === 'string') {
      calendarSyncUpdate.timezone = config.timezone
    }
    if (config.business_hours) {
      calendarSyncUpdate.working_hours = mapBusinessHoursToWorkingHours(config.business_hours)
    }

    if (Object.keys(calendarSyncUpdate).length > 1) {
      const { error: calendarSyncError } = await supabase
        .from('agent_calendars')
        .update(calendarSyncUpdate)
        .eq('property_id', propertyId)
        .eq('sync_enabled', true)

      if (calendarSyncError) {
        // Keep widget config save successful; calendar sync can be retried.
        ctx.logError(500, calendarSyncError, {
          operation: 'sync_luma_config_to_agent_calendar',
          propertyId,
        })
      }
    }

    auditLog({ eventType: 'config_updated', userId: user.id, propertyId, ip: getRequestIp(req) })
    ctx.logSuccess(200, { propertyId, method: 'PUT' })
    return NextResponse.json({ success: true }, { headers: ctx.responseHeaders });
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_luma_admin_config' })
    return serverError(error, ctx.responseHeaders);
  }
}
