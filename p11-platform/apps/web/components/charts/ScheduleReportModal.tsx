'use client';
import { useEffect, useRef, useState } from 'react';
import { pendingSchedule, scheduleConfig, type BiSchedule, type ScheduleConfig } from '@/utils/analytics/schedule-contracts';
import { metricCurrency, formatScheduleAction } from '@/utils/analytics/schedule-ui-format';
import type { BiReport, BiSource } from '@/utils/analytics/report-data';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
const inputClass = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const key = (actor: string, property: string) => `p11.bi-schedule.v1:${actor}:${property}`;
type PageData = {
    items: Record<string, unknown>[];
    count: number;
    hash: string;
    offset: number;
};
type Result = Record<string, unknown> & {
    actorId: string;
    propertyId: string;
    state: string;
    id?: string;
    status?: string;
    canManage?: boolean;
    deliveryPaused?: boolean;
    items?: Record<string, unknown>[];
    count?: number;
    hash?: string;
    offset?: number;
    schedule?: BiSchedule;
    report?: BiReport | null;
    nextRunAt?: string;
    run?: {
        id: string;
        source: BiSource | null;
        source_hash: string | null;
        state: string;
        issue: string | null;
    };
    deliveries?: Array<{
        id: string;
        recipient: string;
        state: string;
        provider_id: string | null;
    }>;
};
const initial = (name?: string): ScheduleConfig => ({ name: (name || 'Property') + ' weekly report', frequency: 'weekly', weekday: 1, monthday: null, hour: 9, window: 'previous_period', comparison: true, campaigns: true, recipients: [] });
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC' : '—';
const labels: Record<string, string> = { paused: 'Paused', active: 'Scheduled', held: 'Needs review', cancelled: 'Cancelled', accepted: 'Provider accepted', open: 'In progress', closed: 'Ended', empty: 'No completed dates', in_flight: 'Outcome unconfirmed', unknown: 'Outcome unknown', pending: 'Not started', skipped: 'Not sent' };
export function ScheduleReportModal({ isOpen, onClose, propertyId, propertyName }: {
    isOpen: boolean;
    onClose: () => void;
    propertyId?: string;
    propertyName?: string;
    onSuccess?: () => void;
}) { return isOpen && propertyId ? <ScheduleManager key={propertyId} propertyId={propertyId} propertyName={propertyName} onClose={onClose}/> : null; }
function ScheduleManager({ propertyId, propertyName, onClose }: {
    propertyId: string;
    propertyName?: string;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null), locked = useRef(false);
    const [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [deliveryPaused, setDeliveryPaused] = useState(true), [list, setList] = useState<PageData | null>(null), [selected, setSelected] = useState<BiSchedule | null>(null);
    const [detail, setDetail] = useState<PageData | null>(null), [tab, setTab] = useState<'detail' | 'events'>('detail'), [run, setRun] = useState<Result | null>(null), [legacy, setLegacy] = useState<PageData | null>(null), [legacyId, setLegacyId] = useState<string | null>(null), [legacyHistory, setLegacyHistory] = useState<PageData | null>(null);
    const [pending, setPending] = useState<{
        id: string;
    } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [config, setConfig] = useState<ScheduleConfig>(() => initial(propertyName)), [recipients, setRecipients] = useState(''), [editing, setEditing] = useState<BiSchedule | null>(null), [preview, setPreview] = useState<Result | null>(null);
    async function request(params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actor): Promise<Result> {
        const q = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...params, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/reports/scheduled' + (method === 'GET' ? '?' + q : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, propertyId, expectedActorId: expectedActor }) } : {}) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Schedule history could not be confirmed.');
        if (result.propertyId !== propertyId || params.id && ['command', 'run'].includes(String(params.kind)) && result.id !== params.id || method === 'POST' && params.id && result.id !== params.id || method === 'GET' && expectedActor && result.actorId !== expectedActor)
            throw new Error('This response does not match the current account or request.');
        return result;
    }
    const pageData = (r: Result) => ({ items: r.items || [], count: r.count || 0, hash: r.hash || '', offset: r.offset || 0 });
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        const el = dialog.current;
        el?.showModal();
        void request({ kind: 'list' }, 'GET', '').then(r => {
            if (abort.signal.aborted)
                return;
            const raw = sessionStorage.getItem(key(r.actorId, propertyId));
            if (raw) {
                const p = pendingSchedule.safeParse(JSON.parse(raw));
                if (!p.success)
                    throw new Error('This browser has an unreadable schedule request. Keep this tab and contact your administrator.');
                setPending(p.data);
            }
            setActor(r.actorId);
            setCanManage(!!r.canManage);
            setDeliveryPaused(!!r.deliveryPaused);
            setList(pageData(r));
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Schedules are unavailable.');
        });
        return () => { abort.abort(); el?.close(); };
        // The keyed manager is replaced for a different property; requests are scoped to this lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]);
    async function work(fn: () => Promise<void>) {
        if (locked.current)
            return;
        locked.current = true;
        setBusy(true);
        setError('');
        try {
            await fn();
        }
        catch (e) {
            if (!controller.current?.signal.aborted)
                setError(e instanceof Error ? e.message : 'Schedule request could not be confirmed.');
        }
        finally {
            locked.current = false;
            if (!controller.current?.signal.aborted)
                setBusy(false);
        }
    }
    function retain(value: {
        id: string;
    } | null) {
        try {
            if (value)
                sessionStorage.setItem(key(actor, propertyId), JSON.stringify(value));
            else
                sessionStorage.removeItem(key(actor, propertyId));
        }
        catch {
            throw new Error('Please allow browser storage before recording this schedule request. Keep this tab open.');
        }
        setPending(value);
    }
    async function refresh(offset = 0, expectedHash?: string) { const r = await request({ kind: 'list', offset, expectedHash }); setList(pageData(r)); setCanManage(!!r.canManage); setDeliveryPaused(!!r.deliveryPaused); }
    async function select(s: BiSchedule, kind: 'detail' | 'events' = 'detail', offset = 0, expectedHash?: string) { setDetail(null); setRun(null); const r = await request({ kind, id: s.id, offset, expectedHash }); setSelected(r.schedule!); setTab(kind); setDetail(pageData(r)); }
    async function settle(r: Result) {
        retain(null);
        setMessage(r.status === 'cancelled_request' ? 'Unused request cancelled.' : `Schedule decision confirmed: ${labels[String(r.status)] || r.status}.`);
        setPreview(null);
        setEditing(null);
        await refresh();
        if (r.scheduleId) {
            const q = await request({ kind: 'detail', id: r.scheduleId });
            setSelected(q.schedule!);
            setDetail(pageData(q));
            setTab('detail');
            setRun(null);
        }
    }
    async function decide(input: Record<string, unknown>) { const p = { id: crypto.randomUUID() }; retain(p); await settle(await request({ ...input, id: p.id }, 'POST')); }
    function formConfig() {
        const parsed = scheduleConfig.safeParse({ ...config, recipients: recipients.split(/[\n,]/).map(v => v.trim()).filter(Boolean) });
        if (!parsed.success)
            throw new Error('Review the name, frequency, time and up to ten unique email addresses.');
        return parsed.data;
    }
    const blocked = busy || !!pending || !actor, changeBlocked = blocked || !canManage;
    function change(next: Partial<ScheduleConfig>) { setConfig({ ...config, ...next }); setPreview(null); }
    const pages = (p: PageData, load: (offset: number, hash: string) => void) => <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>{p.count ? `${p.offset + 1}–${Math.min(p.offset + 20, p.count)} of ${p.count}` : '0 records'}</span><button type="button" className={button} disabled={blocked || p.offset === 0} onClick={() => load(Math.max(0, p.offset - 20), p.hash)}>Previous page</button><button type="button" className={button} disabled={blocked || p.offset + 20 >= p.count} onClick={() => load(p.offset + 20, p.hash)}>Next page</button></div>;
    return <dialog ref={dialog} aria-labelledby="report-schedule-title" onCancel={onClose} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(1100px,94vw)] overflow-auto rounded-2xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
  <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-4"><div><h2 id="report-schedule-title" className="text-xl font-semibold">Scheduled reports</h2><p className="text-sm text-muted-foreground">{propertyName}</p></div><button className={button} onClick={onClose} aria-label="Close scheduled reports">Close</button></header>
  <div className="space-y-6 p-5 sm:p-6">
   {deliveryPaused && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Email delivery is paused. You can prepare and review schedules; no emails will be sent.</p>}
   <p className="text-sm text-muted-foreground">Reports include all stored channels and accounts for this property. Times and report dates use UTC. Provider acceptance is recorded separately from delivery to a recipient.</p>
   {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
   {pending && <section aria-label="Pending schedule request" className="rounded-xl border border-amber-300 p-4"><p className="mb-3 text-sm">A schedule request needs confirmation. Check its result before making another decision.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void work(async () => settle(await request({ kind: 'command', id: pending.id })))}>Check request result</button><button className={button} disabled={busy || !canManage} onClick={() => void work(async () => settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST')))}>Cancel unused request</button></div></section>}
   <section aria-label="Report schedules" className="rounded-xl border border-border p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Report schedules</h3><button className={button} disabled={blocked} onClick={() => void work(async () => { setList(null); setSelected(null); setDetail(null); setRun(null); await refresh(); })}>Refresh schedules</button></div>
    {list?.items.length === 0 && <p className="text-sm text-muted-foreground">No schedules yet. Prepare the first report below.</p>}
    <div className="space-y-2">{list?.items.map(item => { const s = item as unknown as BiSchedule; return <button key={s.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-left text-sm disabled:opacity-40" disabled={blocked} onClick={() => void work(() => select(s))}><span className="min-w-0 break-words font-medium">{s.config.name}</span><span>{labels[s.state]} · {s.config.frequency} · {s.config.hour}:00 UTC</span></button>; })}</div>{list && pages(list, (n, h) => void work(async () => { setList(null); await refresh(n, h); }))}
   </section>
   {selected && <section aria-label="Selected report schedule" className="space-y-4 rounded-xl border border-border p-4"><h3 className="text-lg font-semibold">{selected.config.name}</h3><p className="text-sm">{labels[selected.state]} · Revision {selected.revision}<br />Next report: {date(selected.next_run_at)}<br />Last provider acceptance: {date(selected.last_accepted_at)}</p><p className="break-words text-sm">Recipients: {selected.config.recipients.join(', ')}</p>{selected.hold_reason && <p className="text-sm text-amber-800">Review needed: {selected.hold_reason.replaceAll('_', ' ')}. End an unresolved run to stop any remaining recipients before scheduling future reports.</p>}
    <div className="flex flex-wrap gap-2">
     <button className={button} disabled={changeBlocked || selected.state === 'cancelled' || selected.state === 'held'} onClick={() => { setEditing(selected); setConfig(selected.config); setRecipients(selected.config.recipients.join('\n')); setPreview(null); }}>Edit schedule</button>
     {selected.state !== 'active' && <button className={button} disabled={changeBlocked || selected.state === 'cancelled'} onClick={() => void work(() => decide({ operation: 'resume', scheduleId: selected.id, expectedRevision: selected.revision }))}>Schedule future reports</button>}
     {selected.state === 'active' && <button className={button} disabled={changeBlocked} onClick={() => void work(() => decide({ operation: 'pause', scheduleId: selected.id, expectedRevision: selected.revision }))}>Pause schedule</button>}
     {selected.state === 'held' && <button className={button} disabled={changeBlocked} onClick={() => void work(() => decide({ operation: 'close_run', scheduleId: selected.id, expectedRevision: selected.revision }))}>End unresolved run</button>}
     <button className={button} disabled={changeBlocked || selected.state === 'cancelled'} onClick={() => void work(() => decide({ operation: 'cancel', scheduleId: selected.id, expectedRevision: selected.revision }))}>Cancel schedule</button>
    </div><p className="text-xs text-muted-foreground">Pausing, ending or cancelling stops recipients that have not started. A message already in progress may still be accepted. History remains available. Scheduling future reports skips past dates and does not resend an earlier report.</p>
    <div className="flex gap-2"><button className={button} disabled={blocked} onClick={() => void work(() => select(selected, 'detail'))}>Delivery runs</button><button className={button} disabled={blocked} onClick={() => void work(() => select(selected, 'events'))}>Decision history</button></div>
    <div aria-label={tab === 'detail' ? 'Delivery runs' : 'Schedule decision history'} className="space-y-2">{detail?.items.length === 0 && <p className="text-sm text-muted-foreground">No {tab === 'detail' ? 'delivery runs' : 'decisions'} recorded.</p>}{detail?.items.map(v => tab === 'detail' ? <button key={String(v.id)} className={button + ' block w-full text-left'} disabled={blocked} onClick={() => void work(async () => { setRun(null); setRun(await request({ kind: 'run', id: v.id })); })}>{date(v.occurrence_at)} · {labels[String(v.state)] || String(v.state)}{v.issue ? ' · ' + String(v.issue).replaceAll('_', ' ') : ''}</button> : <p key={String(v.id)} className="border-b border-border py-2 text-sm">{formatScheduleAction(String(v.action))} · {date(v.created_at)} · {v.actor_id ? 'Team decision' : 'Scheduled report service'}</p>)}</div>{detail && pages(detail, (n, h) => void work(() => select(selected, tab, n, h)))}
    {run && <div aria-label="Recipient outcomes" className="space-y-2 rounded-lg bg-muted p-4"><h4 className="font-medium">Recipient outcomes</h4>{run.run?.source && <p className="text-sm">Retained report: {run.run.source.filters.startDate} to {run.run.source.filters.endDate} · {run.run.source.currentRows.length} stored records</p>}{run.deliveries?.map(d => <p key={d.id} className="break-words text-sm">{d.recipient}: {labels[d.state] || d.state}{d.provider_id ? ' · Provider reference ' + d.provider_id : ''}</p>)}<p className="text-xs text-muted-foreground">Delivery to the recipient has not been independently confirmed. Unknown attempts will not be resent automatically.</p></div>}
   </section>}
   {canManage ? <section aria-label="Prepare report schedule" className="rounded-xl border border-border p-4"><h3 className="mb-4 font-semibold">{editing ? 'Edit ' + editing.config.name : 'Prepare a report schedule'}</h3>{editing && <p className="mb-4 text-sm text-muted-foreground">Saving changes pauses this schedule until you schedule future reports.</p>}<form onSubmit={e => { e.preventDefault(); void work(async () => { const c = formConfig(); setPreview(null); setPreview(await request({ operation: 'preview', config: c }, 'POST')); }); }}><fieldset disabled={changeBlocked} className="grid gap-4 sm:grid-cols-2"><label className="text-sm sm:col-span-2">Schedule name<input className={inputClass} value={config.name} onChange={e => change({ name: e.target.value })} required maxLength={120}/></label><label className="text-sm">Frequency<select className={inputClass} value={config.frequency} onChange={e => { const f = e.target.value as ScheduleConfig['frequency']; change({ frequency: f, weekday: f === 'weekly' ? 1 : null, monthday: f === 'monthly' ? 1 : null }); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="text-sm">Hour (UTC)<select className={inputClass} value={config.hour} onChange={e => change({ hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>)}</select></label>{config.frequency === 'weekly' && <label className="text-sm">Day of week<select className={inputClass} value={config.weekday!} onChange={e => change({ weekday: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((v, i) => <option key={v} value={i}>{v}</option>)}</select></label>}{config.frequency === 'monthly' && <label className="text-sm">Day of month<select className={inputClass} value={config.monthday!} onChange={e => change({ monthday: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}<label className="text-sm">Report period<select className={inputClass} value={config.window} onChange={e => change({ window: e.target.value as ScheduleConfig['window'] })}><option value="previous_period">Previous day, week or month</option><option value="last_7_days">Last 7 completed days</option><option value="last_30_days">Last 30 completed days</option><option value="month_to_date">Month to yesterday</option></select></label><label className="text-sm sm:col-span-2">Recipient emails<textarea className={inputClass} rows={3} value={recipients} onChange={e => { setRecipients(e.target.value); setPreview(null); }} placeholder="One email per line, up to ten" required/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.comparison} onChange={e => change({ comparison: e.target.checked })}/>Include previous-period comparison</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.campaigns} onChange={e => change({ campaigns: e.target.checked })}/>Include all campaign details</label><div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" className={button}>Preview report</button>{editing && <button type="button" className={button} onClick={() => { setEditing(null); setPreview(null); setConfig(initial(propertyName)); setRecipients(''); }}>Discard edit</button>}</div></fieldset></form>
    {preview && <div aria-label="Schedule preview" className="mt-4 space-y-3 rounded-lg bg-muted p-4"><h4 className="font-medium">Current completed-period preview</h4><p className="text-sm">First future run: {date(preview.nextRunAt)}. Each run uses its own completed dates and stored data.</p>{preview.report ? <p className="text-sm">{preview.report.dateRange.start} to {preview.report.dateRange.end}<br />{preview.report.coverage.records} stored records · {preview.report.coverage.observedDays} of {preview.report.coverage.requestedDays} selected dates<br />Spend: {metricCurrency(preview.report.totals.spend)} · Reported conversions: {preview.report.totals.conversions}<br />{config.campaigns ? `${preview.report.campaigns.length} campaign rows included` : 'Campaign details omitted'} · {config.comparison ? 'Prior-period comparison included' : 'Comparison omitted'}</p> : <p className="text-sm">There are no completed dates in the current month. Such runs are recorded without sending an email.</p>}<p className="text-xs">Reports use stored provider-attributed conversions, which may be fractional. Missing dates do not prove zero activity. Missing currency and undefined rates appear as unavailable.</p><button className={button} disabled={changeBlocked} onClick={() => void work(() => decide(editing ? { operation: 'edit', scheduleId: editing.id, expectedRevision: editing.revision, config: formConfig() } : { operation: 'create', config: formConfig() }))}>{editing ? 'Save schedule changes' : 'Save paused schedule'}</button></div>}
   </section> : actor && <p className="text-sm text-muted-foreground">Administrators and managers can change report schedules.</p>}
   <section aria-label="Earlier report schedules" className="rounded-xl border border-border p-4"><button className={button} disabled={blocked} onClick={() => void work(async () => { setLegacy(null); setLegacyId(null); setLegacyHistory(null); setLegacy(pageData(await request({ kind: 'legacy' }))); })}>Review earlier schedules</button>{legacy && <><p className="my-3 text-sm">Earlier schedules are retained for reference and are not processed by this scheduler. Create and review a new schedule to enable future reports.</p>{legacy.items.map(v => <button key={String(v.id)} className={button + ' mb-2 block'} disabled={blocked} onClick={() => void work(async () => { setLegacyHistory(null); setLegacyId(String(v.id)); setLegacyHistory(pageData(await request({ kind: 'legacy_detail', id: v.id }))); })}>{String(v.name)} · Earlier history</button>)}{pages(legacy, (n, h) => void work(async () => { setLegacy(null); setLegacy(pageData(await request({ kind: 'legacy', offset: n, expectedHash: h }))); }))}</>}{legacyHistory && <div className="mt-4">{legacyHistory.items.map(v => <p key={String(v.id)} className="text-sm">{date(v.created_at)} · Earlier reported status: {String(v.status)}</p>)}{pages(legacyHistory, (n, h) => void work(async () => { setLegacyHistory(null); setLegacyHistory(pageData(await request({ kind: 'legacy_detail', id: legacyId, offset: n, expectedHash: h }))); }))}<p className="text-xs">Earlier status labels do not independently confirm receipt.</p></div>}</section>
  </div>
 </dialog>;
}
