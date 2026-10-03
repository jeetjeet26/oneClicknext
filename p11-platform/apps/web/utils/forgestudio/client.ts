// Retain an ambiguous command identity across reloads without storing notes or contact data.
const fallback = new Map<string, string>()
export async function savedEditorialRequest(action: string, input: Record<string, unknown>) {
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))
 const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
 const key = `p11:forgestudio:${action}:${hash}`
 let id = fallback.get(key)
 try { id = localStorage.getItem(key) || id } catch { /* In-memory recovery remains available. */ }
 if (!id) id = crypto.randomUUID()
 fallback.set(key, id)
 try { localStorage.setItem(key, id) } catch { /* Same-page retry remains stable. */ }
 return { body: { ...input, requestId: id }, acknowledge: () => { fallback.delete(key); try { localStorage.removeItem(key) } catch { /* No persisted identity. */ } } }
}
