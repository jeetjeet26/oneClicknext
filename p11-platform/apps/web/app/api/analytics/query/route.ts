import { NextResponse } from 'next/server';
import { queryCommand, queryRead } from '@/utils/analytics/query-contracts';
import { queryActor, queryRpc, BiError } from '@/utils/analytics/query-store';
import { interpretBiQuery, queryAssistantEnabled } from '@/utils/analytics/query-worker';
import { calculateQuery } from '@/utils/analytics/query-data';
import type { BiSource } from '@/utils/analytics/report-data';
import type { QueryPlan } from '@/utils/analytics/query-contracts';
import { teamBody, requireTeamOrigin, teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
function failure(e: unknown) { return NextResponse.json({ error: e instanceof BiError ? e.message : 'Query history could not be confirmed. Check the saved request before trying again.' }, { status: e instanceof BiError ? e.status : 503, headers }); }
export async function GET(req: Request) {
    try {
        const parsed = queryRead.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success)
            throw new BiError('Choose a property and valid query history.', 400);
        const { propertyId, ...input } = parsed.data, actorId = await queryActor(propertyId), r = await queryRpc('read_bi_queries', { p_actor_id: actorId, p_property_id: propertyId, p_input: input });
        if (r.query) {
            const q = r.query as Record<string, unknown>, source = q.source as BiSource;
            const { source: omitted, ...safe } = q;
            void omitted;
            r.query = { ...safe, filters: source.filters, propertyName: source.propertyName };
        }
        return NextResponse.json({ ...r, actorId, assistantEnabled: queryAssistantEnabled() }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        requireTeamOrigin(req);
        const parsed = queryCommand.safeParse(await teamBody(req, 8192));
        if (!parsed.success)
            throw new BiError('Review the question, report dates and query plan.', 400);
        const { propertyId, expectedActorId, id, ...input } = parsed.data, actorId = await queryActor(propertyId);
        if (actorId !== expectedActorId)
            throw new BiError('Your account changed. Reload before using this query request.', 409);
        let result: unknown = null;
        if (input.operation === 'execute') {
            const detail = await queryRpc('read_bi_queries', { p_actor_id: actorId, p_property_id: propertyId, p_input: { kind: 'detail', id: input.queryId } }), q = detail.query as {
                source: BiSource;
                plan: QueryPlan;
                source_hash: string;
                plan_hash: string;
                revision: number;
                state: string;
            };
            // Native replay remains authoritative, including a completed request whose response was lost.
            if (q.state === 'review' && q.revision === input.expectedRevision && q.plan_hash === input.planHash) {
                try {
                    result = calculateQuery(q.source, q.plan, q.source_hash, q.plan_hash);
                }
                catch (e) {
                    throw new BiError(e instanceof Error ? e.message : 'Review a smaller query scope.', 409);
                }
            }
        }
        const r = await queryRpc('decide_bi_query', { p_id: id, p_actor_id: actorId, p_property_id: propertyId, p_input: input, p_result: result });
        if (input.operation === 'request' && input.mode === 'assistant' && r.state === 'saved' && r.status === 'requested')
            await interpretBiQuery(String(r.queryId));
        return NextResponse.json(r, { headers });
    }
    catch (e) {
        return failure(e);
    }
}
