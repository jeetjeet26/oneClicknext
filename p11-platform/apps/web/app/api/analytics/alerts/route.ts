import { NextResponse } from 'next/server';
import { alertCommand, alertRead } from '@/utils/analytics/alert-contracts';
import { alertActor, alertRpc, alertRaw, alertReply, BiError } from '@/utils/analytics/alert-store';
import { currentBiReport } from '@/utils/analytics/report-store';
import { detectBiChanges } from '@/utils/analytics/alert-data';
import { teamBody, requireTeamOrigin, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof BiError ? e.message : 'Change review history could not be confirmed. Check the saved request before retrying.' }, { status: e instanceof BiError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = alertRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new BiError('Choose a property and valid change review history.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await alertActor(propertyId);
        return NextResponse.json({ ...await alertRpc('read_bi_alerts', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = alertCommand.safeParse(await teamBody(req, 16384));
        if (!parsed.success)
            throw new BiError('Review the selected changes and optional note.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await alertActor(propertyId);
        if (expectedActorId !== actorId)
            throw new BiError('Your account changed. Reload before using this review request.', 409);
        const args = { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input, p_derived: null as unknown };
        let result = await alertRaw('decide_bi_alert', args);
        if (input.operation === 'prepare' && result.state === 'needs_derivation') {
            const report = await currentBiReport(actorId, propertyId, input.filters);
            if ((report as typeof report & {
                sourceHash?: unknown;
            }).sourceHash !== input.sourceHash)
                throw new BiError('Report data changed. Refresh before saving these changes.', 409);
            args.p_derived = detectBiChanges(report, input.sourceHash);
            result = await alertRaw('decide_bi_alert', args);
        }
        return NextResponse.json(alertReply(result, args), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
