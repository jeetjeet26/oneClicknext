export function fillSuggestedMappings(current: Record<string, string>, suggestions: {source: string; target: string}[], allowedSources: string[]) {
 const next = {...current}
 const allowed = new Set(allowedSources)
 const used = new Set(Object.values(current).map(value => value.trim()).filter(Boolean))
 for (const {source, target} of suggestions) {
  if (allowed.has(source) && /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(target) && !next[source]?.trim() && !used.has(target)) {
   next[source] = target
   used.add(target)
  }
 }
 return next
}
