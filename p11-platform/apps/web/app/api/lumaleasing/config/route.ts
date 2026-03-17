import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { getRateLimitKey, publicReadLimiter, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { rateLimited, serverError } from '@/utils/services/api-helpers';
import { createRequestContext } from '@/utils/services/request-context';
import type { Json } from '@/types/supabase';

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

// CORS headers for cross-origin widget requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
};

function asBusinessHours(
  value: Json
): Record<string, { start: string; end: string } | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, { start: string; end: string } | null>
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

// Public endpoint - returns widget configuration (no sensitive data)
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/config')
  ctx.logStart()
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }
  try {
    const rlKey = getRateLimitKey(req, 'lumaleasing-config')
    const rl = publicReadLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = extractApiKey(req);

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    const supabase = createServiceClient();

    const { data: config, error } = await supabase
      .from('lumaleasing_config')
      .select(`
        widget_name,
        primary_color,
        secondary_color,
        logo_url,
        welcome_message,
        offline_message,
        auto_popup_delay_seconds,
        require_email_before_chat,
        collect_name,
        collect_email,
        collect_phone,
        lead_capture_prompt,
        tours_enabled,
        business_hours,
        timezone,
        is_active,
        properties(id, name)
      `)
      .eq('api_key', apiKey)
      .single();

    if (error || !config) {
      ctx.logError(404, error || 'Missing config', {
        operation: 'fetch_lumaleasing_public_config',
        hasConfig: Boolean(config),
      })
      return NextResponse.json(
        { error: 'Invalid API key or config not found' },
        { status: 404, headers: responseHeaders }
      );
    }

    if (!config.is_active) {
      ctx.logSuccess(403, { reason: 'widget_inactive' })
      return NextResponse.json(
        { error: 'Widget is not active' },
        { status: 403, headers: responseHeaders }
      );
    }

    // Check if currently within business hours
    const isWithinBusinessHours = checkBusinessHours(
      asBusinessHours(config.business_hours),
      config.timezone || 'America/Chicago'
    );

    const propertyName = (() => {
      const props = config.properties
      if (Array.isArray(props)) return props[0]?.name
      return props?.name
    })()

    ctx.logSuccess(200, {
      propertyName: propertyName || null,
      isOnline: isWithinBusinessHours,
    })

    return NextResponse.json({
      config: {
        widgetName: config.widget_name,
        primaryColor: config.primary_color,
        secondaryColor: config.secondary_color,
        logoUrl: config.logo_url,
        welcomeMessage: config.welcome_message,
        offlineMessage: config.offline_message,
        autoPopupDelay: config.auto_popup_delay_seconds,
        requireEmailBeforeChat: config.require_email_before_chat,
        collectName: config.collect_name,
        collectEmail: config.collect_email,
        collectPhone: config.collect_phone,
        leadCapturePrompt: config.lead_capture_prompt,
        toursEnabled: config.tours_enabled,
        propertyName,
      },
      isOnline: isWithinBusinessHours,
      businessHours: config.business_hours,
      timezone: config.timezone,
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lumaleasing_public_config' })
    return serverError(error, responseHeaders);
  }
}

function checkBusinessHours(businessHours: Record<string, { start: string; end: string } | null>, timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase();
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;

    if (!weekday || !hour || !minute) return true; // Default to online

    const todayHours = businessHours[weekday];
    if (!todayHours) return false; // Closed today

    const currentTime = `${hour}:${minute}`;
    return currentTime >= todayHours.start && currentTime <= todayHours.end;
  } catch {
    return true; // Default to online if timezone parsing fails
  }
}

