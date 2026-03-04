/**
 * In-Memory Rate Limiter
 *
 * Simple sliding-window rate limiter using a Map.
 * Suitable for single-instance deployments and alpha/beta.
 * For production at scale, swap to Upstash Redis (@upstash/ratelimit).
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 })
 *   const result = limiter.check(clientKey)
 *   if (!result.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

interface RateLimitEntry {
  timestamps: number[]
}

interface RateLimiterConfig {
  /** Time window in milliseconds */
  windowMs: number
  /** Max requests allowed within the window */
  maxRequests: number
  /** How often to sweep expired entries (ms). Default: 60_000 */
  cleanupIntervalMs?: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // Unix ms timestamp when the oldest request in the window expires
  retryAfterMs?: number
}

export function createRateLimiter(config: RateLimiterConfig) {
  const { windowMs, maxRequests, cleanupIntervalMs = 60_000 } = config
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup of expired entries to prevent memory leaks
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs)
      if (entry.timestamps.length === 0) {
        store.delete(key)
      }
    }
  }, cleanupIntervalMs)

  // Allow cleanup timer to not prevent Node from exiting
  if (cleanup.unref) cleanup.unref()

  return {
    check(key: string): RateLimitResult {
      const now = Date.now()
      let entry = store.get(key)

      if (!entry) {
        entry = { timestamps: [] }
        store.set(key, entry)
      }

      // Remove timestamps outside the window
      entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs)

      if (entry.timestamps.length >= maxRequests) {
        const oldestInWindow = entry.timestamps[0]
        const resetAt = oldestInWindow + windowMs
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfterMs: resetAt - now,
        }
      }

      // Record this request
      entry.timestamps.push(now)
      const remaining = maxRequests - entry.timestamps.length

      return {
        allowed: true,
        remaining,
        resetAt: entry.timestamps[0] + windowMs,
      }
    },

    /** Reset a specific key (useful for testing) */
    reset(key: string) {
      store.delete(key)
    },

    /** Clear all entries */
    clear() {
      store.clear()
    },
  }
}

// ─── Pre-configured limiters for different endpoint types ───────────────────

/** Chat endpoint: 20 requests per minute per IP/API key (LLM calls are expensive) */
export const chatLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
})

/** Tour booking: 10 per minute per IP (prevents spam bookings) */
export const tourLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
})

/** Lead capture: 15 per minute per IP */
export const leadLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
})

/** Admin endpoints: 60 per minute per user (generous for dashboard usage) */
export const adminLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
})

/** Cron endpoints: 5 per minute (should only fire from Vercel cron) */
export const cronLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
})

// ─── Helper to extract a rate limit key from a request ─────────────────────

export function getRateLimitKey(req: Request, prefix: string): string {
  // Use X-Forwarded-For (Vercel), X-Real-IP, or fallback
  const forwarded = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip') || ''
  const ip = forwarded || realIp || 'unknown'
  return `${prefix}:${ip}`
}

/** Build rate-limit response headers */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.retryAfterMs
      ? { 'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)) }
      : {}),
  }
}
