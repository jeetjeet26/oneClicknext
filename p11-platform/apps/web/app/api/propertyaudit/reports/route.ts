import { NextResponse } from 'next/server';
import { reportDecision, reportRead, reportOptions } from '@/utils/propertyaudit/report-contracts';
import { renderRetainedAuditReport, auditReportArtifactMeta, reportRow, reportRows } from '@/utils/propertyaudit/retained-report';
import { auditActor, auditRpc, InventoryError } from '@/utils/propertyaudit/decision-store';
import { requireTeamOrigin, teamBody, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof InventoryError ? e.message : 'The report could not be confirmed. Check its saved request before trying again.' }, { status: e instanceof InventoryError ? e.status : 503, headers }); }
async function finish(id: string, actor: string, property: string) {
    const saved = await auditRpc('read_geo_reports', { p_actor_id: actor, p_property_id: property, p_id: id }), record = reportRow(saved.record);
    if (record.state === 'cancelled')
        return { state: 'saved', status: 'cancelled', id, propertyId: property };
    if (record.state === 'ready')
        return { state: 'replayed', status: 'ready', id, propertyId: property, sourceHash: record.source_hash, artifactHash: record.artifact_hash };
    if (!saved.canResume)
        throw new InventoryError('Only the original requester can finish this saved report.', 403);
    const options = reportOptions.parse(record.options), artifact = renderRetainedAuditReport(record.source, options);
    return auditRpc('finish_geo_report', { p_id: id, p_actor_id: actor, p_property_id: property, p_source_hash: record.source_hash, p_artifact: artifact });
}
export async function GET(req: Request) {
    try {
        const parsed = reportRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new InventoryError('Choose a property and valid report.', 400);
        const { propertyId, id, offset, hash, artifact, downloadId } = parsed.data, actorId = await auditActor(propertyId);
        const data = await auditRpc('read_geo_reports', { p_actor_id: actorId, p_property_id: propertyId, p_id: id ?? null, p_offset: offset, p_hash: hash ?? null });
        if (artifact) {
            const record = reportRow(data.record);
            if (record.state !== 'ready' || typeof record.artifact !== 'string')
                throw new InventoryError('This report artifact has not finished.', 409);
            if (!reportRows(data.observations).some(o => o.id === downloadId && o.actor_id === actorId))
                throw new InventoryError('Prepare this download from the saved report.', 403);
            const meta = auditReportArtifactMeta(id!, reportOptions.parse(record.options));
            return new NextResponse(record.artifact, { headers: { ...headers, 'Content-Type': meta.mime, 'Content-Disposition': `attachment; filename="${meta.filename}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
        }
        return NextResponse.json({ ...data, actorId }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = reportDecision.safeParse(await teamBody(req));
        if (!parsed.success)
            throw new InventoryError('Review the report format, sections and selected measurement.', 400);
        const input = parsed.data, actor = await auditActor(input.propertyId);
        if (actor !== input.expectedActorId)
            throw new InventoryError('Your account changed. Reload before continuing this report request.', 409);
        const args = { p_id: input.id, p_actor_id: actor, p_property_id: input.propertyId };
        if (input.operation === 'observe' || input.operation === 'download')
            return NextResponse.json(await auditRpc('observe_geo_report', { ...args, p_report_id: input.reportId, p_outcome: input.operation === 'download' ? 'prepared' : input.outcome }), { headers });
        if (input.operation === 'cancel')
            return NextResponse.json(await auditRpc('prepare_geo_report', { ...args, p_options: {}, p_cancel: true }), { headers });
        if (input.operation === 'prepare') {
            const saved = await auditRpc('prepare_geo_report', { ...args, p_options: input.options });
            if (saved.status === 'cancelled')
                return NextResponse.json(saved, { headers });
        }
        return NextResponse.json(await finish(input.id, actor, input.propertyId), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
