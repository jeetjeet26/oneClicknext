import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/propertyaudit/decision-store', async () => { const { InventoryError } = await import('@/utils/knowledge/inventory'); return { auditActor: mocks.actor, auditRpc: mocks.rpc, InventoryError }; });
import { GET, POST, DELETE } from './route';
import { NextRequest } from 'next/server';
import { InventoryError } from '@/utils/knowledge/inventory';
const id = 'ee760000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(id); mocks.rpc.mockResolvedValue({ queryRows: [{ id, property_id: id, text: 'Current captured question', type: 'branded', geo: null, weight: 1, run_count: 1, is_active: true }], answers: [] }); });
describe('captured query performance', () => {
    it('returns unchanged query inventory without inventing absent measurements', async () => { const r = await GET(new NextRequest(`http://localhost/api/propertyaudit/queries?propertyId=${id}`)); expect(r.status).toBe(200); const body = await r.json(); expect(body.total).toBe(1); expect(body.queries[0].presence).toBeUndefined(); expect(mocks.rpc).toHaveBeenCalledWith('read_geo_operator', expect.objectContaining({ p_actor_id: id, p_input: { kind: 'performance' } })); });
    it('holds tenant access failures before reading', async () => { mocks.actor.mockRejectedValue(new InventoryError('Denied', 403)); const r = await GET(new NextRequest(`http://localhost/api/propertyaudit/queries?propertyId=${id}`)); expect(r.status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it.each([POST, DELETE])('holds unrecorded mutation', async (operation) => { expect((await operation()).status).toBe(410); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
