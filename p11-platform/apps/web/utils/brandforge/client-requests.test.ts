import { expect, it } from 'vitest'
import { brandRequest, brandResponse } from './client-requests'
it('retries the same decision with the same ID, while changed intent receives a new ID', () => {
 const memory = { current: new Map<string, { identity: string; requestId: string }>() }
 const input = { brandAssetId: 'brand', revision: 4, updates: { content: 'Reviewed' } }
 const first = JSON.parse(brandRequest(memory, 'edit', input))
 expect(JSON.parse(brandRequest(memory, 'edit', input)).requestId).toBe(first.requestId)
 expect(JSON.parse(brandRequest(memory, 'approve', input)).requestId).not.toBe(first.requestId)
 expect(JSON.parse(brandRequest(memory, 'edit', { ...input, revision: 5 })).requestId).not.toBe(first.requestId)
})

it('only releases an identity after a confirmed terminal failure', async () => {
 const memory = { current: new Map<string, { identity: string; requestId: string }>() }, input={revision:2}
 const initial=JSON.parse(brandRequest(memory,'export',input)).requestId
 await expect(brandResponse(new Response(JSON.stringify({error:'Reply lost'}),{status:503}),memory,'export')).rejects.toThrow('Reply lost')
 expect(JSON.parse(brandRequest(memory,'export',input)).requestId).toBe(initial)
 await expect(brandResponse(new Response(JSON.stringify({state:'failed',error:'Save failed'}),{status:503}),memory,'export')).rejects.toThrow('Save failed')
 expect(JSON.parse(brandRequest(memory,'export',input)).requestId).not.toBe(initial)
})
