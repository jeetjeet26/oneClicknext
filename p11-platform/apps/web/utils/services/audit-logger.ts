/**
 * Audit Logger
 *
 * Logs sensitive operations for security auditing and compliance.
 * Stores events in-memory with periodic flush to console/structured logs.
 * For production: swap to a Supabase table or external logging service (Axiom, Datadog, etc.)
 *
 * Events tracked:
 * - Property access attempts (authorized + denied)
 * - API key regeneration
 * - Config changes
 * - Rate limit violations
 * - Authentication failures
 * - Tour completions
 * - Workflow triggers
 */

export type AuditEventType =
  | 'property_access_granted'
  | 'property_access_denied'
  | 'api_key_regenerated'
  | 'config_updated'
  | 'rate_limit_exceeded'
  | 'auth_failure'
  | 'tour_completed'
  | 'workflow_triggered'
  | 'lead_created'
  | 'message_sent'
  | 'cron_executed'

export interface AuditEvent {
  timestamp: string
  eventType: AuditEventType
  userId?: string
  ip?: string
  propertyId?: string
  resource?: string
  details?: Record<string, unknown>
}

// In-memory buffer for audit events
const auditBuffer: AuditEvent[] = []
const MAX_BUFFER_SIZE = 500

/**
 * Log an audit event.
 * Currently outputs to structured console.log for ingestion by Vercel Logs / log drain.
 * Non-blocking — never throws.
 */
export function auditLog(event: Omit<AuditEvent, 'timestamp'>): void {
  try {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    }

    // Structured JSON log — parseable by Vercel log drains, Datadog, etc.
    console.log(JSON.stringify({
      _audit: true,
      ...fullEvent,
    }))

    // Buffer for potential batch processing
    auditBuffer.push(fullEvent)
    if (auditBuffer.length > MAX_BUFFER_SIZE) {
      auditBuffer.splice(0, auditBuffer.length - MAX_BUFFER_SIZE)
    }
  } catch {
    // Audit logging should never crash the request
  }
}

/**
 * Extract IP address from request headers (Vercel-compatible).
 */
export function getRequestIp(req: Request): string {
  const forwarded = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

/**
 * Get recent audit events (for dashboard display or debugging).
 */
export function getRecentAuditEvents(limit = 50): AuditEvent[] {
  return auditBuffer.slice(-limit)
}
