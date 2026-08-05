import { sha256Hex } from '@/utils/sha256'

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        const item = (value as Record<string, unknown>)[key]
        if (item !== undefined) {
          normalized[key] = normalizeForHash(item)
        }
        return normalized
      }, {})
  }

  return value
}

export function canonicalizeSiteForgeContent(value: unknown): string {
  return JSON.stringify(normalizeForHash(value))
}

export function hashSiteForgeContent(value: unknown): string {
  return sha256Hex(canonicalizeSiteForgeContent(value))
}
