'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { pendingPipeline } from '@/utils/pipelines/contracts';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40', field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2', card = 'rounded-xl border border-border bg-card p-4 sm:p-6';
const storageKey = (actor: string, property: string) => `p11.pipeline.v1:${actor}:${property}`;
const label = (value: string, warning?: string | null) => value === 'complete' && warning ? 'Partially completed' : ({ pending: 'Queued', running: 'Running', complete: 'Completed', partial: 'Partially completed', failed: 'Failed', cancelled: 'Stopped' }[value] || 'Status unknown');
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
const periodLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
const channel = (value: string) => value === 'google_ads' ? 'Google Ads' : value === 'meta_ads' ? 'Meta Ads' : value;
const actionLabel = (value: string) => ({ 'pipeline.import.requested': 'Import requested', 'pipeline.import.retry_requested': 'Retry requested', 'pipeline.import.stopped': 'Import stopped', 'pipeline.import.progress_reviewed': 'Saved progress reviewed', 'pipeline.import.queued': 'Service import queued', 'pipeline.import.started': 'Worker started', 'pipeline.import.progress': 'Records saved', 'pipeline.import.report_saved': 'Source report retained', 'pipeline.import.account_progress': 'Account progress saved', 'pipeline.import.finished': 'Worker finished' }[value] || value);
function evidenceSummary(value: unknown): string {
    if (value === null || value === undefined)
        return 'No earlier state';
    if (Array.isArray(value))
        return value.map(evidenceSummary).join('\n');
    if (typeof value !== 'object')
        return 'No saved detail';
    const v = value as Record<string, unknown>;
    if (v.job)
        return evidenceSummary(v.job) + (Array.isArray(v.accounts) ? '\n' + evidenceSummary(v.accounts) : '');
    if (v.connection_id)
        return `${channel(String(v.platform))} · ${v.account_id}: ${v.offset ?? 0} saved of ${v.reportRows ?? 'unreceived'} source rows. ${v.done ? 'Account finished.' : 'Account unfinished.'}${v.error ? ' ' + v.error : ''}`;
    return `${label(String(v.status), typeof v.error_message === 'string' ? v.error_message : null)} · ${v.records_imported ?? 'Unknown'} records saved. ${v.date_range ?? 'Period not recorded'}. ${v.current_step ?? ''}`;
}
type Job = {
    id: string;
    status: string;
    revision: number;
    channels: string[];
    date_range: string;
    created_at: string;
    reference_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    records_imported: number | null;
    current_step: string | null;
    error_message: string | null;
    control_version: number | null;
    recovery_version: number | null;
    retry_of: string | null;
    requested_actor_id: string | null;
    lease_expires_at: string | null;
    attempts: number;
};
type Connection = {
    id: string;
    platform: string;
    accountId: string;
    name: string | null;
    active: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
};
type Account = {
    connection_id: string;
    platform: string;
    account_id: string;
    offset: number;
    done: boolean;
    error: string | null;
    reportRows: number | null;
    reportHash: string | null;
};
type History = {
    id: string;
    action: string;
    actorName: string;
    note: string | null;
    before_state: unknown;
    after_state: unknown;
    created_at: string;
};
type Page<T> = {
    items: T[];
    count: number;
    hash: string;
    offset: number;
};
type Reply = {
    propertyId: string;
    actorId?: string;
    id?: string;
    jobId?: string;
    status?: string;
    canManage?: boolean;
    job?: Job;
    accounts?: Account[];
    checkpointAvailable?: boolean;
    workerHold?: string | null;
    connectionsHash?: string;
    connections?: Connection[];
} & Partial<Page<Job | History>>;
function PropertyPipelines({ propertyId, propertyName }: {
    propertyId: string;
    propertyName: string;
}) {
    const controller = useRef<AbortController | null>(null), locked = useRef(false);
    const [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<{
        id: string;
    } | null>(null);
    const [connectionsHash, setConnectionsHash] = useState('');
    const [workerHold, setWorkerHold] = useState<string | null>(null);
    const [list, setList] = useState<Page<Job> | null>(null), [connections, setConnections] = useState<Connection[]>([]), [selection, setSelection] = useState<string[]>([]), [period, setPeriod] = useState('LAST_30_DAYS'), [selected, setSelected] = useState<Job | null>(null), [accounts, setAccounts] = useState<Account[]>([]), [checkpoint, setCheckpoint] = useState(false), [history, setHistory] = useState<Page<History> | null>(null), [note, setNote] = useState(''), [checkedAt, setCheckedAt] = useState('');
    async function request(input: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actor): Promise<Reply> {
        const q = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...input, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/pipelines/controls' + (method === 'GET' ? '?' + q : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, propertyId, expectedActorId: expectedActor }) } : {}) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Import history is unavailable.');
        if (result.propertyId !== propertyId || method === 'POST' && input.id && result.id !== input.id || method === 'GET' && expectedActor && result.actorId !== expectedActor)
            throw new Error('This response does not match the current account or property.');
        return result;
    }
    function applyList(r: Reply) { setConnectionsHash(r.connectionsHash || ''); setList(r as Page<Job>); setConnections(r.connections || []); setCanManage(!!r.canManage); setCheckedAt(new Date().toISOString()); }
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        void request({ kind: 'list' }, 'GET', '').then(r => {
            if (abort.signal.aborted)
                return;
            const raw = sessionStorage.getItem(storageKey(r.actorId!, propertyId));
            if (raw) {
                const parsed = pendingPipeline.safeParse(JSON.parse(raw));
                if (!parsed.success)
                    throw new Error('This browser has an unreadable saved import request. Keep this tab and contact your administrator.');
                setPending(parsed.data);
            }
            setActor(r.actorId!);
            applyList(r);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Import history is unavailable.');
        });
        return () => abort.abort();
        // Property-keyed component aborts all old requests before another property loads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]);
    async function work(fn: () => Promise<void>) {
        if (locked.current)
            return;
        locked.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await fn();
        }
        catch (e) {
            if (!controller.current?.signal.aborted)
                setError(e instanceof Error ? e.message : 'Import result could not be confirmed.');
        }
        finally {
            locked.current = false;
            if (!controller.current?.signal.aborted)
                setBusy(false);
        }
    }
    async function loadList(offset = 0, hash?: string) { applyList(await request({ kind: 'list', offset, expectedHash: hash })); }
    async function choose(id: string) {
        const [r, h] = await Promise.all([request({ kind: 'job', id }), request({ kind: 'history', id })]);
        setSelected(r.job!);
        setAccounts(r.accounts || []);
        setCheckpoint(!!r.checkpointAvailable);
        setWorkerHold(r.workerHold || null);
        setCanManage(!!r.canManage);
        setHistory(h as Page<History>);
        setNote('');
    }
    async function settle(result: Reply) {
        sessionStorage.removeItem(storageKey(actor, propertyId));
        setPending(null);
        await loadList();
        if (result.jobId)
            await choose(result.jobId);
        else if (selected)
            await choose(selected.id);
        setMessage(result.status === 'cancelled_request' ? 'Unused request cancelled.' : result.status === 'cancelled' ? 'Import stopped. Saved records are retained.' : result.status === 'reviewed' ? 'Progress review saved.' : 'Import request recorded. Waiting for the worker or its recorded result.');
    }
    async function decide(input: Record<string, unknown>) {
        if (!actor || pending)
            return;
        const id = crypto.randomUUID();
        sessionStorage.setItem(storageKey(actor, propertyId), JSON.stringify({ id }));
        setPending({ id });
        await settle(await request({ ...input, id }, 'POST'));
    }
    useEffect(() => {
        if (!actor || pending || note || busy || !list?.items.some(j => ['pending', 'running'].includes(j.status)))
            return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible' && !locked.current)
                void work(async () => {
                    await loadList(list.offset);
                    if (selected)
                        await choose(selected.id);
                });
        }, 15000);
        return () => window.clearInterval(timer);
        // Poll only idle, visible reviews; preserve written notes and unresolved decisions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actor, pending, note, busy, list, selected]);
    const disabled = busy || !!pending || !canManage || !actor;
    function pagination<T>(page: Page<T> | null, load: (offset: number, hash: string) => Promise<void>) { return page && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{page.count ? `${page.offset + 1}–${Math.min(page.offset + 20, page.count)} of ${page.count}` : '0 records'}</span><button className={button} disabled={busy || page.offset === 0} onClick={() => void work(() => load(Math.max(0, page.offset - 20), page.hash))}>Previous page</button><button className={button} disabled={busy || page.offset + 20 >= page.count} onClick={() => void work(() => load(page.offset + 20, page.hash))}>Next page</button></div>; }
    return <main className="space-y-6 p-4 text-foreground sm:p-8" aria-label="Import controls">
  <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Pipelines</h1><p className="mt-2 text-muted-foreground">Import connected ad accounts for {propertyName} and review saved results.</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !actor} onClick={() => void work(async () => {
            await loadList();
            if (selected)
                await choose(selected.id);
        })}>Refresh imports</button><Link className={button} href="/dashboard/bi">Open MultiChannel BI</Link></div></header>
  {error && <p role="alert" className="rounded-lg border border-amber-500 p-3">{error} Previously loaded progress may be out of date.</p>}{message && <p role="status" className="rounded-lg border border-border p-3">{message}</p>}{!list && !error && <p role="status">Loading import history…</p>}
  {pending && <section aria-label="Unconfirmed import request" className={card}><h2 className="font-semibold">Check the saved request</h2><p className="mt-2 text-sm">The last reply was not confirmed. Check its result before starting another request. Cancelling an unused request prevents it from running later; completed decisions stay recorded.</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ kind: 'command', id: pending.id })))}>Check request result</button><button className={button} disabled={busy || !canManage} onClick={() => void work(async () => settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST')))}>Cancel unused request</button></div></section>}
  {list && <>
  <section className={card} aria-label="New import"><h2 className="text-lg font-semibold">Import accounts</h2><p className="mt-2 text-sm text-muted-foreground">Choose active accounts and a period. The request retains these sources and each account’s reporting dates. Saved progress can be reviewed before another import.</p>{!canManage && <p className="mt-2 text-sm">An administrator or manager can request and control imports.</p>}
   <div className="mt-4 grid gap-3 sm:grid-cols-2">{connections.map(c => <article className="min-w-0 rounded-lg border border-border p-4" key={c.id}><label className="flex items-start gap-2"><input type="checkbox" disabled={disabled || !c.active || !['google_ads', 'meta_ads'].includes(c.platform)} checked={selection.includes(c.id)} onChange={e => setSelection(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))}/><span className="break-words">{c.name || c.accountId} · {channel(c.platform)}</span></label><p className="mt-2 text-xs text-muted-foreground">Account {c.accountId} · {c.active ? 'Connected; provider access not checked' : 'Inactive'} · Last successful sync: {date(c.lastSyncedAt)}</p>{c.lastError && <p className="mt-2 break-words text-sm">Last reported error: {c.lastError}</p>}</article>)}</div>{connections.length === 0 && <p className="mt-4 text-sm">No ad accounts are connected to this property. <Link href="/dashboard/settings" className="underline">Open settings</Link></p>}
   <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Import period<select className={field} value={period} disabled={disabled} onChange={e => setPeriod(e.target.value)}>{[['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['LAST_7_DAYS', 'Last 7 days'], ['LAST_14_DAYS', 'Last 14 days'], ['LAST_30_DAYS', 'Last 30 days'], ['THIS_MONTH', 'This month'], ['LAST_MONTH', 'Last month']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><button className={button} disabled={disabled || selection.length === 0} onClick={() => void work(() => decide({ operation: 'start', connectionsHash, connectionIds: [...selection].sort(), dateRange: period }))}>Request import</button></div>
  </section>
  <section className={card} aria-label="Import history"><h2 className="text-lg font-semibold">Import history</h2><p className="mt-2 text-sm text-muted-foreground">All recorded imports for this property. Last checked: {date(checkedAt)}. Refresh to see worker progress; queued work has not yet finished.</p><div className="mt-4 space-y-2">{list.items.map(j => <button key={j.id} className="w-full rounded-lg border border-border p-4 text-left hover:bg-muted disabled:opacity-40" disabled={busy} onClick={() => void work(() => choose(j.id))}><span className="block font-medium">{label(j.status, j.error_message)} · {j.channels?.map(channel).join(' + ') || 'Sources not recorded'}</span><span className="mt-1 block text-sm text-muted-foreground">{date(j.created_at)} · {j.records_imported ?? 'Unknown'} records saved{j.retry_of ? ' · Linked retry' : ''}</span></button>)}</div>{pagination(list, loadList)}</section>
  </>}
  {selected && <section className={card} aria-label="Selected import"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{label(selected.status, selected.error_message)} import</h2><button className={button} disabled={busy} onClick={() => void work(() => choose(selected.id))}>Refresh selected import</button></div>
   <p className="mt-3">{selected.current_step || 'No step recorded'}</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Confirmed saved records</dt><dd>{selected.records_imported ?? 'Not recorded'}</dd></div><div><dt className="text-muted-foreground">Requested period</dt><dd>{selected.date_range ? periodLabel(selected.date_range) : 'Not recorded'}</dd></div><div><dt className="text-muted-foreground">Period anchored at</dt><dd>{date(selected.reference_at || selected.created_at)}</dd></div></dl>
   {workerHold && <p role="status" className="mt-3 rounded-lg border border-amber-500 p-3">{workerHold}</p>}
   {selected.error_message && <p className="mt-3 break-words text-sm">{selected.error_message}</p>}{selected.status === 'running' && selected.lease_expires_at && Date.parse(selected.lease_expires_at) < Date.now() && <p className="mt-3 text-sm">The worker’s lease expired. Saved progress is retained; recovery has not been confirmed.</p>}{selected.control_version !== 1 && <p className="mt-3 text-sm">Historical import: source ownership and earlier worker events were not recorded under the current contract.</p>}
   <section aria-label="Saved account progress" className="mt-5"><h3 className="font-medium">Saved account progress</h3><p className="mt-2 text-sm text-muted-foreground">These are retained source reports and committed import checkpoints. They do not prove current provider access, full campaign coverage or business results.</p>{!checkpoint && <p className="mt-2 text-sm">No recoverable account checkpoint was retained for this job.</p>}<div className="mt-3 grid gap-3 sm:grid-cols-2">{accounts.map(a => <article key={a.connection_id} className="min-w-0 rounded-lg border border-border p-3 text-sm"><p>{channel(a.platform)} · {a.account_id}</p><p className="mt-2">Source rows: {a.reportRows ?? 'Not received'} · Saved: {a.offset} · {a.done ? 'Account finished' : 'Account unfinished'}</p>{a.error && <p className="mt-2 break-words">{a.error}</p>}{a.reportHash && <details className="mt-2"><summary>Source fingerprint</summary><p className="mt-2 break-all">{a.reportHash}</p></details>}</article>)}</div></section>
   <label className="mt-5 block text-sm">Decision note (optional)<textarea className={field} maxLength={2000} value={note} disabled={disabled} onChange={e => setNote(e.target.value)}/></label><div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={() => void work(() => decide({ operation: 'review', jobId: selected.id, revision: selected.revision, note }))}>Record progress review</button>{selected.recovery_version === 1 && ['pending', 'running'].includes(selected.status) && <button className={button} disabled={disabled} onClick={() => void work(() => decide({ operation: 'stop', jobId: selected.id, revision: selected.revision, note }))}>Stop import</button>}{selected.control_version === 1 && ['partial', 'failed', 'cancelled'].includes(selected.status) && <button className={button} disabled={disabled} onClick={() => void work(() => decide({ operation: 'retry', jobId: selected.id, revision: selected.revision, note }))}>Request linked retry</button>}</div>
   <p className="mt-3 text-xs text-muted-foreground">Stopping prevents further records from being saved and keeps the records already imported. A provider read already underway may finish. A linked retry uses the original date anchor and current authorization for the same source accounts.</p>
   <section className="mt-6" aria-label="Import decision history"><h3 className="font-semibold">Decision and worker history</h3><ol className="mt-3 space-y-3">{history?.items.map(h => <li key={h.id} className="rounded-lg border border-border p-3 text-sm"><p>{actionLabel(h.action)} · {h.actorName} · {date(h.created_at)}</p>{h.note && <p className="mt-2 break-words">{h.note}</p>}<details className="mt-2"><summary>Retained before and after</summary><div className="mt-2 space-y-2 whitespace-pre-wrap break-words"><p>Before: {evidenceSummary(h.before_state)}</p><p>After: {evidenceSummary(h.after_state)}</p></div></details></li>)}</ol>{history?.count === 0 && <p className="mt-2 text-sm">No recorded decisions or worker events for this historical job.</p>}{pagination(history, async (offset, hash) => setHistory(await request({ kind: 'history', id: selected.id, offset, expectedHash: hash }) as Page<History>))}</section>
  </section>}
 </main>;
}
export default function PipelinesPage() {
    const { currentProperty, loading, hasLoadedProperties } = usePropertyContext();
    if (loading)
        return <p role="status" className="p-8">Loading property…</p>;
    if (!hasLoadedProperties)
        return <p role="alert" className="p-8">Your property records are unavailable. Reload to try again.</p>;
    return <PropertyPipelines key={currentProperty.id} propertyId={currentProperty.id} propertyName={currentProperty.name}/>;
}
