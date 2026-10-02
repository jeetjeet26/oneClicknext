'use client';
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { queryPlan, planFits, pendingQuery, type QueryPlan } from '@/utils/analytics/query-contracts';
import { metricCurrency, metricPercent, type BiReport } from '@/utils/analytics/report-data';
import type { QueryResult } from '@/utils/analytics/query-data';
import type { BiFilters } from '@/utils/analytics/report-contracts';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40', field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2';
const groupLabels: Record<QueryPlan['groupBy'], string> = { none: 'Whole period', day: 'Day', week: 'Week (Monday start)', month: 'Month', channel: 'Channel', campaign: 'Campaign and account' };
const stateLabels: Record<string, string> = { requested: 'Awaiting interpretation', planning: 'Interpretation started; outcome unconfirmed', review: 'Plan ready for review', complete: 'Calculated', held: 'Needs review', cancelled: 'Cancelled' };
const key = (actor: string, property: string) => `p11.bi-query.v1:${actor}:${property}`;
type Summary = {
    id: string;
    question: string;
    status: string;
    revision: number;
    createdAt: string;
};
type Query = {
    id: string;
    state: string;
    revision: number;
    input: {
        question: string;
        mode: string;
    };
    filters: BiFilters;
    propertyName: string;
    source_hash: string;
    plan: QueryPlan | null;
    plan_hash: string | null;
    result_hash: string | null;
    issue: string | null;
    created_at: string;
};
type History = {
    id: string;
    action: string;
    actor_id: string | null;
    created_at: string;
    details: Record<string, unknown>;
    before: {
        plan: QueryPlan | null;
    } | null;
    after: {
        plan: QueryPlan | null;
    } | null;
};
type PageData<T> = {
    items: T[];
    count: number;
    hash: string;
    offset: number;
};
type ResponseData = Partial<PageData<unknown>> & {
    propertyId: string;
    actorId: string;
    id?: string;
    queryId?: string;
    status?: string;
    assistantEnabled: boolean;
    query?: Query;
    result?: Omit<QueryResult, 'rows'> | null;
    interpretation?: {
        providerId?: string;
        model?: string;
        issue?: string;
        rawOmitted?: boolean;
    } | null;
};
type Props = {
    propertyId: string;
    report: (BiReport & {
        sourceHash: string;
        actorId: string;
    }) | null;
};
const initialPlan = (filters: BiFilters, groupBy: QueryPlan['groupBy'] = 'none'): QueryPlan => ({ groupBy, startDate: filters.startDate, endDate: filters.endDate, channel: null });
const describePlan = (p: QueryPlan) => `${groupLabels[p.groupBy]}, ${p.startDate} through ${p.endDate}, ${p.channel || 'all channels in the saved report'}`;
const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
export function NaturalLanguageQuery(props: Props) { return <QueryManager key={props.propertyId} {...props}/>; }
function QueryManager({ propertyId, report }: Props) {
    const controller = useRef<AbortController | null>(null), locked = useRef(false);
    const [actor, setActor] = useState(''), [assistant, setAssistant] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState<{
        id: string;
    } | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [list, setList] = useState<PageData<Summary> | null>(null), [selected, setSelected] = useState<ResponseData | null>(null), [rows, setRows] = useState<PageData<QueryResult['rows'][number]> | null>(null), [history, setHistory] = useState<PageData<History> | null>(null), [plan, setPlan] = useState<QueryPlan | null>(null), [question, setQuestion] = useState(''), [mode, setMode] = useState<'manual' | 'assistant'>('manual'), [group, setGroup] = useState<QueryPlan['groupBy']>('none'), [chartMetric, setChartMetric] = useState<'spend' | 'clicks' | 'impressions' | 'conversions'>('clicks');
    async function request(params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actor): Promise<ResponseData> {
        const query = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...params, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/analytics/query' + (method === 'GET' ? '?' + query : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, propertyId, expectedActorId: expectedActor }) } : {}) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Query history could not be confirmed.');
        if (result.propertyId !== propertyId || params.id && result.id !== params.id || method === 'GET' && expectedActor && result.actorId !== expectedActor)
            throw new Error('This query response does not match the current account or request.');
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
                const p = pendingQuery.safeParse(JSON.parse(raw));
                if (!p.success)
                    throw new Error('This browser has an unreadable query request. Keep this tab and contact your administrator.');
                setPending(p.data);
            }
            setActor(r.actorId);
            setAssistant(r.assistantEnabled);
            setList(r as PageData<Summary>);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Query history unavailable.');
        });
        return () => abort.abort();
        // The selected property owns this component and its request lifetime.
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
                setError(e instanceof Error ? e.message : 'Query result could not be confirmed.');
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
            throw new Error('Allow browser storage to retain the request before continuing. Keep this tab open.');
        }
        setPending(p);
    }
    async function refresh(offset = 0, expectedHash?: string) { const r = await request({ kind: 'list', offset, expectedHash }); setList(r as PageData<Summary>); setAssistant(r.assistantEnabled); }
    async function readRows(id: string, offset = 0, expectedHash?: string) { setRows(await request({ kind: 'rows', id, offset, expectedHash }) as PageData<QueryResult['rows'][number]>); }
    async function readHistory(id: string, offset = 0, expectedHash?: string) { setHistory(await request({ kind: 'history', id, offset, expectedHash }) as PageData<History>); }
    async function open(id: string) { setSelected(null); setRows(null); setHistory(null); const r = await request({ kind: 'detail', id }); setSelected(r); setPlan(r.query!.plan || initialPlan(r.query!.filters)); await Promise.all([readRows(id), readHistory(id)]); }
    async function settle(r: ResponseData) {
        retain(null);
        setMessage(r.status === 'cancelled_request' ? 'Unused query request cancelled.' : 'Query decision confirmed.');
        await refresh();
        if (r.queryId)
            await open(r.queryId);
    }
    async function decide(input: Record<string, unknown>) { const p = { id: crypto.randomUUID() }; retain(p); await settle(await request({ ...input, id: p.id }, 'POST')); }
    const blocked = busy || !!pending || !actor, q = selected?.query, canChange = q && !['complete', 'cancelled'].includes(q.state);
    const pages = (p: PageData<unknown>, size: number, load: (offset: number, hash: string) => void) => <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>{p.count ? `${p.offset + 1}–${Math.min(p.offset + size, p.count)} of ${p.count}` : '0 records'}</span><button className={button} disabled={blocked || !p.offset} onClick={() => load(Math.max(0, p.offset - size), p.hash)}>Previous page</button><button className={button} disabled={blocked || p.offset + size >= p.count} onClick={() => load(p.offset + size, p.hash)}>Next page</button></div>;
    return <section aria-label="Marketing queries" className="space-y-5 rounded-xl border border-border bg-background p-5 sm:p-6">
 <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Explore your marketing data</h2><p className="text-sm text-muted-foreground">Review a plan, then calculate from the exact saved report.</p></div><button className={button} disabled={blocked} onClick={() => void work(async () => {
            await refresh();
            if (q)
                await open(q.id);
        })}>Refresh queries</button></div>
 {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
 {pending && <section aria-label="Pending query request" className="space-y-3 rounded-lg border border-amber-300 p-4"><p className="text-sm">A query decision needs confirmation before another change.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ kind: 'command', id: pending.id })))}>Check query request</button><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST')))}>Cancel unused query request</button></div></section>}
 <form aria-label="Prepare marketing query" onSubmit={e => {
            e.preventDefault();
            void work(async () => {
                if (!report || report.actorId !== actor)
                    throw new Error('Load the current report before preparing a query.');
                await decide({ operation: 'request', mode, question: question.trim(), filters: report.source.filters, sourceHash: report.sourceHash, ...(mode === 'manual' ? { plan: initialPlan(report.source.filters, group) } : {}) });
            });
        }} className="space-y-4">
 <fieldset disabled={blocked || !report || report.actorId !== actor} className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Report name or question<textarea required maxLength={2000} rows={2} className={field} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Marketing totals by channel"/></label><div className="space-y-3"><label className="block text-sm">Build the plan<select className={field} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="manual">Choose grouping</option><option value="assistant" disabled={!assistant}>Interpret a question</option></select></label>{mode === 'manual' && <label className="block text-sm">Group results by<select className={field} value={group} onChange={e => setGroup(e.target.value as typeof group)}>{Object.entries(groupLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}</div></fieldset>
 <p className="text-sm text-muted-foreground">{report ? `Uses the selected report: ${report.dateRange.start} through ${report.dateRange.end}, ${report.source.filters.channel || 'all channels'}, ${report.source.filters.account || 'all accounts'}.` : 'Load a report to prepare a new query. Saved queries remain available below.'} Rankings, forecasts, causal claims and custom calculations are unsupported.</p>{!assistant && <p className="text-sm text-muted-foreground">Question interpretation is paused. You can prepare and review a plan using the grouping controls.</p>}
 <button className={button} type="submit" disabled={blocked || !report || report.actorId !== actor || !question.trim() || mode === 'assistant' && !assistant}>Prepare query</button>
 </form>
 <section aria-label="Saved query list" className="space-y-2 border-t border-border pt-4"><h3 className="font-semibold">Your saved queries</h3><p className="text-xs text-muted-foreground">Private to your account in this property. Previous browser-only history is not included because it had no reliable property identity.</p>{list?.items.map(item => <button key={item.id} className="block w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-40" disabled={blocked} onClick={() => void work(() => open(item.id))}><span className="block break-words font-medium">{item.question}</span><span className="text-xs text-muted-foreground">{stateLabels[item.status]} · {new Date(item.createdAt).toLocaleString()}</span></button>)}{list && !list.items.length && <p className="text-sm text-muted-foreground">No saved queries.</p>}{list && pages(list, 20, (offset, hash) => void work(() => refresh(offset, hash)))}</section>
 {q && <section aria-label="Selected marketing query" className="space-y-4 border-t border-border pt-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="break-words font-semibold">{q.input.question}</h3><p className="text-sm text-muted-foreground">{stateLabels[q.state]} · Revision {q.revision} · Saved {new Date(q.created_at).toLocaleString()}</p></div>{canChange && <button className={button} disabled={blocked} onClick={() => void work(() => decide({ operation: 'stop', queryId: q.id, expectedRevision: q.revision }))}>Stop query</button>}</div>
 <p className="text-sm text-muted-foreground">This query retains its original report, even after new imports. Dates and week boundaries use UTC. Reported conversions may be fractional and are not unique people or verified leases.</p>
 {q.issue && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{q.issue === 'unsupported' ? 'This question is outside the supported calculations. Choose a plan below.' : q.issue === 'provider_unknown' ? 'The interpretation outcome is unknown. No automatic retry will occur. You can choose a plan below.' : q.issue === 'access_changed' ? 'Access changed during interpretation. Review your current access and plan.' : 'The interpretation needs review. Choose a supported plan below.'}</p>}
 {selected?.interpretation && <p className="break-words text-xs text-muted-foreground">Interpretation: {selected.interpretation.model || 'Unknown model'}{selected.interpretation.providerId ? ` · Provider reference ${selected.interpretation.providerId}` : ''}. A model plan is a suggestion, not a calculated result.</p>}
 {canChange && plan && <form aria-label="Review query plan" className="space-y-4 rounded-lg border border-border p-4" onSubmit={e => {
                    e.preventDefault();
                    void work(async () => {
                        const parsed = queryPlan.safeParse(plan);
                        if (!parsed.success || !planFits(parsed.data, q.filters))
                            throw new Error('Choose a plan within the original report’s dates and channel.');
                        await decide({ operation: 'revise', queryId: q.id, expectedRevision: q.revision, plan: parsed.data });
                    });
                }}><h4 className="font-medium">Review query plan</h4><fieldset disabled={blocked} className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Reviewed grouping<select className={field} value={plan.groupBy} onChange={e => setPlan({ ...plan, groupBy: e.target.value as QueryPlan['groupBy'] })}>{Object.entries(groupLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="text-sm">Reviewed channel<select className={field} value={plan.channel || ''} onChange={e => setPlan({ ...plan, channel: e.target.value || null })}><option value="">All channels in saved report</option>{(q.filters.channel ? [q.filters.channel] : ['google_ads', 'meta_ads', 'ga4', 'tiktok_ads', 'linkedin_ads', 'bing_ads']).map(v => <option value={v} key={v}>{v.replaceAll('_', ' ')}</option>)}</select></label><label className="text-sm">Start date<input required className={field} type="date" min={q.filters.startDate} max={q.filters.endDate} value={plan.startDate} onChange={e => setPlan({ ...plan, startDate: e.target.value })}/></label><label className="text-sm">End date<input required className={field} type="date" min={q.filters.startDate} max={q.filters.endDate} value={plan.endDate} onChange={e => setPlan({ ...plan, endDate: e.target.value })}/></label></fieldset><p className="text-xs text-muted-foreground">Account remains {q.filters.account || 'all accounts in the saved report'}. Corrected plans are recorded separately from the original suggestion.</p><div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={blocked}>Save reviewed plan</button><button type="button" className={button} disabled={blocked || q.state !== 'review' || JSON.stringify(plan) !== JSON.stringify(q.plan)} onClick={() => void work(() => decide({ operation: 'execute', queryId: q.id, expectedRevision: q.revision, planHash: q.plan_hash }))}>Calculate saved plan</button></div></form>}
 {!canChange && q.plan && <p className="text-sm">Plan: {describePlan(q.plan)}</p>}
 {selected?.result && <section aria-label="Query results" className="space-y-4"><h4 className="font-medium">Calculated results</h4><p className="text-sm text-muted-foreground">{selected.result.coverage.records} stored records across {selected.result.coverage.observedDays} of {selected.result.coverage.requestedDays} selected dates. Missing dates are unknown. Coverage does not establish complete provider delivery.</p><p className="text-sm">Spend: {metricCurrency(selected.result.totals.spend)} · Clicks: {number(selected.result.totals.clicks)} · Reported conversions: {number(selected.result.totals.conversions)}</p><p className="text-xs text-muted-foreground">CTR = clicks ÷ impressions; CPC = spend ÷ clicks; CPA = spend ÷ reported conversions. Undefined rates and unconfirmed USD amounts are unavailable.</p>
 {rows && rows.items.length > 1 && <div className="space-y-2"><label className="block max-w-xs text-sm">Chart metric<select className={field} value={chartMetric} onChange={e => setChartMetric(e.target.value as typeof chartMetric)}><option value="clicks">Clicks</option><option value="impressions">Impressions</option><option value="spend">Spend (USD where known)</option><option value="conversions">Reported conversions</option></select></label><p className="text-xs text-muted-foreground">Chart shows this results page. Full figures are listed below.</p><div className="h-56 w-full" role="img" aria-label={`${chartMetric} for the current results page`}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.items}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="label" hide/><YAxis /><Tooltip /><Bar dataKey={chartMetric} fill="#4f46e5"/></BarChart></ResponsiveContainer></div></div>}
 <div className="grid gap-3 md:grid-cols-2">{rows?.items.map(r => <article key={r.key} className="min-w-0 space-y-2 rounded-lg border border-border p-3 text-sm"><h5 className="break-words font-medium">{r.label}</h5>{r.campaignId && <p className="break-all text-xs text-muted-foreground">{r.channel} · Account {r.account || 'unattributed'} · Campaign {r.campaignId}</p>}<dl className="grid grid-cols-2 gap-2"><div><dt className="text-xs text-muted-foreground">Spend</dt><dd>{metricCurrency(r.spend)}</dd></div><div><dt className="text-xs text-muted-foreground">Impressions</dt><dd>{number(r.impressions)}</dd></div><div><dt className="text-xs text-muted-foreground">Clicks</dt><dd>{number(r.clicks)}</dd></div><div><dt className="text-xs text-muted-foreground">Conversions</dt><dd>{number(r.conversions)}</dd></div><div><dt className="text-xs text-muted-foreground">CTR</dt><dd>{metricPercent(r.ctr)}</dd></div><div><dt className="text-xs text-muted-foreground">CPC / CPA</dt><dd>{metricCurrency(r.cpc)} / {metricCurrency(r.cpa)}</dd></div></dl></article>)}</div>{rows && !rows.items.length && <p>No matching stored records. No zero-filled results were invented.</p>}{rows && pages(rows, 25, (offset, hash) => void work(() => readRows(q.id, offset, hash)))}</section>}
 {history && <section aria-label="Query decision history" className="space-y-2"><h4 className="font-medium">Query decision history</h4>{history.items.map(h => <article className="rounded-lg bg-muted p-3 text-sm" key={h.id}><p>{h.actor_id ? 'Your decision' : 'Interpretation service'} · {h.action.replace('bi.query.', '').replaceAll('_', ' ')} · {new Date(h.created_at).toLocaleString()}</p>{h.before?.plan && <p>Before: {describePlan(h.before.plan)}</p>}{h.after?.plan && <p>After: {describePlan(h.after.plan)}</p>}</article>)}{pages(history, 20, (offset, hash) => void work(() => readHistory(q.id, offset, hash)))}</section>}
 </section>}
 </section>;
}
