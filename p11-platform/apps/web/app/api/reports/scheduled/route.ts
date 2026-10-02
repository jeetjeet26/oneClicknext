import { NextResponse } from 'next/server';
import { scheduleCommand, schedulePreview, scheduleRead } from '@/utils/analytics/schedule-contracts';
import { scheduleActor, scheduleDecisionRpc, scheduleRpc, BiError } from '@/utils/analytics/schedule-store';
import { currentBiReport } from '@/utils/analytics/report-store';
import { isDeliveryPaused } from '@/utils/services/delivery-guard';
import { teamBody, requireTeamOrigin, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
const deliveryPaused = () => isDeliveryPaused() || process.env.BI_SCHEDULE_DELIVERY_ENABLED !== 'true';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof BiError ? e.message : 'Schedule controls are unavailable. Check recorded history before retrying.' }, { status: e instanceof BiError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = scheduleRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new BiError('Choose a property and valid schedule history.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await scheduleActor(propertyId);
        return NextResponse.json({ ...await scheduleDecisionRpc('read_bi_schedules', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId, deliveryPaused: deliveryPaused() }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const body = await teamBody(req, 8192);
        const preview = schedulePreview.safeParse(body);
        if (preview.success) {
            const c = preview.data, actorId = await scheduleActor(c.propertyId);
            if (actorId !== c.expectedActorId)
                throw new BiError('Your account changed. Reload before using this schedule.', 409);
            // Native timing defines completed UTC dates; preview does not authorize a send.
            const timing = await scheduleRpc('preview_bi_schedule', { p_actor_id: actorId, p_property_id: c.propertyId, p_config: c.config });
            if (timing.state !== 'ready')
                throw new BiError('Review the schedule configuration.', 400);
            const report = timing.filters ? await currentBiReport(actorId, c.propertyId, timing.filters as Parameters<typeof currentBiReport>[2]) : null;
            return NextResponse.json({ ...timing, actorId, report, deliveryPaused: deliveryPaused() }, { headers });
        }
        const parsed = scheduleCommand.safeParse(body);
        if (!parsed.success)
            throw new BiError('Review the frequency, time, and up to ten unique recipient addresses.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await scheduleActor(propertyId);
        if (actorId !== expectedActorId)
            throw new BiError('Your account changed. Reload before using this schedule request.', 409);
        return NextResponse.json(await scheduleDecisionRpc('decide_bi_schedule', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input }), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function PATCH() { return NextResponse.json({ error: 'Reload the console to use recorded schedule decisions.' }, { status: 410, headers }); }
export async function DELETE() { return NextResponse.json({ error: 'Schedule history is retained. Use Cancel schedule in the console.' }, { status: 410, headers }); }
