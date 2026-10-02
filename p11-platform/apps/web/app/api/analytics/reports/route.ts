import { NextResponse } from 'next/server';
import { biCommand, biFilters, biRead } from '@/utils/analytics/report-contracts';
import { biActor, biRpc, BiError, currentBiReport } from '@/utils/analytics/report-store';
import { teamBody, requireTeamOrigin, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof BiError ? e.message : 'Report controls are unavailable. Check saved history before trying again.' }, { status: e instanceof BiError ? e.status : 503, headers }); }
export async function GET(req: Request) { try {
    const parsed = biRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success)
        throw new BiError('Choose a property and valid report filters.', 400);
    const { propertyId, kind, ...q } = parsed.data, actorId = await biActor(propertyId);
    if (kind === 'current') {
        const filters = biFilters.safeParse({ startDate: q.startDate, endDate: q.endDate, compare: q.compare === 'true', channel: q.channel ?? null, account: q.account ?? null });
        if (!filters.success)
            throw new BiError('Choose a valid report range up to 366 days.', 400);
        return NextResponse.json(await currentBiReport(actorId, propertyId, filters.data), { headers });
    }
    if (['detail', 'exports', 'export'].includes(kind) && !q.id)
        throw new BiError('Choose a saved report or export.', 400);
    return NextResponse.json({ ...await biRpc('read_bi_reports', { p_actor_id: actorId, p_property_id: propertyId, p_input: { kind, id: q.id, offset: q.offset, expectedHash: q.expectedHash } }), actorId }, { headers });
}
catch (e) {
    return failure(e);
} }
export async function POST(req: Request) { try {
    requireTeamOrigin(req);
    const parsed = biCommand.safeParse(await teamBody(req, 8192));
    if (!parsed.success)
        throw new BiError('Review the report request.', 400);
    const c = parsed.data, actorId = await biActor(c.propertyId), args = { p_actor_id: actorId, p_property_id: c.propertyId, p_id: c.id };
    if (actorId !== c.expectedActorId)
        throw new BiError('Your account changed. Reload before using this report request.', 409);
    const result = c.operation === 'save' ? await biRpc('save_bi_report', { ...args, p_input: { label: c.label, filters: c.filters, sourceHash: c.sourceHash } }) : c.operation === 'cancel' ? await biRpc('cancel_bi_report', args) : c.operation === 'export' ? await biRpc('prepare_bi_export', { ...args, p_report_id: c.reportId, p_format: c.format }) : await biRpc('report_bi_export', { ...args, p_outcome: c.outcome });
    return NextResponse.json(result, { headers });
}
catch (e) {
    return failure(e);
} }
