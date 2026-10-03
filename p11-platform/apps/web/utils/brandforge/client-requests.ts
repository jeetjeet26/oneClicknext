export type BrandRequestMemory = { current: Map<string, { identity: string; requestId: string }> }
export function brandRequest(memory: BrandRequestMemory, action: string, body: Record<string, unknown>) {
 const identity = JSON.stringify(body)
 const saved = memory.current.get(action)
 const requestId = saved?.identity === identity ? saved.requestId : crypto.randomUUID()
 memory.current.set(action, { identity, requestId })
 return JSON.stringify({ ...body, requestId })
}

export async function brandResponse(response: Response, memory: BrandRequestMemory, action: string) {
 const body = await response.json().catch(() => ({}))
 if (!response.ok) {
  // Only a confirmed terminal result releases the identity; a lost reply retains it.
  if (body.state === 'failed' || body.state === 'cancelled') memory.current.delete(action)
  throw new Error(typeof body.error === 'string' ? body.error : 'The saved result could not be confirmed. Reload to check its status.')
 }
 return body
}
