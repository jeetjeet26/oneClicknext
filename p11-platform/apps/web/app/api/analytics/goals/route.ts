import { NextResponse } from 'next/server';
import { goalCommand, goalRead } from '@/utils/analytics/goal-contracts';
import { goalActor, goalRpc, BiError } from '@/utils/analytics/goal-store';
import { teamBody, requireTeamOrigin, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof BiError ? e.message : 'Goal history could not be confirmed. Check the request result before retrying.' }, { status: e instanceof BiError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = goalRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new BiError('Choose a property and valid goal history.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await goalActor(propertyId);
        return NextResponse.json({ ...await goalRpc('read_bi_goals', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = goalCommand.safeParse(await teamBody(req, 4096));
        if (!parsed.success)
            throw new BiError('Review the metric, period, positive target and warning threshold.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await goalActor(propertyId);
        if (actorId !== expectedActorId)
            throw new BiError('Your account changed. Reload before using this goal request.', 409);
        return NextResponse.json(await goalRpc('decide_bi_goal', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input }), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function DELETE() { return NextResponse.json({ error: 'Goals retain their history. Use Archive goal in the console.' }, { status: 410, headers }); }
