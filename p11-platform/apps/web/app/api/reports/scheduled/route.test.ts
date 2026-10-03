import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), raw: vi.fn(), current: vi.fn() }));
vi.mock('@/utils/analytics/schedule-store', async () => { const { InventoryError } = await import('@/utils/knowledge/inventory'); return { BiError: InventoryError, scheduleActor: mocked.actor, scheduleDecisionRpc: mocked.rpc, scheduleRpc: mocked.raw }; });
vi.mock('@/utils/analytics/report-store', () => ({ currentBiReport: mocked.current }));
import { GET, POST, PATCH, DELETE } from './route';
import { InventoryError } from '@/utils/knowledge/inventory';
const propertyId = '33333333-3333-3333-3333-333333333333', actor = '11111111-1111-1111-1111-111111111111', id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const command = { operation: 'cancel_request', propertyId, id, expectedActorId: actor };
const post = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/reports/scheduled', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocked.actor.mockResolvedValue(actor); mocked.rpc.mockResolvedValue({ state: 'saved', propertyId, id, status: 'cancelled_request' }); });
describe('recorded schedule API', () => {
    it('rejects cross-origin requests before looking up credentials', async () => { expect((await POST(post(command, 'https://other.test'))).status).toBe(403); expect(mocked.actor).not.toHaveBeenCalled(); });
    it('requires current authentication on reads', async () => { mocked.actor.mockRejectedValue(new InventoryError('Sign in.', 401)); expect((await GET(new Request(`http://localhost/api/reports/scheduled?propertyId=${propertyId}`))).status).toBe(401); });
    it('holds changed-account recovery', async () => { expect((await POST(post({ ...command, expectedActorId: id }))).status).toBe(409); expect(mocked.rpc).not.toHaveBeenCalled(); });
    it('binds server actor to bounded decision and disables cache', async () => { const r = await POST(post(command)); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toContain('no-store'); expect(mocked.rpc).toHaveBeenCalledWith('decide_bi_schedule', { p_id: id, p_actor_id: actor, p_property_id: propertyId, p_input: { operation: 'cancel_request' } }); });
    it('preserves native role denial without leaking internals', async () => { mocked.rpc.mockRejectedValue(new InventoryError('Permission denied.', 403)); expect((await POST(post(command))).status).toBe(403); });
    it('rejects malformed pagination and missing detail identity', async () => {
        for (const q of ['offset=-1', 'kind=detail'])
            expect((await GET(new Request(`http://localhost/api/reports/scheduled?propertyId=${propertyId}&${q}`))).status).toBe(400);
    });
    it('bounds request body', async () => expect((await POST(post({ large: 'x'.repeat(9000) }))).status).toBe(413));
    it('retains old history by refusing old destructive API', async () => { expect((await PATCH()).status).toBe(410); expect((await DELETE()).status).toBe(410); expect(mocked.rpc).not.toHaveBeenCalled(); });
    it('sanitizes unexpected errors', async () => { mocked.rpc.mockRejectedValue(new Error('SECRET_INTERNAL_ROW')); const r = await POST(post(command)); expect(r.status).toBe(503); expect(await r.text()).not.toContain('SECRET_INTERNAL_ROW'); });
});
