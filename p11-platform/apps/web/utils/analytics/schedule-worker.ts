import { randomUUID } from 'node:crypto';
import { scheduleRpc } from './schedule-store';
import { scheduledReportEmail } from './schedule-email';
import type { BiSource } from './report-data';
import type { ScheduleConfig } from './schedule-contracts';
export type ScheduleSender = (payload: {
    from: string;
    to: string;
    subject: string;
    html: string;
}, key: string) => Promise<string | null>;
export async function processBiSchedule(scheduleId: string, from: string, send: ScheduleSender, client: unknown, allowed: () => boolean) {
    if (!allowed())
        return { scheduleId, status: 'paused' };
    const runId = randomUUID(), claimed = await scheduleRpc('claim_bi_schedule', { p_id: runId, p_schedule_id: scheduleId }, client);
    if (claimed.state !== 'claimed')
        return { scheduleId, status: String(claimed.state) };
    if (claimed.id !== runId)
        throw new Error('Schedule claim identity mismatch');
    let issue: string | null = null, accepted = 0;
    try {
        const payload = scheduledReportEmail({ id: runId, source: claimed.source as BiSource, sourceHash: claimed.sourceHash as string, config: claimed.config as ScheduleConfig, createdAt: claimed.createdAt as string }, from);
        const prepared = await scheduleRpc('prepare_bi_schedule_run', { p_id: runId, p_payload: payload }, client);
        if (prepared.state !== 'prepared' || prepared.id !== runId || !Array.isArray(prepared.deliveries))
            throw new Error('Preparation unavailable');
        for (const d of prepared.deliveries as Array<{
            id: string;
            recipient: string;
        }>) {
            if (!allowed()) {
                issue = 'interrupted';
                break;
            }
            const token = randomUUID(), started = await scheduleRpc('start_bi_schedule_delivery', { p_id: d.id, p_claim_token: token }, client);
            if (started.state !== 'started') {
                issue = 'delivery_unconfirmed';
                break;
            }
            if (started.id !== d.id || started.recipient !== d.recipient || JSON.stringify(started.payload) !== JSON.stringify(payload) && !samePayload(started.payload, payload) || started.idempotencyKey !== 'bi-report-' + d.id)
                throw new Error('Delivery identity mismatch');
            // There is never an automatic resend, including after the provider's 24-hour idempotency window.
            let providerId: string | null = null;
            if (allowed()) {
                try {
                    providerId = await send({ ...payload, to: d.recipient }, String(started.idempotencyKey));
                }
                catch {
                    providerId = null;
                }
            }
            const recorded = await scheduleRpc('finish_bi_schedule_delivery', { p_id: d.id, p_claim_token: token, p_provider_id: providerId }, client);
            if (!['saved', 'replayed'].includes(String(recorded.state)) || recorded.id !== d.id) {
                issue = 'recording_unconfirmed';
                break;
            }
            if (recorded.status !== 'accepted') {
                issue = 'delivery_unconfirmed';
                break;
            }
            accepted++;
        }
    }
    catch {
        issue = 'recording_unconfirmed';
    }
    const finished = await scheduleRpc('finish_bi_schedule_run', { p_id: runId, p_issue: issue }, client);
    return { scheduleId, runId, status: String(finished.status || finished.state), accepted };
}
function samePayload(a: unknown, b: {
    from: string;
    subject: string;
    html: string;
}) {
    if (!a || typeof a !== 'object')
        return false;
    const v = a as Record<string, unknown>;
    return Object.keys(v).length === 3 && v.from === b.from && v.subject === b.subject && v.html === b.html;
}
