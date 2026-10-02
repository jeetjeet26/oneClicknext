import { NextRequest, NextResponse } from 'next/server';
import { auditActor, auditRpc, InventoryError } from '@/utils/propertyaudit/decision-store';
import { aggregateAnswersByQuery, type ReportAnswer, type ReportQuery } from '@/utils/propertyaudit/reporting';
import { propertyIdSchema } from '@/utils/property-setup/contracts';
import type { AuditQuery } from '@/utils/propertyaudit/use-audit-decisions';
export async function GET(req: NextRequest) {
    try {
        const propertyId = propertyIdSchema.parse(req.nextUrl.searchParams.get('propertyId')), actor = await auditActor(propertyId), result = await auditRpc('read_geo_operator', { p_actor_id: actor, p_property_id: propertyId, p_input: { kind: 'performance' } });
        const queries = result.queryRows as AuditQuery[], answers = aggregateAnswersByQuery(result.answers as ReportAnswer[], queries as unknown as ReportQuery[], new Map());
        const byQuery = new Map(answers.map(a => [a.query_id, a]));
        const rows = queries.map(q => { const a = byQuery.get(q.id); return { id: q.id, propertyId: q.property_id, text: q.text, type: q.type, geo: q.geo, weight: q.weight ?? 1, runCount: q.run_count ?? 1, isActive: q.is_active === true, createdAt: q.created_at, updatedAt: q.updated_at, ...(a ? { presence: a.presence, llmRank: a.llm_rank, linkRank: a.link_rank, sov: a.sov, presenceRate: a.presence_rate, citationConsistency: a.citation_consistency, answerDrift: a.answer_drift } : {}) }; });
        return NextResponse.json({ queries: rows, total: rows.length, performanceScope: 'Two latest completed unarchived provider runs; exact captured question wording, type, location and weight only.' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (e) {
        return NextResponse.json({ error: e instanceof InventoryError ? e.message : 'Audit questions unavailable.' }, { status: e instanceof InventoryError ? e.status : 503 });
    }
}
export async function POST() { return retired(); }
export async function DELETE() { return retired(); }
function retired() { return NextResponse.json({ error: 'Use reviewed audit decisions. Question and measurement history is retained.' }, { status: 410 }); }
