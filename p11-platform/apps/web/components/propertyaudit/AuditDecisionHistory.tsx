'use client';
import {HistoryNote} from '@/components/ui/decision-note';
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
export function AuditDecisionHistory({ controller: c }: { controller: AuditDecisionController }) {
 const page = useAuditPage(c, 'history');
 return <section aria-label="Audit change history" className="space-y-4 rounded-xl border border-border bg-background p-4">
  <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Change history</h3><button className={auditButton} disabled={page.busy || !c.actor} onClick={() => void page.load()}>Refresh</button></div>
  {page.error && <p role="alert" className="text-sm text-red-700">{page.error}</p>}
  {!page.data && !page.error && <p className="text-sm">Loading change history…</p>}
  {page.data?.count === 0 && <p className="text-sm text-muted-foreground">No changes yet.</p>}
  <ol className="divide-y">{page.data?.items?.map(h => <li key={String(h.id)} className="py-3 text-sm">
   <p>{names[String(h.operation)] || 'Audit updated'} · {String(h.actorName)}</p>
   <time dateTime={String(h.created_at)} className="text-xs text-muted-foreground">{new Date(String(h.created_at)).toLocaleString()}</time>
   <HistoryNote value={row(h.input).reason}/>
  </li>)}</ol>
  <AuditPageButtons page={page} label="changes"/>
 </section>;
}
