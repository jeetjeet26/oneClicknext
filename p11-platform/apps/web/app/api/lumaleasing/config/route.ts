import { admitLumaRead } from '@/utils/services/luma-public-read'
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { getRateLimitKey, publicReadLimiter, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { rateLimited, serverError } from '@/utils/services/api-helpers';
import { createRequestContext } from '@/utils/services/request-context';
import {businessHoursStatus} from '@/utils/services/business-hours';
import {resolveCalendarTimezone} from '@/utils/services/timezone';

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
        property_id,
        widget_name,
        primary_color,
        secondary_color,
        logo_url,
        agent_avatar_url,
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
        properties(id, name, settings)
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

    if(!config.property_id) return NextResponse.json({error:'Property unavailable'},{status:404,headers:responseHeaders})
    const denied = await admitLumaRead(supabase,req,config.property_id,responseHeaders)
    if(denied) return denied

    const {data:logo,error:logoError}=await supabase.rpc('luma_widget_logo',{p_property_id:config.property_id})
    if(logoError||!logo||typeof logo!=='object'||Array.isArray(logo))throw new Error('Widget logo availability could not be confirmed')
    const property=Array.isArray(config.properties)?config.properties[0]:config.properties
    const timezone=resolveCalendarTimezone(property?.settings,config.timezone)
    const isWithinBusinessHours=businessHoursStatus(config.business_hours,timezone)

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
        logoUrl: typeof logo.url==='string'?logo.url:null,
        agentAvatarUrl: config.agent_avatar_url,
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
      timezone,
      businessHoursVerified: isWithinBusinessHours!==null,
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lumaleasing_public_config' })
    return serverError(error, responseHeaders);
  }
}

