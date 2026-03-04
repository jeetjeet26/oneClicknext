import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    // Rate limit (stricter for key regeneration — 5/min)
    const rlKey = getRateLimitKey(req, 'admin-regen')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'admin/regenerate-key' })
      return rateLimited(rateLimitHeaders(rl))
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return unauthorized();

    const { propertyId } = await req.json();
    if (!propertyId) return badRequest('Property ID required');

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
      return forbidden();
    }

    const supabase = createServiceClient();
    const newApiKey = crypto.randomBytes(32).toString('hex');

    const { error } = await supabase
      .from('lumaleasing_config')
      .update({
        api_key: newApiKey,
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId);

    if (error) return serverError(error);

    auditLog({
      eventType: 'api_key_regenerated',
      userId: user.id,
      propertyId,
      ip: getRequestIp(req),
    })

    return NextResponse.json({ apiKey: newApiKey });
  } catch (error) {
    return serverError(error);
  }
}
