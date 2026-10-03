import { beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), render: vi.fn() }));
vi.mock('./schedule-store', () => ({ scheduleRpc: mocks.rpc }));
vi.mock('./schedule-email', () => ({ scheduledReportEmail: mocks.render }));
import { processBiSchedule, type ScheduleSender } from './schedule-worker';
const payload = { from: 'a@example.test', subject: 'Report', html: '<p>Snapshot</p>' };
let sent: Mock<ScheduleSender>, allowed: Mock<() => boolean>, runId = '';
beforeEach(() => {
    vi.clearAllMocks();
    sent = vi.fn<ScheduleSender>().mockResolvedValue('provider-fixture');
    allowed = vi.fn(() => true);
    mocks.render.mockReturnValue(payload);
    mocks.rpc.mockImplementation(async (name, args) => {
        if (name === 'claim_bi_schedule') {
            runId = args.p_id;
            return { state: 'claimed', id: runId };
        }
        if (name === 'prepare_bi_schedule_run')
            return { state: 'prepared', id: runId, deliveries: [{ id: 'one', recipient: 'one@example.test' }, { id: 'two', recipient: 'two@example.test' }] };
        if (name === 'start_bi_schedule_delivery')
            return { state: 'started', id: args.p_id, recipient: args.p_id + '@example.test', payload, idempotencyKey: 'bi-report-' + args.p_id };
        if (name === 'finish_bi_schedule_delivery')
            return { state: 'saved', id: args.p_id, status: args.p_provider_id ? 'accepted' : 'unknown' };
        return { state: 'saved', id: runId, status: 'accepted' };
    });
});
describe('scheduled report worker protocol', () => {
    it('delivery hold prevents even a database claim', async () => { allowed.mockReturnValue(false); expect(await processBiSchedule('s', payload.from, sent, {}, allowed)).toMatchObject({ status: 'paused' }); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('does not replay an already claimed occurrence', async () => { mocks.rpc.mockResolvedValue({ state: 'already_claimed' }); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).not.toHaveBeenCalled(); });
    it('records two independent acceptances before advancing', async () => { const r = await processBiSchedule('s', payload.from, sent, {}, allowed); expect(r).toMatchObject({ accepted: 2, status: 'accepted' }); expect(sent.mock.calls.map(c => c[1])).toEqual(['bi-report-one', 'bi-report-two']); expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe('finish_bi_schedule_run'); });
    it('uncertain provider response holds remaining recipients without retry', async () => { sent.mockRejectedValue(new Error('timeout')); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith('finish_bi_schedule_delivery', expect.objectContaining({ p_provider_id: null }), {}); expect(mocks.rpc).toHaveBeenLastCalledWith('finish_bi_schedule_run', expect.objectContaining({ p_issue: 'delivery_unconfirmed' }), {}); });
    it('records a missing provider ID as uncertain', async () => { sent.mockResolvedValue(null); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).toHaveBeenCalledTimes(1); });
    it('losing the start acknowledgement never calls provider', async () => {
        const base = mocks.rpc.getMockImplementation()!;
        mocks.rpc.mockImplementation((n, a, c) => {
            if (n === 'start_bi_schedule_delivery')
                throw new Error('response lost');
            return base(n, a, c);
        });
        await processBiSchedule('s', payload.from, sent, {}, allowed);
        expect(sent).not.toHaveBeenCalled();
    });
    it('losing the result acknowledgement never sends the next recipient', async () => {
        const base = mocks.rpc.getMockImplementation()!;
        mocks.rpc.mockImplementation((n, a, c) => {
            if (n === 'finish_bi_schedule_delivery')
                throw new Error('response lost');
            return base(n, a, c);
        });
        await processBiSchedule('s', payload.from, sent, {}, allowed);
        expect(sent).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenLastCalledWith('finish_bi_schedule_run', expect.objectContaining({ p_issue: 'recording_unconfirmed' }), {});
    });
    it('fences changed destination or message before provider call', async () => { const base = mocks.rpc.getMockImplementation()!; mocks.rpc.mockImplementation(async (n, a, c) => { const r = await base(n, a, c); return n === 'start_bi_schedule_delivery' ? { ...r, recipient: 'other@example.test' } : r; }); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).not.toHaveBeenCalled(); });
    it('native cancellation before start stops the next effect', async () => { const base = mocks.rpc.getMockImplementation()!; mocks.rpc.mockImplementation((n, a, c) => n === 'start_bi_schedule_delivery' ? { state: 'not_started' } : base(n, a, c)); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).not.toHaveBeenCalled(); });
    it('global pause is rechecked after claim and before external effect', async () => { allowed.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledWith('finish_bi_schedule_delivery', expect.objectContaining({ p_provider_id: null }), {}); });
    it('invalid source cannot reach the provider', async () => { mocks.render.mockImplementation(() => { throw new Error('Incomplete facts'); }); await processBiSchedule('s', payload.from, sent, {}, allowed); expect(sent).not.toHaveBeenCalled(); expect(mocks.rpc.mock.calls.some(c => c[0] === 'prepare_bi_schedule_run')).toBe(false); });
});
