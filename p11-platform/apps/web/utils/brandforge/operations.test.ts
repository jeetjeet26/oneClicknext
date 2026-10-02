import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'
const mocks = vi.hoisted(() => ({ user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null, access: true, rpc: vi.fn(), read: vi.fn(), execute: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) } }) }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess: async () => ({ authorized: mocks.access, orgId: 'org' }) }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.read }) }) }) }) }))
import { runBrandCommand } from './operations'
const brandAssetId = '33333333-3333-3333-3333-333333333333', requestId = '44444444-4444-4444-4444-444444444444'
const request = (extra: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/brandforge/edit-section', { method: 'POST', body: JSON.stringify({ brandAssetId, requestId, revision: 3, text: 'Updated draft', ...extra }) })
const run = (req = request()) => runBrandCommand(req, 'edit', { text: z.string().max(50) }, mocks.execute)
beforeEach(() => {
 vi.clearAllMocks();mocks.user = { id: '11111111-1111-4111-8111-111111111111' };mocks.access = true
 mocks.read.mockResolvedValue({ data: { id: brandAssetId, property_id: 'property', revision: 3 }, error: null })
 mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'begin_brand_operation' ? { state: 'claimed', claimToken: 'private-token' } : { state: 'applied', success: true, revision: 4 }, error: null }))
 mocks.execute.mockResolvedValue({ updates: { draft_section: {} }, result: { data: 'saved' } })
})
describe('BrandForge command boundary', () => {
 it('authenticates before reading brand data', async () => { mocks.user = null;expect((await run()).status).toBe(401);expect(mocks.read).not.toHaveBeenCalled() })
 it('rejects client supplied actor/claims and malformed versions', async () => { for (const body of [{ actorId: requestId }, { claimToken: requestId }, { revision: 0 }, { revision: 1.5 }, { requestId: 'invalid' }]) expect((await run(request(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled() })
 it('accepts canonical local UUIDs and executes one claimed request', async () => { const response = await run();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(mocks.execute).toHaveBeenCalledOnce();expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_actor_id: mocks.user?.id, p_property_id: 'property', p_revision: 3, p_input: { text: 'Updated draft' } });expect(await response.text()).not.toContain('private-token') })
 it('enforces current property access before provider or mutation', async () => { mocks.access = false;expect((await run()).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled() })
 it('treats a missing brand as missing, not an empty draft', async () => { mocks.read.mockResolvedValue({ error: {}, data: null });expect((await run()).status).toBe(404);expect(mocks.execute).not.toHaveBeenCalled() })
 it.each(['busy','running','stale','cancelled','failed','request_conflict','approval_required','draft_exists'])('does not repeat work when the database returns %s', async state => { mocks.rpc.mockResolvedValue({ data: { state }, error: null });expect((await run()).status).toBe(409);expect(mocks.execute).not.toHaveBeenCalled() })
 it('recovers the committed result before repeating expensive work', async () => { mocks.rpc.mockResolvedValue({ data: { state: 'replayed', revision: 4, data: 'original saved result' }, error: null });const response = await run();expect(response.status).toBe(200);expect((await response.json()).data).toBe('original saved result');expect(mocks.execute).not.toHaveBeenCalled() })
 it('never treats a failed database response as a save', async () => { mocks.rpc.mockResolvedValue({ data: null, error: { message: 'secret database detail' } });const response = await run();expect(response.status).toBe(503);expect(await response.text()).not.toContain('secret');expect(mocks.execute).not.toHaveBeenCalled() })
 it('records safe failure codes without leaking provider errors', async () => { mocks.execute.mockRejectedValue(new Error('provider-token-secret'));const response = await run();expect(response.status).toBe(503);expect(await response.text()).not.toContain('provider-token-secret');expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_error: 'save_failed', p_updates: {} }) })
 it('recovers a completion whose database acknowledgment was lost', async () => { let finishes = 0;mocks.rpc.mockImplementation(async (name: string) => { if(name === 'begin_brand_operation')return { data: { state: 'claimed', claimToken: 'private-token' }, error: null };if(++finishes === 1)throw new Error('reply lost');return { data: { state: 'replayed', revision: 4 }, error: null } });expect((await run()).status).toBe(200);expect(mocks.execute).toHaveBeenCalledOnce() })
})
