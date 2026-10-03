import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), process: vi.fn() }));
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: m.create }));
vi.mock('resend', () => ({ Resend: class {
        emails = { send: m.send };
    } }));
vi.mock('@/utils/analytics/schedule-worker', () => ({ processBiSchedule: m.process }));
import { GET, POST } from './route';
const original = { ...process.env };
const request = (token = 'test') => new Request('http://localhost/api/reports/send', { method: 'POST', headers: { authorization: 'Bearer ' + token } }) as NextRequest;
beforeEach(() => { vi.clearAllMocks(); process.env = { ...original, CRON_SECRET: 'test', OUTBOUND_DELIVERY_PAUSED: 'false', BI_SCHEDULE_DELIVERY_ENABLED: 'true', RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'reports@fixture.invalid' }; const q: Record<string, unknown> = {}; q.select = q.eq = q.lte = q.order = () => q; q.limit = async () => ({ data: [{ id: 'new-schedule' }], error: null }); m.create.mockReturnValue({ from: vi.fn(() => q) }); m.process.mockResolvedValue({ status: 'accepted' }); });
afterEach(() => { process.env = original; });
describe('report dispatch cron', () => {
    it('requires cron authority for both methods', async () => { expect((await POST(request('wrong'))).status).toBe(401); expect((await GET(request('wrong'))).status).toBe(401); expect(m.create).not.toHaveBeenCalled(); });
    it('default global hold blocks reading schedules', async () => { delete process.env.OUTBOUND_DELIVERY_PAUSED; expect((await POST(request())).status).toBe(503); expect(m.create).not.toHaveBeenCalled(); });
    it('requires explicit schedule-provider qualification gate', async () => { delete process.env.BI_SCHEDULE_DELIVERY_ENABLED; expect((await POST(request())).status).toBe(503); expect(m.create).not.toHaveBeenCalled(); });
    it('never simulates delivery when provider missing', async () => { delete process.env.RESEND_API_KEY; expect((await POST(request())).status).toBe(503); expect(m.process).not.toHaveBeenCalled(); });
    it('processes only new recorded schedules', async () => { const r = await POST(request()); expect(r.status).toBe(200); expect(m.create().from).toHaveBeenCalledWith('bi_schedules'); expect(m.process).toHaveBeenCalledTimes(1); });
    it('missing provider ID produces no successful receipt', async () => { m.send.mockResolvedValue({ data: {} }); m.process.mockImplementation(async (_id, _from, send) => ({ receipt: await send({ from: 'a', to: 'b', subject: 'c', html: 'd' }, 'key') })); const r = await POST(request()); expect(await r.json()).toMatchObject({ results: [{ receipt: null }] }); });
});
