'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { detectBiChanges, type MarketingChange, type MarketingChanges } from '@/utils/analytics/alert-data';
import { pendingAlert } from '@/utils/analytics/alert-contracts';
import { metricCurrency, type BiReport } from '@/utils/analytics/report-data';
import type { BiFilters } from '@/utils/analytics/report-contracts';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40', field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2';
const key = (actor: string, property: string) => `p11.bi-alert.v1:${actor}:${property}`;
const metricLabels = { spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', conversions: 'Reported conversions' };
const format = (a: MarketingChange, n: number) => a.metric === 'spend' ? metricCurrency(n) : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const description = (a: MarketingChange) => `${metricLabels[a.metric]} ${a.percent >= 0 ? 'above' : 'below'} ${a.kind === 'daily' ? 'other-day average on ' + a.date : 'previous period'} by ${Math.abs(a.percent).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
type Item = {
    set_id: string;
    item_key: string;
    revision: number;
    state: 'open' | 'reviewed' | 'dismissed';
    alert: MarketingChange;
    alert_hash: string;
    note: string | null;
    last_actor_id: string | null;
};
type ReviewSet = {
    id: string;
    sourceHash: string;
    filters: BiFilters;
    createdAt: string;
    count?: number;
    definition?: Omit<MarketingChanges, 'alerts'>;
};
type History = {
    id: string;
    actorName: string;
    input: {
        operation: string;
        note?: string;
    };
    before_state: Array<{
        key: string;
        state: string;
        revision: number;
        note: string | null;
    }>;
    after_state: Array<{
        key: string;
        state: string;
        revision: number;
        note: string | null;
    }>;
    result: {
        count?: number;
    };
    created_at: string;
};
type PageData<T> = {
    items: T[];
    count: number;
    hash: string;
    offset: number;
};
type Result = Partial<PageData<unknown>> & {
    propertyId: string;
    actorId: string;
    id?: string;
    setId?: string;
    status?: string;
    canManage?: boolean;
    set?: ReviewSet;
    counts?: Record<'all' | 'open' | 'reviewed' | 'dismissed', number>;
};
type Props = {
    propertyId: string;
    report: (BiReport & {
        sourceHash: string;
        actorId: string;
    }) | null;
};
export function AnomalyAlert(props: Props) { return <ChangeReview key={props.propertyId} {...props}/>; }
function ChangeReview({ propertyId, report }: Props) {
    const live = useMemo(() => report ? detectBiChanges(report, report.sourceHash) : null, [report]);
    const controller = useRef<AbortController | null>(null), locked = useRef(false);
    const [open, setOpen] = useState(false), [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<{
        id: string;
    } | null>(null);
    const [list, setList] = useState<PageData<ReviewSet> | null>(null), [selected, setSelected] = useState<ReviewSet | null>(null), [items, setItems] = useState<PageData<Item> | null>(null), [counts, setCounts] = useState<Result['counts']>(), [history, setHistory] = useState<PageData<History> | null>(null), [bucket, setBucket] = useState<'all' | 'open' | 'reviewed' | 'dismissed'>('all'), [selection, setSelection] = useState<string[]>([]), [note, setNote] = useState('');
    async function request(params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actor): Promise<Result> {
        const q = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...params, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/analytics/alerts' + (method === 'GET' ? '?' + q : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, propertyId, expectedActorId: expectedActor }) } : {}) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Change review could not be confirmed.');
        if (result.propertyId !== propertyId || params.id && result.id !== params.id || method === 'GET' && expectedActor && result.actorId !== expectedActor)
            throw new Error('This review response does not match the current account or request.');
        return result;
    }
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        void request({ kind: 'list' }, 'GET', '').then(r => {
            if (abort.signal.aborted)
                return;
            const raw = sessionStorage.getItem(key(r.actorId, propertyId));
            if (raw) {
                const p = pendingAlert.safeParse(JSON.parse(raw));
                if (!p.success)
                    throw new Error('This browser has an unreadable change review request. Keep this tab and contact your administrator.');
                setPending(p.data);
                setOpen(true);
            }
            setActor(r.actorId);
            setCanManage(!!r.canManage);
            setList(r as PageData<ReviewSet>);
        }).catch(e => {
            if (!abort.signal.aborted) {
                setError(e instanceof Error ? e.message : 'Change review unavailable.');
                setOpen(true);
            }
        });
        return () => abort.abort();
        // The property-keyed review aborts stale reads when the selected property changes.
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
                setError(e instanceof Error ? e.message : 'Change review could not be confirmed.');
        }
        finally {
            locked.current = false;
            if (!controller.current?.signal.aborted)
                setBusy(false);
        }
    }
    function retain(p: {
        id: string;
    } | null) {
        try {
            if (p)
                sessionStorage.setItem(key(actor, propertyId), JSON.stringify(p));
            else
                sessionStorage.removeItem(key(actor, propertyId));
        }
        catch {
            throw new Error('Allow browser storage to retain this review request. Keep this tab open.');
        }
        setPending(p);
    }
    async function refresh(offset = 0, expectedHash?: string) { const r = await request({ kind: 'list', offset, expectedHash }); setList(r as PageData<ReviewSet>); setCanManage(!!r.canManage); }
    async function itemPage(id: string, filter = bucket, offset = 0, expectedHash?: string) { const r = await request({ kind: 'items', id, bucket: filter, offset, expectedHash }); setSelected(r.set!); setItems(r as PageData<Item>); setCounts(r.counts); setBucket(filter); setSelection([]); setCanManage(!!r.canManage); }
    async function historyPage(id: string, offset = 0, expectedHash?: string) { setHistory(await request({ kind: 'history', id, offset, expectedHash }) as PageData<History>); }
    async function choose(id: string) { setSelected(null); setItems(null); setHistory(null); setNote(''); await Promise.all([itemPage(id, 'all'), historyPage(id)]); }
    async function settle(r: Result) {
        retain(null);
        setNote('');
        setMessage(r.status === 'cancelled_request' ? 'Unused change review request cancelled.' : r.status === 'ready' ? 'Changes saved for review.' : `${r.count || 0} change${r.count === 1 ? '' : 's'} marked ${r.status}.`);
        await refresh();
        if (r.setId)
            await choose(r.setId);
        else if (selected)
            await choose(selected.id);
    }
    async function decide(input: Record<string, unknown>) { const p = { id: crypto.randomUUID() }; retain(p); await settle(await request({ ...input, id: p.id }, 'POST')); }
    const blocked = busy || !actor, changeBlocked = blocked || !!pending || !canManage;
    const pages = (p: PageData<unknown>, load: (offset: number, hash: string) => void) => <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>{p.count ? `${p.offset + 1}–${Math.min(p.offset + 20, p.count)} of ${p.count}` : '0 records'}</span><button className={button} disabled={blocked || !p.offset} onClick={() => load(Math.max(0, p.offset - 20), p.hash)}>Previous page</button><button className={button} disabled={blocked || p.offset + 20 >= p.count} onClick={() => load(p.offset + 20, p.hash)}>Next page</button></div>;
    const comparable = live && (live.coverage.dailyEligible || live.coverage.periodEligible);
    async function mark(operation: 'review' | 'dismiss' | 'restore') {
        if (!selected || !items)
            return;
        const chosen = items.items.filter(i => selection.includes(i.item_key)).map(i => ({ key: i.item_key, revision: i.revision }));
        if (chosen.length !== selection.length || !chosen.length)
            throw new Error('Choose the changes from the current page.');
        await decide({ operation, setId: selected.id, items: chosen, note });
    }
    return <section aria-label="Marketing change review" className="rounded-xl border border-border bg-background p-4 sm:p-5">
 <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Changes to review</h2><p className="text-sm text-muted-foreground">{!live ? 'Current report unavailable.' : !comparable ? 'Not enough comparable data for these review rules.' : `${live.alerts.length} changes meet the review thresholds.`}{pending ? ' A review decision needs confirmation.' : ''}</p></div><button className={button} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close change review' : 'Open change review'}</button></div>
 {open && <div className="mt-5 space-y-5">
 <p className="text-sm text-muted-foreground">These are fixed comparison rules, not verified problems or business outcomes. Daily checks require seven complete dates and compare each date with the other dates’ average. Period checks require complete, equal-length periods. Zero baselines and unknown amounts cannot produce percentage comparisons. Stored date coverage does not prove complete provider delivery.</p>
 {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
 {pending && <section aria-label="Pending change review request" className="space-y-3 rounded-lg border border-amber-300 p-3"><p className="text-sm">Confirm this request before recording another decision. You can still inspect saved reviews.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ kind: 'command', id: pending.id })))}>Check change review request</button><button className={button} disabled={busy || !canManage} onClick={() => void work(async () => settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST')))}>Cancel unused review request</button></div></section>}
 {!canManage && actor && <p className="text-sm text-muted-foreground">An administrator or manager can record review decisions.</p>}
 <div className="flex flex-wrap gap-2"><button className={button} disabled={changeBlocked || !report || report.actorId !== actor} onClick={() => void work(() => decide({ operation: 'prepare', filters: report!.source.filters, sourceHash: report!.sourceHash }))}>Save current changes for review</button><button className={button} disabled={blocked} onClick={() => void work(async () => {
                await refresh();
                if (selected)
                    await choose(selected.id);
            })}>Refresh change reviews</button></div>
 <section aria-label="Saved change reviews" className="space-y-2"><h3 className="font-medium">Saved reviews</h3>{list?.items.map(s => <button key={s.id} className="block w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-40" disabled={blocked} onClick={() => void work(() => choose(s.id))}><span className="block">{s.filters.startDate} through {s.filters.endDate} · {s.count} changes</span><span className="text-xs text-muted-foreground">{s.filters.channel || 'All channels'} · {s.filters.account || 'All accounts'} · Saved {new Date(s.createdAt).toLocaleString()}</span></button>)}{list && !list.items.length && <p className="text-sm text-muted-foreground">No saved change reviews.</p>}{list && pages(list, (offset, hash) => void work(() => refresh(offset, hash)))}</section>
 {selected && items && <section aria-label="Selected change review" className="space-y-4 border-t border-border pt-4"><h3 className="font-semibold">{selected.filters.startDate} through {selected.filters.endDate}</h3><p className="text-sm text-muted-foreground">{report?.sourceHash === selected.sourceHash ? 'Matches the displayed report snapshot.' : 'Historical review: these figures are retained from the original report.'} New imports do not inherit these review decisions.</p><p className="text-xs text-muted-foreground">Thresholds: spend 50%, impressions and clicks 40%, reported conversions 60%. No increase or decrease is assumed to be good or bad.</p>
 {selected.definition && !selected.definition.coverage.dailyEligible && !selected.definition.coverage.periodEligible && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">There were not enough comparable dates to apply these rules. Review data coverage before drawing a conclusion.</p>}
 <label className="block max-w-xs text-sm">Review status<select className={field} disabled={blocked} value={bucket} onChange={e => void work(() => itemPage(selected.id, e.target.value as typeof bucket))}><option value="all">All ({counts?.all || 0})</option><option value="open">Open ({counts?.open || 0})</option><option value="reviewed">Reviewed ({counts?.reviewed || 0})</option><option value="dismissed">Dismissed ({counts?.dismissed || 0})</option></select></label>
 <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={changeBlocked || !items.items.length} onClick={() => setSelection(items.items.map(i => i.item_key))}>Select this page</button><button className={button} disabled={blocked || !selection.length} onClick={() => setSelection([])}>Clear selection</button><span className="text-xs">{selection.length} selected</span></div>
 <div className="grid gap-3 md:grid-cols-2">{items.items.map(i => <article className="min-w-0 space-y-2 rounded-lg border border-border p-3" key={i.item_key}><label className="flex items-start gap-3 text-sm font-medium"><input type="checkbox" className="mt-1" disabled={changeBlocked} checked={selection.includes(i.item_key)} onChange={e => setSelection(e.target.checked ? [...selection, i.item_key] : selection.filter(k => k !== i.item_key))}/><span>{description(i.alert)}</span></label><p className="text-sm">Value {format(i.alert, i.alert.value)} · Comparison {format(i.alert, i.alert.baseline)}</p><p className="text-xs text-muted-foreground">{i.state} · Revision {i.revision}</p>{i.note && <p className="break-words text-sm">Review note: {i.note}</p>}</article>)}</div>
 {!items.items.length && <p className="text-sm text-muted-foreground">No changes in this selection.</p>}{pages(items, (offset, hash) => void work(() => itemPage(selected.id, bucket, offset, hash)))}
 <label className="block text-sm">Review note (optional)<textarea maxLength={2000} rows={2} className={field} disabled={changeBlocked} value={note} onChange={e => setNote(e.target.value)} placeholder="For example, a planned campaign explains this change."/></label><div className="flex flex-wrap gap-2"><button className={button} disabled={changeBlocked || !selection.length} onClick={() => void work(() => mark('review'))}>Mark selected reviewed</button><button className={button} disabled={changeBlocked || !selection.length} onClick={() => void work(() => mark('dismiss'))}>Dismiss selected</button><button className={button} disabled={changeBlocked || !selection.length} onClick={() => void work(() => mark('restore'))}>Restore selected</button></div>
 </section>}
 {selected && history && <section aria-label="Change decision history" className="space-y-3 border-t border-border pt-4"><h3 className="font-medium">Decision history</h3>{history.items.map(h => <article key={h.id} className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p>{h.input.operation === 'prepare' ? 'Review prepared' : h.input.operation === 'review' ? 'Marked reviewed' : h.input.operation === 'dismiss' ? 'Dismissed' : 'Restored'} · {h.actorName} · {new Date(h.created_at).toLocaleString()} · {h.result.count || 0} changes</p>{h.input.note && <p className="break-words">Note: {h.input.note}</p>}<details><summary className="cursor-pointer text-xs">Exact selection and previous states</summary><ul className="mt-2 space-y-1 text-xs">{h.before_state.map(item => <li key={item.key} className="break-words">{item.key.replaceAll(':', ' · ')}: {item.state}, revision {item.revision}{item.note ? ' · Previous note: ' + item.note : ''}</li>)}</ul></details></article>)}{pages(history, (offset, hash) => void work(() => historyPage(selected.id, offset, hash)))}</section>}
 </div>}
 </section>;
}
