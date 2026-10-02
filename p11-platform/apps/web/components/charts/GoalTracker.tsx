'use client';
import { useEffect, useRef, useState } from 'react';
import { goalValues, pendingGoal, type GoalValues, type MetricGoal } from '@/utils/analytics/goal-contracts';
import { goalProgress, goalReportValue } from '@/utils/analytics/goal-comparison';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
const field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2';
const labels: Record<string, string> = { spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', conversions: 'Conversions', ctr: 'Click-through rate', cpa: 'Cost per conversion', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const initial: GoalValues = { metric: 'conversions', period: 'monthly', target: 100, direction: 'at_least', threshold: 80 };
const key = (actor: string, property: string) => `p11.bi-goal.v1:${actor}:${property}`;
type History = {
    id: string;
    operation: string;
    created_at: string;
    before_state: MetricGoal | null;
    after_state: MetricGoal | null;
    result: {
        status: string;
    };
};
type PageData<T> = {
    items: T[];
    count: number;
    hash: string;
    offset: number;
};
type Result = PageData<MetricGoal | History> & {
    actorId: string;
    propertyId: string;
    id?: string;
    canManage: boolean;
    status?: string;
};
type Props = {
    propertyId: string;
    currentMetrics: Partial<Record<GoalValues['metric'], number | null>>;
    reportRange?: {
        start: string;
        end: string;
    };
    filtered?: boolean;
    coverageComplete?: boolean;
};
const format = (v: number) => Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : 'Needs review';
function description(g: MetricGoal) { return `${labels[g.goal_type] || g.goal_type} ${labels[g.metric_key] || g.metric_key}: ${g.is_inverse ? 'at most' : 'at least'} ${format(g.target_value)}${g.metric_key === 'ctr' ? '%' : ''}`; }
export function GoalTracker(props: Props) { return <GoalManager key={props.propertyId} {...props}/>; }
function GoalManager({ propertyId, currentMetrics, reportRange, filtered = false, coverageComplete = false }: Props) {
    const controller = useRef<AbortController | null>(null), locked = useRef(false), form = useRef<HTMLFormElement>(null);
    const [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [goals, setGoals] = useState<PageData<MetricGoal> | null>(null), [history, setHistory] = useState<PageData<History> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<{
        id: string;
    } | null>(null), [editing, setEditing] = useState<MetricGoal | null>(null), [values, setValues] = useState<GoalValues>(initial), [showForm, setShowForm] = useState(false);
    async function request(params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actor): Promise<Result> {
        const q = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...params, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/analytics/goals' + (method === 'GET' ? '?' + q : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, propertyId, expectedActorId: expectedActor }) } : {}) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Goal history could not be confirmed.');
        if (result.propertyId !== propertyId || params.id && result.id !== params.id || method === 'GET' && expectedActor && result.actorId !== expectedActor)
            throw new Error('This goal response does not match the current account or request.');
        return result;
    }
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        void request({ kind: 'goals' }, 'GET', '').then(r => { if (abort.signal.aborted)
            return; const raw = sessionStorage.getItem(key(r.actorId, propertyId)); if (raw) {
            const p = pendingGoal.safeParse(JSON.parse(raw));
            if (!p.success)
                throw new Error('This browser has an unreadable goal request. Keep this tab and contact your administrator.');
            setPending(p.data);
        } setActor(r.actorId); setCanManage(r.canManage); setGoals(r as PageData<MetricGoal>); }).catch(e => { if (!abort.signal.aborted)
            setError(e instanceof Error ? e.message : 'Goals unavailable.'); });
        return () => abort.abort();
        // Property-keyed lifetime fences requests when the selected property changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]);
    async function work(fn: () => Promise<void>) { if (locked.current)
        return; locked.current = true; setBusy(true); setError(''); setMessage(''); try {
        await fn();
    }
    catch (e) {
        if (!controller.current?.signal.aborted)
            setError(e instanceof Error ? e.message : 'Goal request could not be confirmed.');
    }
    finally {
        locked.current = false;
        if (!controller.current?.signal.aborted)
            setBusy(false);
    } }
    function retain(p: {
        id: string;
    } | null) { try {
        if (p)
            sessionStorage.setItem(key(actor, propertyId), JSON.stringify(p));
        else
            sessionStorage.removeItem(key(actor, propertyId));
    }
    catch {
        throw new Error('Allow browser storage to retain this goal request. Keep this tab open.');
    } setPending(p); }
    async function refresh(offset = 0, expectedHash?: string) { const r = await request({ kind: 'goals', offset, expectedHash }); setGoals(r as PageData<MetricGoal>); setCanManage(r.canManage); }
    async function historyPage(offset = 0, expectedHash?: string) { setHistory(await request({ kind: 'history', offset, expectedHash }) as PageData<History>); }
    async function settle(r: Result) { retain(null); setShowForm(false); setEditing(null); setMessage(r.status === 'cancelled_request' ? 'Unused goal request cancelled.' : `Goal decision confirmed: ${r.status}.`); await refresh(); if (history)
        await historyPage(); }
    async function decide(input: Record<string, unknown>) { const p = { id: crypto.randomUUID() }; retain(p); await settle(await request({ ...input, id: p.id }, 'POST')); }
    const blocked = busy || !!pending || !actor, changeBlocked = blocked || !canManage;
    const pages = (p: PageData<unknown>, load: (offset: number, hash: string) => void) => <div className="mt-4 flex flex-wrap items-center gap-3 text-xs"><span>{p.count ? `${p.offset + 1}–${Math.min(p.offset + 20, p.count)} of ${p.count}` : '0 records'}</span><button type="button" className={button} disabled={blocked || !p.offset} onClick={() => load(Math.max(0, p.offset - 20), p.hash)}>Previous page</button><button type="button" className={button} disabled={blocked || p.offset + 20 >= p.count} onClick={() => load(p.offset + 20, p.hash)}>Next page</button></div>;
    function edit(g: MetricGoal | null) { setEditing(g); setValues(g ? { metric: g.metric_key, period: g.goal_type, target: g.target_value, direction: g.is_inverse ? 'at_most' : 'at_least', threshold: g.alert_threshold_percent } : initial); setShowForm(true); setMessage(''); }
    return <section aria-label="Marketing goals" className="space-y-4 rounded-xl border border-border bg-background p-5 sm:p-6">
 <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Marketing goals</h2><p className="text-sm text-muted-foreground">Property targets and their recorded decisions.</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={blocked} onClick={() => void work(async () => { await refresh(); if (history)
        await historyPage(); })}>Refresh goals</button><button className={button} disabled={blocked} onClick={() => void work(() => historyPage())}>Goal history</button><button className={button} disabled={changeBlocked} onClick={() => edit(null)}>Add goal</button></div></div>
 <p className="text-sm text-muted-foreground">Comparisons need a complete calendar period, every date covered, and all channels and accounts. Weeks run Monday through Sunday in UTC. A goal is a target, not a verified business outcome.</p>
 {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
 {pending && <section aria-label="Pending goal request" className="space-y-3 rounded-lg border border-amber-300 p-4"><p className="text-sm">A goal request needs confirmation before another change.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ kind: 'command', id: pending.id })))}>Check goal request</button><button className={button} disabled={busy || !canManage} onClick={() => void work(async () => settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST')))}>Cancel unused goal request</button></div></section>}
 {!canManage && actor && <p className="text-sm text-muted-foreground">An administrator or manager can change these goals.</p>}
 <section aria-label="Saved marketing goals" className="space-y-3">
 {goals?.items.length === 0 && <p className="text-sm text-muted-foreground">No goals yet.</p>}
 {goals?.items.map(g => {
            const value = goalReportValue(currentMetrics[g.metric_key], g.goal_type, reportRange, filtered, coverageComplete), progress = g.is_active ? goalProgress(value, g.target_value, g.is_inverse, g.alert_threshold_percent) : null;
            return <article key={g.id} aria-label={description(g)} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{description(g)}</h3><p className="text-xs text-muted-foreground">{g.is_active ? 'Active' : 'Archived'} · Revision {g.revision} · Warning below {g.alert_threshold_percent}% of target performance</p></div><div className="flex gap-2">{g.is_active && <button className={button} disabled={changeBlocked} onClick={() => edit(g)}>Edit goal</button>}<button className={button} disabled={changeBlocked} onClick={() => void work(() => decide({ operation: g.is_active ? 'archive' : 'restore', goalId: g.id, expectedRevision: g.revision }))}>{g.is_active ? 'Archive goal' : 'Restore goal'}</button></div></div>
 {g.is_active && <p className="mt-3 text-sm">{progress ? `Current value: ${format(value!)}${g.metric_key === 'ctr' ? '%' : ''} · ${progress.achieved ? 'Target met' : progress.warning ? 'Below warning threshold' : 'Target not yet met'}` : 'Comparison unavailable for this report. Choose the complete goal period with all channels and accounts and complete source coverage.'}</p>}
 </article>;
        })}
 {goals && pages(goals, (offset, hash) => void work(() => refresh(offset, hash)))}
 </section>
 {showForm && <form ref={form} aria-label={editing ? 'Edit marketing goal' : 'New marketing goal'} onSubmit={e => { e.preventDefault(); void work(async () => { const parsed = goalValues.safeParse(values); if (!parsed.success)
            throw new Error(parsed.error.issues[0]?.message || 'Review the target.'); await decide({ operation: 'save', goalId: editing?.id || crypto.randomUUID(), expectedRevision: editing?.revision || 0, ...parsed.data }); }); }} className="space-y-4 rounded-xl border border-border p-4">
 <h3 className="font-semibold">{editing ? 'Edit marketing goal' : 'New marketing goal'}</h3><fieldset disabled={changeBlocked} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
 <label className="text-sm">Metric<select className={field} disabled={!!editing} value={values.metric} onChange={e => setValues({ ...values, metric: e.target.value as GoalValues['metric'] })}>{['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpa'].map(v => <option key={v} value={v}>{labels[v]}</option>)}</select></label>
 <label className="text-sm">Goal period<select className={field} disabled={!!editing} value={values.period} onChange={e => setValues({ ...values, period: e.target.value as GoalValues['period'] })}>{['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].map(v => <option key={v} value={v}>{labels[v]}</option>)}</select></label>
 <label className="text-sm">Direction<select className={field} value={values.direction} onChange={e => setValues({ ...values, direction: e.target.value as GoalValues['direction'] })}><option value="at_least">At least</option><option value="at_most">At most</option></select></label>
 <label className="text-sm">Target<input required className={field} type="number" min="0.000001" max={values.metric === 'ctr' ? 100 : 1e12} step={['clicks', 'impressions'].includes(values.metric) ? '1' : 'any'} value={Number.isNaN(values.target) ? '' : values.target} onChange={e => setValues({ ...values, target: e.target.valueAsNumber })}/></label>
 <label className="text-sm">Warning threshold (%)<input required className={field} type="number" min="1" max="100" step="1" value={Number.isNaN(values.threshold) ? '' : values.threshold} onChange={e => setValues({ ...values, threshold: e.target.valueAsNumber })}/></label>
 </fieldset><p className="text-xs text-muted-foreground">For “at least,” performance is current value ÷ target. For “at most,” it is target ÷ current value; zero counts as meeting the target. Money targets use USD, matching the report definition. Mixed, non-USD or missing currencies cannot be compared.</p><div className="flex gap-2"><button className={button} disabled={changeBlocked} type="submit">Save goal</button><button type="button" className={button} disabled={busy || !!pending} onClick={() => setShowForm(false)}>Close goal editor</button></div>
 </form>}
 {history && <section aria-label="Goal decision history" className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Goal decision history</h3><p className="text-xs text-muted-foreground">History begins with recorded decisions. Existing goals may have earlier changes that were not recorded.</p>{history.items.map(h => <article key={h.id} className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p>{h.operation === 'cancel_request' ? 'Unused request cancelled' : h.operation === 'save' ? (h.before_state ? 'Goal edited' : 'Goal created') : h.operation === 'archive' ? 'Goal archived' : 'Goal restored'} · {new Date(h.created_at).toLocaleString()}</p>{h.before_state && <p>Before: {description(h.before_state)} · threshold {h.before_state.alert_threshold_percent}%</p>}{h.after_state && <p>After: {description(h.after_state)} · threshold {h.after_state.alert_threshold_percent}%</p>}</article>)}{!history.items.length && <p className="text-sm">No recorded goal decisions.</p>}{pages(history, (offset, hash) => void work(() => historyPage(offset, hash)))}</section>}
 </section>;
}
