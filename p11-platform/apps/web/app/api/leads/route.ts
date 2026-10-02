import { NextResponse } from 'next/server';
import { leadRecordRead, leadRecordCommand } from '@/utils/leads/record-contracts';
import { leadRecordActor, leadRecordRpc, InventoryError, LeadRecordError } from '@/utils/leads/record-store';
import { requireTeamOrigin, teamBody, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof InventoryError ? e.message : 'Lead records could not be confirmed. Check the saved request before trying again.', ...(e instanceof LeadRecordError ? e.result : {}) }, { status: e instanceof InventoryError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = leadRecordRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new InventoryError('Choose a property and valid lead history or filters.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await leadRecordActor(propertyId);
        return NextResponse.json({ ...await leadRecordRpc('read_lead_records', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = leadRecordCommand.safeParse(await teamBody(req, 32768));
        if (!parsed.success)
            throw new InventoryError('Review the lead name, contact information, dates and decision.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await leadRecordActor(propertyId);
        if (actorId !== expectedActorId)
            throw new InventoryError('Your account changed. Reload before using this lead request.', 409);
        return NextResponse.json(await leadRecordRpc('decide_lead_record', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input }), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export const PATCH = POST;
