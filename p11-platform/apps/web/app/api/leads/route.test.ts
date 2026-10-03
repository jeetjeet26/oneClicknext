import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/leads/record-store', async () => {
    const { InventoryError } = await import('@/utils/knowledge/inventory');
    return { leadRecordActor: mocks.actor, leadRecordRpc: mocks.rpc, InventoryError, LeadRecordError: class extends InventoryError {
            constructor(message: string, status: number, readonly result?: Record<string, unknown>) { super(message, status); }
        } };
});
import { GET, POST, PATCH } from './route';
import { InventoryError, LeadRecordError } from '@/utils/leads/record-store';
const property = '11111111-1111-1111-1111-111111111111', actor = '22222222-2222-2222-2222-222222222222', id = '33333333-3333-3333-3333-333333333333';
const fields = { firstName: 'Avery', lastName: 'Example', email: 'avery@example.test', phone: '', source: 'manual', bedrooms: '2', moveInDate: '2026-10-01', notes: 'Private preferences' };
const command = { id, propertyId: property, expectedActorId: actor, operation: 'create', fields, duplicateReason: '', workflowIds: [], workflowHash: 'a'.repeat(64), prepareCrm: false };
const req = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/leads', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.rpc.mockResolvedValue({ state: 'saved', propertyId: property, id, leadId: id, status: 'saved' }); });
describe('recorded lead boundary', () => {
    it('passes exact reviewed fields and current authenticated actor to one atomic decision', async () => { const r = await POST(req(command)); expect(r.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('decide_lead_record', { p_id: id, p_actor_id: actor, p_property_id: property, p_input: { operation: 'create', fields, duplicateReason: '', workflowIds: [], workflowHash: 'a'.repeat(64), prepareCrm: false } }); expect(r.headers.get('cache-control')).toBe('private, no-store'); });
    it('requires the current account before any mutation', async () => { mocks.actor.mockResolvedValue(id); expect((await POST(req(command))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('rejects cross-origin writes before authentication or mutation', async () => { expect((await POST(req(command, 'https://another.test'))).status).toBe(403); expect(mocks.actor).not.toHaveBeenCalled(); });
    it('returns current membership errors without attempting a service write', async () => { mocks.actor.mockRejectedValue(new InventoryError('No property access', 403)); expect((await POST(req(command))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('exposes only scoped contact review details from a native conflict', async () => { mocks.rpc.mockRejectedValue(new LeadRecordError('Review matching contacts', 409, { state: 'contact_conflict', matches: { count: 1, hash: 'exact', items: [{ id }] } })); const r = await POST(req(command)); expect(r.status).toBe(409); expect((await r.json()).matches.items).toEqual([{ id }]); });
    it('retains uncertainty without returning internal database errors', async () => { mocks.rpc.mockRejectedValue(new Error('provider secret sql details')); const r = await POST(req(command)); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain('provider secret'); });
    it.each([{ ...command, firstName: 'old unrecorded payload' }, { ...command, fields: { ...fields, moveInDate: '2026-02-30' } }, { ...command, fields: { ...fields, email: '', phone: '' } }, { ...command, fields: { ...fields, phone: 'bad number' } }, { ...command, fields: { ...fields, notes: 'x'.repeat(8001) } }])('rejects invalid or unrecorded writes', async (body) => { expect((await POST(req(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('bounds request bytes before parsing', async () => { expect((await POST(req({ ...command, padding: 'x'.repeat(33000) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('uses the same contract for PATCH and stable cancellation', async () => { expect(PATCH).toBe(POST); expect((await PATCH(req({ id, propertyId: property, expectedActorId: actor, operation: 'cancel_request' }))).status).toBe(200); });
    it('passes literal special-character search and complete pagination into the native reader', async () => { const r = await GET(new Request('http://localhost/api/leads?' + new URLSearchParams({ propertyId: property, search: '%_() , test', page: '45', limit: '25', sortBy: 'updated_at', sortOrder: 'desc' }))); expect(r.status).toBe(200); expect(mocks.rpc.mock.calls[0][1].p_input).toMatchObject({ search: '%_() , test', page: 45, limit: 25 }); expect((await r.json()).actorId).toBe(actor); });
    it.each(['page=0', 'limit=1001', 'sortBy=secret', 'kind=history', 'kind=command&id=not-a-uuid'])('rejects invalid read selectors %s', async (query) => { expect((await GET(new Request('http://localhost/api/leads?propertyId=' + property + '&' + query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
