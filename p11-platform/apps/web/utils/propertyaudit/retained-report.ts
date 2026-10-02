import type { AuditReportOptions } from './report-contracts';
type Row = Record<string, unknown>;
export const reportRow = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export const reportRows = (value: unknown): Row[] => Array.isArray(value) ? value.map(reportRow) : [];
const text = (v: unknown): string => v === null || v === undefined ? 'Not recorded' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const date = (v: unknown) => { const d = new Date(String(v)); return Number.isNaN(d.valueOf()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d) + ' UTC'; };
const html = (v: unknown) => text(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const md = (v: unknown) => text(v).replace(/([\\`*_{}\[\]<>#+.!|])/g, '\\$1').replace(/\r?\n/g, ' ');
export function reportCsvCell(v: unknown) {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && (/^[\t\r\n]/.test(s) || /^\s*[=+\-@]/.test(s)))
        s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
}
type Section = {
    title: string;
    note?: string;
    head?: string[];
    rows?: unknown[][];
    blocks?: {
        title: string;
        lines: [
            string,
            unknown
        ][];
    }[];
};
const titles = { executive: 'Executive brief', comprehensive: 'Comprehensive audit', competitive: 'Competitive evidence', progress: 'Progress review' };
export function renderRetainedAuditReport(sourceValue: unknown, options: AuditReportOptions): string {
    const source = reportRow(sourceValue), property = reportRow(source.property), runs = reportRows(source.runs);
    if (source.version !== 1 || !property.id || !Array.isArray(source.runs) || !Array.isArray(source.queries) || !Array.isArray(source.findings))
        throw new Error('The retained report source is incomplete.');
    if (options.format === 'findings_csv')
        return [
            ['Finding ID', 'Category', 'Issue', 'Description', 'Occurrences', 'First detected (UTC)', 'Staff-reported fixed at (UTC)', 'Owner', 'Reported status', 'Notes', 'Source crawl ID'],
            ...reportRows(source.findings).map(f => [f.id, f.category, f.title, f.description, f.occurrences, f.first_detected_at, f.fixed_at, f.owner, f.status, f.notes, f.source_crawl_id])
        ].map(row => row.map(reportCsvCell).join(',')).join('\r\n');
    if (options.format === 'queries_csv') {
        const performance = reportRow(source.performance), answers = reportRows(performance.answers);
        const median = (v: number[]) => {
            if (!v.length)
                return null;
            const n = [...v].sort((a, b) => a - b), i = Math.floor(n.length / 2);
            return n.length % 2 ? n[i] : (n[i - 1] + n[i]) / 2;
        };
        return [
            ['Question ID', 'Saved revision', 'Active question', 'Type', 'Location', 'Weight', 'Repeats', 'Measured sample count', 'Presence rate', 'Median rank', 'Median share of voice', 'Measurement scope'],
            ...reportRows(source.queries).map(q => { const matches = answers.filter(a => a.query_id === q.id); return [q.id, q.decision_revision, q.text, q.type, q.geo, q.weight, q.run_count, matches.length, matches.length ? matches.filter(a => a.presence === true).length / matches.length : 'Not measured', median(matches.map(a => a.llm_rank).filter((n): n is number => typeof n === 'number')), median(matches.map(a => a.sov).filter((n): n is number => typeof n === 'number')), 'Two latest completed, unarchived provider runs; exact original wording/type/location/weight only.']; })
        ].map(row => row.map(reportCsvCell).join(',')).join('\r\n');
    }
    const completed = runs.filter(x => reportRow(x.run).status === 'completed'), sections: Section[] = [];
    const containsSynthetic = runs.some(x => reportRow(x.run).measurement_mode === 'local_fixture');
    sections.push({ title: 'Saved evidence', note: `Captured ${date(source.capturedAt)}. ${completed.length} of ${runs.length} selected runs completed. Unfinished or failed measurements do not count as measured absence. ${containsSynthetic ? 'SYNTHETIC LOCAL TEST EVIDENCE — this is not a client measurement. ' : ''}The report uses retained source snapshots and makes no new website or model request.`, head: ['Property at report capture', 'Selected run scope', 'Website at report capture'], rows: [[property.name, options.runId ? 'One selected run' : options.batchId ? 'Selected audit batch' : 'Latest completed non-synthetic audit batch', property.website_url]] });
    const has = (section: string) => options.sections.includes(section as AuditReportOptions['sections'][number]);
    if (has('summary') || has('scores') || has('models'))
        sections.push({ title: 'Measured surfaces and coverage', note: 'Each score is the stored result for its run. Models, questions and sample sizes can differ; these are directional API measurements, not a claim about a live browser search or business outcome.', head: ['Surface / model', 'Started (UTC)', 'Status', 'Mode', 'Accepted / planned answers', 'Stored score / 100', 'Stored visibility %', 'Original property name'], rows: runs.map(x => { const r = reportRow(x.run), score = reportRows(x.scores)[0] || {}, items = reportRows(x.items), snapshot = reportRow(reportRow(x.job).snapshot); return [`${text(r.surface)} / ${text(r.model_name)}`, date(r.started_at), r.archived_at ? `${text(r.status)} (archived)` : r.status, r.measurement_mode, `${reportRows(x.answers).length} / ${items.length || r.query_count || 'unknown'}`, score.overall_score, score.visibility_pct, reportRow(snapshot.property).name]; }) });
    if (has('scores'))
        sections.push({ title: 'Historical measured scores', note: text(source.trendScope), head: ['Started (UTC)', 'Surface', 'Model', 'Stored score / 100', 'Stored visibility %'], rows: reportRows(source.trends).map(r => { const s = reportRows(r.geo_scores)[0] || {}; return [date(r.started_at), r.surface, r.model_name, s.overall_score, s.visibility_pct]; }) });
    if (has('competitors')) {
        const entities: unknown[][] = [];
        for (const x of completed)
            for (const entry of reportRows(x.answers)) {
                const a = reportRow(entry.answer);
                for (const e of reportRows(a.ordered_entities))
                    entities.push([reportRow(x.run).surface, a.id, e.name, e.domain, e.position, e.rationale]);
            }
        sections.push({ title: 'Names returned in the measured answers', note: 'These are extracted entities with their source answer and position. A returned name is not automatically a confirmed competitor; ambiguous matches need review.', head: ['Surface', 'Answer ID', 'Returned name', 'Domain', 'Position', 'Reason'], rows: entities });
    }
    if (has('recommendations')) {
        sections.push({ title: 'Current retained technical findings', note: text(source.findingScope), head: ['Issue', 'Category / severity', 'Reported status / owner', 'Occurrences', 'Observed source / last seen', 'Notes'], rows: reportRows(source.findings).map(f => [f.title, `${text(f.category)} / ${text(f.severity)}`, `${text(f.status)} / ${text(f.owner)}`, f.occurrences, `${text(f.source_crawl_id)} / ${text(f.last_seen_at)}`, f.notes]) });
        sections.push({ title: 'Retained recommendations', note: 'Current recommendations tied to the selected batch are included. Older unlinked recommendations are labelled. Recommendations and reported completion are not verified outcome improvements.', blocks: reportRows(source.recommendations).map(r => ({ title: text(r.title), lines: [['Source', r.batch_id ? `Batch ${r.batch_id}, generation ${text(r.generation_id)}, model ${text(r.model_used)}` : 'Older recommendation without a batch link'], ['Status / owner / priority', `${text(r.status)} / ${text(r.owner)} / ${text(r.priority)}`], ['Recommendation', r.narrative], ['Grounding', r.grounding], ['Proposed changes', r.proposed_changes]] })) });
    }
    if (has('queries')) {
        const blocks: NonNullable<Section['blocks']> = [];
        for (const x of runs) {
            const r = reportRow(x.run), entries = reportRows(x.answers), items = reportRows(x.items), used = new Set<unknown>();
            for (const item of items) {
                const q = reportRow(item.query), found = entries.find(e => reportRow(e.answer).id === item.answerId), a = reportRow(found?.answer);
                if (a.id)
                    used.add(a.id);
                blocks.push({ title: `${text(r.surface)} · ${text(q.text)}`, lines: [['Captured query type / location / weight', `${text(q.type)} / ${text(q.geo)} / ${text(q.weight)}`], ['Execution state', item.state], ['Failure or hold', item.errorCode], ['Answer ID', a.id], ['Measured presence', a.id ? typeof a.presence === 'boolean' ? (a.presence ? 'Present' : 'Absent') : 'Not recorded' : 'Not measured'], ['Rank / share of voice', `${text(a.llm_rank)} / ${text(a.sov)}`], ['Actual answer', a.natural_response || a.answer_summary], ['Extracted summary', a.answer_summary], ['Citations', reportRows(found?.citations).map(c => `${text(c.domain)} — ${text(c.url)}${c.is_brand_domain ? ' (tracked brand domain)' : ''}`).join('\n') || 'No citations recorded']] });
            }
            for (const e of entries) {
                const a = reportRow(e.answer);
                if (!used.has(a.id))
                    blocks.push({ title: `${text(r.surface)} · Original question unavailable`, lines: [['Legacy evidence', 'This answer has no linked captured execution item. Current question wording has not been substituted.'], ['Answer ID', a.id], ['Actual answer', a.natural_response || a.answer_summary], ['Measured presence', a.presence], ['Citations', e.citations]] });
            }
        }
        sections.push({ title: 'Complete selected question and answer evidence', note: 'Every captured execution is included, including failures. Original wording is preserved. Raw retained provider receipts are inspectable in the console; they may differ from the answers successfully applied here.', blocks });
    }
    if (has('appendix'))
        sections.push({ title: 'Crawl coverage', note: 'Coverage describes saved crawler results only. Absence from a partial crawl does not prove a fix. Findings may be older than the selected measurement batch.', head: ['Crawl ID', 'Website', 'Status', 'Started (UTC)', 'Finished (UTC)', 'Pages crawled / cap', 'Coverage summary'], rows: reportRows(source.crawls).map(c => [c.id, c.seed_url, c.status, date(c.started_at), date(c.finished_at), `${text(c.pages_crawled)} / ${text(c.page_cap)}`, c.summary]) });
    const footer = 'PropertyAudit · This report describes the saved evidence and scope above. Model visibility varies over time. Recommendation completion and business outcomes require separate verification.';
    if (options.format === 'markdown')
        return [`# PropertyAudit — ${titles[options.template]}`, `\n${md(property.name)}\n`, ...sections.flatMap(s => [`## ${s.title}`, s.note ? md(s.note) : '', ...(s.head ? [s.head.map(md).join(' | '), s.head.map(() => '---').join(' | '), ...(s.rows || []).map(r => r.map(md).join(' | '))] : []), ...(s.blocks || []).flatMap(b => [`### ${md(b.title)}`, ...b.lines.map(([k, v]) => `**${k}:** ${md(v)}`)]), '']), footer].join('\n\n');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(property.name)} — PropertyAudit</title><style>@page{size:Letter;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;max-width:1100px;margin:32px auto;padding:0 24px;line-height:1.5}header{border-bottom:4px solid #4f46e5;padding-bottom:20px;margin-bottom:28px}h1{font-size:28px}h2{font-size:22px;margin-top:32px}h3{font-size:16px}p,td,dd{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #dbe1ea}th{background:#eef2ff}article{border:1px solid #dbe1ea;padding:14px;margin:14px 0}dt{font-weight:bold;font-size:12px}dd{margin:0 0 10px;white-space:pre-wrap;font-size:13px}footer{font-size:11px;color:#536078;border-top:1px solid #dbe1ea;margin-top:32px;padding-top:16px}.note{color:#536078;font-size:13px}.synthetic{color:#991b1b;font-weight:bold}@media(max-width:600px){body{padding:0 12px}table{font-size:10px}th,td{padding:4px}}@media print{body{margin:0;padding:0}h2,h3{break-after:avoid}tr,article{break-inside:avoid}.note,dt{break-after:avoid;break-inside:avoid}thead{display:table-header-group}}</style></head><body><header><p>PROPERTYAUDIT · RETAINED EVIDENCE</p><h1>${html(titles[options.template])}</h1><h2>${html(property.name)}</h2>${containsSynthetic ? '<p class="synthetic">SYNTHETIC LOCAL TEST EVIDENCE — not a client measurement</p>' : ''}</header>${sections.map(s => `<section><h2>${html(s.title)}</h2>${s.note ? `<p class="note">${html(s.note)}</p>` : ''}${s.head ? `<table><thead><tr>${s.head.map(h => `<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${(s.rows || []).map(r => `<tr>${r.map(v => `<td>${html(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.head.length}">No saved records in this scope.</td></tr>`}</tbody></table>` : ''}${s.blocks ? (s.blocks.map(b => `<article><h3>${html(b.title)}</h3><dl>${b.lines.map(([k, v]) => `<dt>${html(k)}</dt><dd>${html(v)}</dd>`).join('')}</dl></article>`).join('') || '<p>No saved records in this scope.</p>') : ''}</section>`).join('')}<footer>${html(footer)}</footer></body></html>`;
}
export function auditReportArtifactMeta(id: string, options: AuditReportOptions) { const csv = options.format.endsWith('_csv'); return { mime: csv ? 'text/csv; charset=utf-8' : options.format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8', filename: `propertyaudit-${options.format}-${id}.${csv ? 'csv' : options.format === 'html' ? 'html' : 'md'}` }; }
