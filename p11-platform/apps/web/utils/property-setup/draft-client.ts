import { propertyDraftSchema, type PropertyDraft, type PropertyDraftState } from './draft-contracts'

async function draftFetch(url: string, options: RequestInit) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
  try { return await fetch(url, { ...options, signal: controller.signal }) } finally { clearTimeout(timeout) }
}
function url(propertyId: string) { return `/api/properties/${encodeURIComponent(propertyId)}/onboarding-draft` }
async function readResponse(response: Response): Promise<PropertyDraftState> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The setup draft could not be confirmed. Retry the same save.')
  if (!['ready', 'saved'].includes(data.state) || !Number.isInteger(data.revision) || (data.draft && !propertyDraftSchema.safeParse(data.draft).success)) throw new Error('The saved draft could not be verified.')
  return data
}
export async function readPropertyDraft(propertyId: string) {
  return readResponse(await draftFetch(url(propertyId), { cache: 'no-store' }))
}
export async function savePropertyDraft(propertyId: string, draft: PropertyDraft, revision: number, baseHash: string) {
  const body = JSON.stringify({ draft: propertyDraftSchema.parse(draft), expectedRevision: revision, baseHash })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map(v => v.toString(16).padStart(2, '0')).join('')
  const key = `p11.onboarding-draft:${propertyId}:${hash}`
  const requestId = sessionStorage.getItem(key) || crypto.randomUUID()
  sessionStorage.setItem(key, requestId)
  const result = await readResponse(await draftFetch(url(propertyId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(body), requestId }) }))
  if (result.requestId !== requestId) throw new Error('The draft save receipt does not match. Check the saved draft before continuing.')
  sessionStorage.removeItem(key)
  return result
}
