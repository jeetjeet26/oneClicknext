/**
 * Property address formatting
 *
 * Properties store their address as structured JSON, e.g.
 * `{ street, city, state, zip }` (some legacy rows may carry a `full` string).
 * Prospect-facing surfaces (calendar invites, confirmation emails, event
 * locations) need a single mappable string, so this composes the complete
 * address instead of just the street line.
 */

type AddressLike = {
  street?: unknown
  city?: unknown
  state?: unknown
  zip?: unknown
  full?: unknown
}

function cleanPart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatPropertyAddress(address: unknown): string | undefined {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    return undefined
  }

  const parts = address as AddressLike

  const full = cleanPart(parts.full)
  if (full) return full

  const street = cleanPart(parts.street)
  const city = cleanPart(parts.city)
  const stateZip = [cleanPart(parts.state), cleanPart(parts.zip)]
    .filter(Boolean)
    .join(' ')

  const composed = [street, city, stateZip].filter(Boolean).join(', ')
  return composed || undefined
}
