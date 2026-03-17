/**
 * API Helpers
 *
 * Shared utilities for API routes:
 * - Safe error responses (no DB schema leakage)
 * - CORS origin validation
 * - Common response builders
 */

import { NextResponse } from 'next/server'

// ─── Safe Error Responses ──────────────────────────────────────────────────

/**
 * Return a sanitized JSON error response.
 * NEVER exposes raw DB errors, stack traces, or internal details to the client.
 */
export function safeError(
  publicMessage: string,
  status: number,
  internalError?: unknown,
  headers?: Record<string, string>
): NextResponse {
  // Log full error internally
  if (internalError) {
    console.error(`[API ${status}] ${publicMessage}:`, internalError)
  }

  return NextResponse.json(
    { error: publicMessage },
    { status, headers: headers || undefined }
  )
}

/** 400 — bad request */
export function badRequest(message: string, headers?: Record<string, string>) {
  return safeError(message, 400, undefined, headers)
}

/** 401 — unauthorized */
export function unauthorized(headers?: Record<string, string>) {
  return safeError('Unauthorized', 401, undefined, headers)
}

/** 403 — forbidden (authenticated but no access) */
export function forbidden(headers?: Record<string, string>) {
  return safeError('Forbidden', 403, undefined, headers)
}

/** 404 — not found */
export function notFound(resource = 'Resource', headers?: Record<string, string>) {
  return safeError(`${resource} not found`, 404, undefined, headers)
}

/** 429 — rate limited */
export function rateLimited(headers?: Record<string, string>) {
  return safeError('Too many requests. Please try again later.', 429, undefined, headers)
}

/** 500 — internal server error (sanitized) */
export function serverError(internalError?: unknown, headers?: Record<string, string>) {
  return safeError('Internal server error', 500, internalError, headers)
}

// ─── CRON Auth ──────────────────────────────────────────────────────────────

/**
 * Validate CRON secret for scheduled job endpoints.
 * When CRON_SECRET is set, requires Bearer token.
 * When unset (e.g. local dev), allows.
 * Returns 401 response on failure, null when ok.
 */
export function validateCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return null
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * Returns true only when a CRON secret exists and the caller supplied it.
 * Use this for routes that support both cron and authenticated user callers.
 */
export function hasValidCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

/**
 * Validate internal server-to-server API key.
 * Returns true only when INTERNAL_API_KEY exists and caller supplied it.
 */
export function hasValidInternalApiKey(request: Request): boolean {
  const internalApiKey = process.env.INTERNAL_API_KEY
  if (!internalApiKey) return false
  return request.headers.get('authorization') === `Bearer ${internalApiKey}`
}

// ─── CORS Helpers ──────────────────────────────────────────────────────────

/**
 * Build CORS headers scoped to allowed origins.
 *
 * If LUMALEASING_ALLOWED_ORIGINS env var is set, validate origin against it.
 * Format: comma-separated list of origins, e.g.:
 *   LUMALEASING_ALLOWED_ORIGINS=https://example.com,https://www.example.com
 *
 * In development (NODE_ENV !== 'production'), allow all origins for easy testing.
 * In production, restrict to configured origins only.
 */
export function buildCorsHeaders(
  requestOrigin: string | null,
  allowedMethods = 'GET, POST, OPTIONS',
  allowedHeaders = 'Content-Type, X-API-Key, X-Visitor-ID, Authorization'
): Record<string, string> {
  const isDev = process.env.NODE_ENV !== 'production'
  const configuredOrigins = process.env.LUMALEASING_ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)

  let allowOrigin = ''

  if (isDev) {
    // In dev, allow all origins for local testing
    allowOrigin = requestOrigin || '*'
  } else if (configuredOrigins && configuredOrigins.length > 0) {
    // In production, check if the request origin is in the allow list
    if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
      allowOrigin = requestOrigin
    }
    // If origin not allowed, leave empty (browser will block the request)
  } else {
    // No env var set — fallback to permissive (backward-compatible)
    // TODO: Remove this fallback once all clients have LUMALEASING_ALLOWED_ORIGINS configured
    allowOrigin = requestOrigin || '*'
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Max-Age': '86400', // Cache preflight for 24h
    ...(allowOrigin && allowOrigin !== '*' ? { 'Vary': 'Origin' } : {}),
  }
}

/**
 * Handle CORS preflight (OPTIONS) request.
 */
export function corsPreflightResponse(
  requestOrigin: string | null,
  methods?: string,
  headers?: string
): NextResponse {
  const corsHeaders = buildCorsHeaders(requestOrigin, methods, headers)
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
