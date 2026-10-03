import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { auditDecision, auditDecisionRead } from '@/utils/propertyaudit/decision-contracts';
import { auditActor, auditRpc, InventoryError } from '@/utils/propertyaudit/decision-store';
import { SUPPORTED_SURFACES, getSurfaceModelName, getDefaultAuditMode } from '@/utils/propertyaudit/types';
import { requireTeamOrigin, teamBody, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function models() { const surfaces = SUPPORTED_SURFACES.map(surface => ({ surface, modelName: getSurfaceModelName(surface) })), measurementMode = getDefaultAuditMode(); return { surfaces, measurementMode, hash: createHash('sha256').update(JSON.stringify({ surfaces, measurementMode })).digest('hex') }; }
function failure(e: unknown) { return NextResponse.json({ error: e instanceof InventoryError ? e.message : 'The audit decision could not be confirmed. Check its saved request before trying again.' }, { status: e instanceof InventoryError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = auditDecisionRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new InventoryError('Choose a property and valid audit history or filters.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await auditActor(propertyId);
        return NextResponse.json({ ...await auditRpc('read_geo_operator', { p_actor_id: actorId, p_property_id: propertyId, p_input: input }), actorId, ...(input.kind === 'context' ? { models: models() } : {}) }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = auditDecision.safeParse(await teamBody(req, 262144));
        if (!parsed.success)
            throw new InventoryError('Review the query, source evidence and audit decision.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await auditActor(propertyId);
        if (actorId !== expectedActorId)
            throw new InventoryError('Your account changed. Reload before using this saved audit request.', 409);
        let decision: Record<string, unknown> = input;
        if (input.operation === 'run_request') {
            const current = models();
            if (input.modelHash !== current.hash)
                throw new InventoryError('The audit models changed. Refresh the run configuration before deciding.', 409);
            const local = ['localhost', '127.0.0.1'];
            const fixture = input.useLocalFixture === true;
            if (fixture && (process.env.NODE_ENV === 'production' || !local.includes(new URL(req.url).hostname) || !local.includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local').hostname)))
                throw new InventoryError('Synthetic measurements are available only in the isolated local console.', 403);
            if (!fixture && process.env.PROPERTYAUDIT_USE_DATA_ENGINE === 'false')
                throw new InventoryError('Audit execution is paused in this environment. Your saved questions and evidence remain available.', 409);
            if (input.includeSiteCrawl && process.env.SITEAUDIT_ENABLED === 'false')
                throw new InventoryError('Website crawling is paused. Review the audit without a crawl, or ask your administrator to enable it.', 409);
            decision = { operation: input.operation, sourceHash: input.sourceHash, surfaces: input.surfaces.map(surface => current.surfaces.find(x => x.surface === surface)!), executionCount: input.executionCount, includeSiteCrawl: input.includeSiteCrawl, measurementMode: fixture ? 'local_fixture' : current.measurementMode };
        }
        return NextResponse.json(await auditRpc('decide_geo_operator', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: decision }), { headers });
    }
    catch (e) {
        return failure(e);
    }
}
