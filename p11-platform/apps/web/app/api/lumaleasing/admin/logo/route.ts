import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import { forbidden, unauthorized, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';
import { uploadFileAsset, STORAGE_BUCKETS } from '@/utils/storage/asset-service';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

const ALLOWED_LOGO_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST - Upload a widget logo image and return its public URL
// (authenticated + authorized; multipart/form-data with `propertyId` and `file`)
export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/admin/logo')
  ctx.logStart()
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'admin-logo')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'admin/logo' })
      ctx.logSuccess(429, { reason: 'rate_limited', method: 'POST' })
      return rateLimited({ ...rateLimitHeaders(rl), ...ctx.responseHeaders })
    }

    // Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      ctx.logSuccess(401, { reason: 'unauthorized', method: 'POST' })
      return unauthorized(ctx.responseHeaders);
    }

    // Parse multipart form data
    let formData: FormData
    try {
      formData = await req.formData();
    } catch {
      ctx.logSuccess(400, { reason: 'invalid_form_data', method: 'POST' })
      return badRequest('Expected multipart/form-data with a file', ctx.responseHeaders);
    }

    const propertyId = formData.get('propertyId');
    if (typeof propertyId !== 'string' || !UUID_PATTERN.test(propertyId)) {
      ctx.logSuccess(400, { reason: 'invalid_property_id', method: 'POST' })
      return badRequest('Valid property ID required', ctx.responseHeaders);
    }

    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      ctx.logSuccess(400, { reason: 'missing_file', propertyId, method: 'POST' })
      return badRequest('Image file required', ctx.responseHeaders);
    }

    if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
      ctx.logSuccess(400, { reason: 'invalid_file_type', propertyId, method: 'POST' })
      return badRequest(
        'Unsupported file type. Use PNG, JPG, GIF, WebP, or SVG.',
        ctx.responseHeaders
      );
    }

    if (file.size > MAX_LOGO_BYTES) {
      ctx.logSuccess(400, { reason: 'file_too_large', propertyId, method: 'POST' })
      return badRequest('Logo must be 2MB or smaller', ctx.responseHeaders);
    }

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId);
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/logo' })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, method: 'POST' })
      return forbidden(ctx.responseHeaders);
    }

    const uploadResult = await uploadFileAsset(file, {
      bucket: STORAGE_BUCKETS.BRAND_ASSETS,
      propertyId,
      folder: 'lumaleasing',
      contentType: file.type,
    });

    if (!uploadResult.success || !uploadResult.publicUrl) {
      ctx.logError(500, uploadResult.error, { operation: 'upload_luma_logo', propertyId })
      return serverError(uploadResult.error, ctx.responseHeaders);
    }

    auditLog({ eventType: 'config_updated', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'admin/logo' })
    ctx.logSuccess(200, { propertyId, method: 'POST', fileSize: file.size })
    return NextResponse.json(
      { url: uploadResult.publicUrl },
      { headers: ctx.responseHeaders }
    );
  } catch (error) {
    ctx.logError(500, error, { operation: 'upload_luma_logo' })
    return serverError(error, ctx.responseHeaders);
  }
}
