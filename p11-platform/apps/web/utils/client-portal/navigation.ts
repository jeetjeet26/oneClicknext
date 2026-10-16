/** Keep the selected property and reporting period when moving between client screens. */
export function clientPortalHref(path: string, params: URLSearchParams | { toString(): string }, change: Record<string, string> = {}) {
  const query = new URLSearchParams(params.toString())
  query.delete('reportOffset')
  for (const [key, value] of Object.entries(change)) {
    if (value) query.set(key, value)
    else query.delete(key)
  }
  return path + (query.size ? '?' + query.toString() : '')
}
