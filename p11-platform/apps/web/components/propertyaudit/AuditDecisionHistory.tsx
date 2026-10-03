'use client';
import { useEffect, useRef, useState } from 'react';
import type { AuditDecisionController, AuditReply } from '@/utils/propertyaudit/use-audit-decisions';
export const auditButton = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40', auditField = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
export function AuditDecisionRecovery({ controller: c }: {
    controller: AuditDecisionController;
}) { return <div className="space-y-2">{c.error && <p role="alert" className="rounded-lg border border-amber-500 p-3 text-sm">{c.error}</p>}{c.notice && <p role="status" className="rounded-lg border border-border p-3 text-sm">{c.notice}</p>}{c.pending && <section aria-label="Saved audit request" className="rounded-lg border border-border p-3 text-sm"><p>Check the last request before making another change. Cancelling an unused request prevents it from arriving later; an already saved decision stays recorded.</p><div className="mt-3 flex flex-wrap gap-2"><button className={auditButton} disabled={c.busy} onClick={() => void c.recover()}>Check audit request</button><button className={auditButton} disabled={c.busy || !c.canManage} onClick={() => void c.cancel()}>Cancel unused audit request</button></div></section>}</div>; }
export function useAuditPage(c: AuditDecisionController, kind: string, filters: Record<string, string> = {}) {
    const [data, setData] = useState<AuditReply | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), generation = useRef(0), filterKey = JSON.stringify(filters);
    async function load(offset = 0, expectedHash?: string) {
        const turn = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await c.read({ kind, ...JSON.parse(filterKey), offset, expectedHash });
            if (turn === generation.current)
                setData(r);
        }
        catch (e) {
            if (turn === generation.current)
                setError(e instanceof Error ? e.message : 'Audit history unavailable.');
        }
        finally {
            if (turn === generation.current)
                setBusy(false);
        }
    }
    useEffect(() => {
        if (c.actor)
            void load();
        return () => { generation.current++; };
        // Obsolete property/filter reads cannot replace the selected inventory.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [c.actor, c.version, kind, filterKey]);
    return { data, busy, error, load };
}
export function AuditPageButtons({ page, label = 'records' }: {
    page: ReturnType<typeof useAuditPage>;
    label?: string;
}) {
    const { data, busy, load } = page;
    if (!data)
        return null;
    const offset = data.offset || 0, count = data.count || 0;
    return <div className="flex flex-wrap items-center gap-2 text-sm"><span>{count ? `${offset + 1}–${Math.min(offset + 25, count)} of ${count} ${label}` : `0 ${label}`}</span><button className={auditButton} disabled={busy || offset === 0} onClick={() => void load(Math.max(0, offset - 25), data.hash)}>Previous {label}</button><button className={auditButton} disabled={busy || offset + 25 >= count} onClick={() => void load(offset + 25, data.hash)}>Next {label}</button></div>;
}
const names: Record<string, string> = { crawl_stop: 'Website crawl stopped', crawl_retry: 'Website crawl retry requested', query_create: 'Questions created', query_edit: 'Question edited', query_archive: 'Questions archived', query_restore: 'Questions restored inactive', finding_review: 'Finding reviewed', recommendation_review: 'Recommendation reviewed', run_request: 'Audit requested', run_stop: 'Audit stopped', run_retry: 'Linked retry requested', run_archive: 'Audit archived', run_restore: 'Audit restored', run_review: 'Audit evidence reviewed', cancel_request: 'Unused request cancelled' };
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function FieldChanges({ before, after }: {
    before: unknown;
    after: unknown;
}) { const a = row(before), b = row(after), fields: Record<string, string> = { text: 'Question', type: 'Type', geo: 'Location', weight: 'Weight', run_count: 'Repeats', is_active: 'Active', archived_at: 'Archived at', status: 'Reported status', owner: 'Responsible team', notes: 'Staff notes', title: 'Title', model_name: 'Model', surface: 'Surface', measurement_mode: 'Measurement source', stopped_by_operator: 'Stopped by an operator', review: 'Review', reason: 'Reason' }; const changes = Object.entries(fields).filter(([k]) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k])); const show = (v: unknown) => v === null || v === undefined || v === '' ? 'Not recorded' : v === true ? 'Yes' : v === false ? 'No' : String(v).replaceAll('_', ' '); return <dl className="space-y-2">{changes.map(([k, label]) => <div key={k}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{k in a ? `${show(a[k])} → ` : ''}{show(b[k])}</dd></div>)}</dl>; }
export function AuditDecisionHistory({ controller: c }: {
    controller: AuditDecisionController;
}) { const page = useAuditPage(c, 'history'); return <section aria-label="Audit decision history" className="space-y-4 rounded-xl border border-border bg-background p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Audit decision history</h3><button className={auditButton} disabled={page.busy || !c.actor} onClick={() => void page.load()}>Refresh audit history</button></div>{page.error && <p role="alert" className="text-sm text-red-700">{page.error}</p>}{!page.data && !page.error && <p className="text-sm">Loading saved decisions…</p>}{page.data?.count === 0 && <p className="text-sm text-muted-foreground">No decisions are recorded under the current contract. Earlier measurements retain their original source.</p>}<ol className="space-y-3">{page.data?.items?.map(h => { const input = row(h.input), after = h.after_state, before = h.before_state, beforeRun = row(before).run; return <li key={String(h.id)} className="space-y-3 rounded-lg border border-border p-3 text-sm"><p className="break-words font-medium">{names[String(h.operation)] || 'Audit decision'} · {String(h.actorName)}</p><p className="text-xs text-muted-foreground">{new Date(String(h.created_at)).toLocaleString()}</p>{Boolean(input.reason) && <p className="whitespace-pre-wrap break-words">{String(input.reason)}</p>}{Array.isArray(after) ? <ol className="space-y-3">{after.map((value, i) => { const earlier = Array.isArray(before) ? before.find(v => row(v).id === row(value).id) : null; return <li key={String(row(value).id || i)}><FieldChanges before={earlier} after={value}/></li>; })}</ol> : after ? <FieldChanges before={beforeRun || before} after={after}/> : null}{h.operation === 'finding_review' || h.operation === 'recommendation_review' || h.operation === 'run_review' ? <p className="text-xs text-muted-foreground">Staff decision retained. A later measurement must establish any verified improvement.</p> : null}{Boolean(row(before).source) && <details><summary>Reviewed property source</summary><p className="mt-2">{String(row(row(row(before).source).property).name || 'Saved property context')} · question and configuration versions retained with this decision.</p></details>}{Boolean(beforeRun) && <details><summary>Reviewed measurement</summary><p className="mt-2">{String(row(beforeRun).surface)} · {String(row(beforeRun).model_name)} · {String(row(beforeRun).measurement_mode)} · {Array.isArray(row(before).answers) ? (row(before).answers as unknown[]).length : 0} retained answers.</p></details>}</li>; })}</ol><AuditPageButtons page={page} label="decisions"/></section>; }
