function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) result[key] = normalize(item)
      return result
    }, {})
}

export function immutableSnapshotChanged(
  updated: Record<string, unknown>,
  original: Record<string, unknown>,
  key: 'brandSnapshot' | 'onboardingSnapshot'
): boolean {
  const updatedHasSnapshot = Object.prototype.hasOwnProperty.call(updated, key)
  const originalHasSnapshot = Object.prototype.hasOwnProperty.call(original, key)
  if (updatedHasSnapshot !== originalHasSnapshot) return true
  if (!updatedHasSnapshot) return false
  return JSON.stringify(normalize(updated[key])) !== JSON.stringify(normalize(original[key]))
}
