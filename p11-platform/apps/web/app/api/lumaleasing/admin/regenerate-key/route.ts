import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import {
  forbidden,
  unauthorized,
  notFound,
  serverError,
  rateLimited,
} from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import crypto from 'crypto';
import { createRequestContext } from '@/utils/services/request-context';
import { apiKeyRegenerateSchema, validateBody } from '@/utils/services/validation';

export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/regenerate-key')
  ctx.logStart()

  try {
    // Rate limit key regeneration with the shared admin limiter.
    const rlKey = getRateLimitKey(req, 'admin-regen')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'admin/regenerate-key' })
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...ctx.responseHeaders, ...rateLimitHeaders(rl) })
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders);
    }

    const rawBody = await req.json();
    const validation = validateBody(rawBody, apiKeyRegenerateSchema)
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const { propertyId } = validation.data;

    // Org ownership check — critical for key regeneration
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({
        eventType: 'property_access_denied',
        userId: user.id,
        propertyId,
        ip: getRequestIp(req),
        resource: 'admin/regenerate-key',
        details: { action: 'BLOCKED — attempted key regeneration on foreign property' },
      })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders);
    }

    const supabase = createServiceClient();
    const newApiKey = crypto.randomBytes(32).toString('hex');

    const { data: updatedConfig, error } = await supabase
      .from('lumaleasing_config')
      .update({
        api_key: newApiKey,
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId)
      .select('property_id')
      .maybeSingle();

    if (error) {
      ctx.logError(500, error, { operation: 'regenerate_luma_api_key', propertyId })
      return serverError(error, ctx.responseHeaders);
    }

    if (!updatedConfig) {
      ctx.logSuccess(404, { reason: 'config_not_found', propertyId })
      return notFound('LumaLeasing config', ctx.responseHeaders)
    }

    auditLog({
      eventType: 'api_key_regenerated',
      userId: user.id,
      propertyId,
      ip: getRequestIp(req),
    })

    ctx.logSuccess(200, { propertyId, userId: user.id })
    return NextResponse.json({ apiKey: newApiKey }, { headers: ctx.responseHeaders });
  } catch (error) {
    ctx.logError(500, error, { operation: 'regenerate_luma_api_key' })
    return serverError(error, ctx.responseHeaders);
  }
}
