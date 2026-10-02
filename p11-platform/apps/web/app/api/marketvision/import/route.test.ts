import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), access: vi.fn(), fetch: vi.fn(), from: vi.fn() }));
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess: mocks.access }));
vi.mock('@/utils/services/runtime-config', () => ({ getDataEngineUrl: () => 'http://127.0.0.1:8000' }));
import { GET, POST } from './route';
const property = '33333333-3333-3333-3333-333333333333';
const other = '44444444-4444-4444-4444-444444444444';
const jobId = '11111111-1111-4111-8111-111111111111';
const body = { property_id: property, job_id: jobId, channels: ['google_ads', 'meta_ads'], date_range: 'LAST_30_DAYS' };
const job = { id: jobId, property_id: property, channels: body.channels, date_range: body.date_range, status: 'pending', records_imported: 0 };
function query(data: unknown, error: unknown = null) {
    const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) };
    for (const fn of [q.select, q.eq, q.order, q.limit])
        fn.mockReturnValue(q);
    return q;
}
describe('tracked marketing imports', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('DATA_ENGINE_API_KEY', 'test-key');
        vi.stubGlobal('fetch', mocks.fetch);
        mocks.auth.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
        mocks.client.mockResolvedValue({ auth: { getUser: mocks.auth }, from: mocks.from });
        mocks.access.mockResolvedValue({ authorized: true });
        mocks.from.mockImplementation(() => query(job));
        mocks.fetch.mockResolvedValue(Response.json({ status: 'accepted', job_id: jobId, property_id: property, reused: false }, { status: 202 }));
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
    it('routes manual starts to reviewed pipeline controls without dispatch', async () => { const response = await POST(); expect(response.status).toBe(410); expect(await response.json()).toMatchObject({ next: '/dashboard/pipelines' }); expect(mocks.fetch).not.toHaveBeenCalled(); });
    it('requires sign-in for old job status', async () => { mocks.auth.mockResolvedValue({ data: { user: null } }); expect((await GET(new NextRequest(`http://localhost/api/marketvision/import?job_id=${jobId}`))).status).toBe(401); expect(mocks.from).not.toHaveBeenCalled(); });
    it('scopes job lookup to both identifiers when both are supplied', async () => {
        const q = query(null);
        mocks.from.mockReturnValue(q);
        const response = await GET(new NextRequest(`http://localhost/api/marketvision/import?job_id=${jobId}&property_id=${other}`));
        expect(response.status).toBe(404);
        expect(q.eq.mock.calls).toEqual([['id', jobId], ['property_id', other]]);
    });
    it('verifies the returned property when looking up by job ID only', async () => {
        mocks.access.mockResolvedValue({ authorized: false });
        const response = await GET(new NextRequest(`http://localhost/api/marketvision/import?job_id=${jobId}`));
        expect(response.status).toBe(403);
        expect(mocks.access).toHaveBeenCalledExactlyOnceWith('user-1', property);
    });
    it('does not turn status-query failure into a missing or finished job', async () => {
        mocks.from.mockReturnValue(query(null, { message: 'private database detail' }));
        const response = await GET(new NextRequest(`http://localhost/api/marketvision/import?job_id=${jobId}`));
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain('private database detail');
    });
    it('preserves warnings on an active job without falsely declaring it terminal', async () => {
        mocks.from.mockReturnValue(query({ ...job, status: 'running', error_message: 'One account failed' }));
        const response = await GET(new NextRequest(`http://localhost/api/marketvision/import?job_id=${jobId}&property_id=${property}`));
        expect(await response.json()).toMatchObject({ job: { import_state: 'running', has_warnings: true, is_terminal: false } });
    });
});
