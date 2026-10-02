import { NextResponse } from 'next/server';
import { pipelineRead, pipelineCommand } from '@/utils/pipelines/contracts';
import { pipelineActor, pipelineRpc, InventoryError } from '@/utils/pipelines/store';
import { requireTeamOrigin, teamBody, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof InventoryError ? e.message : 'Import history could not be confirmed. Check the saved request before trying again.' }, { status: e instanceof InventoryError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = pipelineRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new InventoryError('Choose a property and valid import history.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await pipelineActor(propertyId);
        return NextResponse.json({ ...await pipelineRpc('read_pipelines', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = pipelineCommand.safeParse(await teamBody(req));
        if (!parsed.success)
            throw new InventoryError('Review the selected accounts, period and decision.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await pipelineActor(propertyId);
        if (actorId !== expectedActorId)
            throw new InventoryError('Your account changed. Reload before using this import request.', 409);
        return NextResponse.json(await pipelineRpc('decide_pipeline', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input }), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
