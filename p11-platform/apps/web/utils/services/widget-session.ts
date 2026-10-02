/** Shared expiry for the public widget's opaque session capability. */
export const WIDGET_SESSION_MAX_IDLE_MS = 48 * 60 * 60 * 1000

export function isWidgetSessionExpired(
  session: { last_activity_at?: string | null; started_at?: string | null; session_start?: string | null; created_at?: string | null },
  now = Date.now(),
): boolean {
  const observed = session.last_activity_at || session.started_at || session.session_start || session.created_at
  const lastActivity = observed ? Date.parse(observed) : NaN
  return !Number.isFinite(lastActivity) || lastActivity > now + 5 * 60 * 1000 ||
    now - lastActivity >= WIDGET_SESSION_MAX_IDLE_MS
}
