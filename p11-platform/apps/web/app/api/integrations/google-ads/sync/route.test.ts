import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ queue: vi.fn() }));
vi.mock('@/utils/marketvision/queue-ad-connection', () => ({ queueAdConnection: mocks.queue }));
import { POST, syncGoogleAdsConnection } from './route';
beforeEach(() => vi.clearAllMocks());
it('requires reviewed manual controls without dispatch', async () => { const r = await POST(); expect(r.status).toBe(410); expect(await r.json()).toMatchObject({ next: '/dashboard/pipelines' }); expect(mocks.queue).not.toHaveBeenCalled(); });
it('preserves the scheduler helper and its tracked job acknowledgement', async () => { mocks.queue.mockResolvedValue({ accepted: true, jobId: 'fixture', synced: 0 }); expect(await syncGoogleAdsConnection('connection', 'account', 'property', 14)).toMatchObject({ accepted: true, synced: 0 }); expect(mocks.queue).toHaveBeenCalledWith('google_ads', 'connection', 'account', 'property', 14); });
