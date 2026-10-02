'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { biExportData, buildBiReport, metricCurrency, type BiReport, type BiSource } from '@/utils/analytics/report-data';
import { biPendingKey, biRequest, parseBiPending, type PendingBi, BiClientError } from '@/utils/analytics/report-client';
import { formatConversions } from '@/utils/analytics/marketing-fact';
type Saved = {
    id: string;
    status: string;
    label: string | null;
    source: BiSource;
    sourceHash: string;
    savedAt: string;
};
type History = {
    items: Array<{
        id: string;
        status: string;
        label: string | null;
        savedAt: string;
        actorName: string | null;
    }>;
    total: number;
    pageHash: string;
};
type Exports = {
    items: Array<{
        id: string;
        format: string;
        createdAt: string;
        actorName: string | null;
        outcome: string | null;
    }>;
    total: number;
    pageHash: string;
};
const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40 hover:bg-muted';
export function SavedBiReports({ propertyId, report }: {
    propertyId: string;
    report: (BiReport & {
        sourceHash: string;
        actorId: string;
    }) | null;
}) {
    const [actor, setActor] = useState(''), [label, setLabel] = useState(''), [history, setHistory] = useState<History | null>(null), [offset, setOffset] = useState(0);
    const [selected, setSelected] = useState<Saved | null>(null), [exports, setExports] = useState<Exports | null>(null), [exportOffset, setExportOffset] = useState(0);
    const [pending, setPending] = useState<PendingBi | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const active = useRef(false), locked = useRef(false), controller = useRef<AbortController | null>(null);
    useEffect(() => {
        active.current = true;
        const abort = new AbortController();
        controller.current = abort;
        void biRequest(propertyId, { kind: 'history' }, 'GET', abort.signal).then(r => { if (abort.signal.aborted)
            return; const saved = parseBiPending(sessionStorage.getItem(biPendingKey(r.actorId, propertyId))); setActor(r.actorId); setPending(saved); setHistory(r); }).catch(e => { if (!abort.signal.aborted)
            setError(e instanceof Error ? e.message : 'Saved reports are unavailable.'); });
        return () => { active.current = false; abort.abort(); };
    }, [propertyId]);
    const request = (params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET') => biRequest(propertyId, params, method, controller.current?.signal, actor);
    function retain(p: PendingBi | null) { const key = biPendingKey(actor, propertyId); try {
        if (p)
            sessionStorage.setItem(key, JSON.stringify(p));
        else
            sessionStorage.removeItem(key);
    }
    catch {
        throw new Error('Your browser could not retain this request. Keep this tab open and allow browser storage before trying again.');
    } if (active.current)
        setPending(p); }
    async function run(action: () => Promise<void>) { if (locked.current || !active.current)
        return; locked.current = true; setBusy(true); setError(''); setMessage(''); try {
        await action();
    }
    catch (e) {
        if (active.current)
            setError(e instanceof Error ? e.message : 'Check saved history before trying again.');
    }
    finally {
        locked.current = false;
        if (active.current)
            setBusy(false);
    } }
    async function loadHistory(next = 0) { if (active.current)
        setHistory(null); const result = await request({ kind: 'history', offset: String(next), ...(next && history ? { expectedHash: history.pageHash } : {}) }); if (active.current) {
        setHistory(result);
        setOffset(next);
    } }
    async function loadExports(id: string, next = 0) { if (active.current)
        setExports(null); const result = await request({ kind: 'exports', id, offset: String(next), ...(next && exports ? { expectedHash: exports.pageHash } : {}) }); if (active.current) {
        setExports(result);
        setExportOffset(next);
    } }
    async function open(id: string) { if (active.current) {
        setSelected(null);
        setExports(null);
    } const result = await request({ kind: 'detail', id }); if (active.current) {
        setSelected(result);
        if (result.status === 'saved')
            await loadExports(id);
    } }
    async function save() { if (!report || report.actorId !== actor)
        return; const p: PendingBi = { kind: 'save', id: crypto.randomUUID() }; retain(p); await request({ operation: 'save', id: p.id, label, filters: report.source.filters, sourceHash: report.sourceHash }, 'POST'); if (!active.current)
        return; await reconcile(p); }
    async function reconcile(p: PendingBi) {
        if (p.kind === 'save') {
            const r = await request({ kind: 'detail', id: p.id });
            if (!['saved', 'cancelled'].includes(r.status))
                throw new Error('The report result is not confirmed.');
            retain(null);
            setMessage(r.status === 'saved' ? 'Report saved with its original figures.' : 'Unused save request cancelled.');
            await loadHistory();
            await open(p.id);
        }
        else {
            const r = await request({ kind: 'export', id: p.id });
            if (r.reportId !== p.reportId || r.format !== p.format)
                throw new Error('The export result differs from this request.');
            if (r.outcome) {
                if (p.outcome && r.outcome !== p.outcome)
                    throw new Error('The recorded browser result differs. Review export history.');
                retain(null);
                setMessage('Export history confirmed. A browser download is not proof the file was received.');
                await open(p.reportId);
            }
            else if (p.outcome) {
                await request({ operation: 'observe', id: p.id, outcome: p.outcome }, 'POST');
                if (!active.current)
                    return;
                retain(null);
                setMessage(p.outcome === 'download_started' ? 'Browser download started; this does not confirm file receipt.' : 'The browser could not start the download.');
                await open(p.reportId);
            }
            else {
                setMessage('Export is prepared. Use Download prepared export to start the file explicitly.');
                await open(p.reportId);
            }
        }
    }
    async function cancel() { if (pending?.kind !== 'save')
        return; await request({ operation: 'cancel', id: pending.id }, 'POST'); if (active.current)
        await reconcile(pending); }
    async function download(p: Extract<PendingBi, {
        kind: 'export';
    }>) {
        const r = await request({ operation: 'export', id: p.id, reportId: p.reportId, format: p.format }, 'POST');
        if (!active.current)
            return;
        if (r.reportId !== p.reportId || r.format !== p.format)
            throw new Error('The prepared export differs from this request.');
        if (r.outcome) {
            await reconcile(p);
            return;
        }
        const data = biExportData(buildBiReport(r.source as BiSource), { id: r.reportId, label: r.label, sourceHash: r.sourceHash, savedAt: r.savedAt });
        let outcome: 'download_started' | 'download_failed' = 'download_started';
        try {
            const file = await import('@/utils/export');
            if (!active.current)
                return;
            const filename = `Marketing-report-${r.reportId}.${p.format}`;
            if (p.format === 'csv')
                file.downloadCSV(data, filename);
            else
                file.downloadPDF(data, filename);
        }
        catch {
            outcome = 'download_failed';
        }
        const observed = { ...p, outcome };
        retain(observed);
        await reconcile(observed);
    }
    async function startExport(format: 'csv' | 'pdf') { if (!selected)
        return; const p: PendingBi = { kind: 'export', id: crypto.randomUUID(), reportId: selected.id, format }; retain(p); await download(p); }
    const savedReport = useMemo(() => selected?.status === 'saved' ? buildBiReport(selected.source) : null, [selected]);
    return <section aria-label="Saved marketing reports" className="rounded-xl border border-border bg-card p-5 space-y-4">
  <div><h2 className="font-semibold text-lg">Saved reports</h2><p className="text-sm text-muted-foreground">Keep the figures and filters you reviewed. Export from a saved report to retain the same numbers after later imports.</p></div>
  <div className="flex flex-wrap items-end gap-2"><label className="flex-1 min-w-48 text-sm">Report name<input aria-label="Report name" value={label} onChange={e => setLabel(e.target.value)} maxLength={120} className="block mt-1 w-full border rounded-lg p-2 bg-background" placeholder="September client review"/></label><button className={button} disabled={busy || !!pending || !actor || !report || report.actorId !== actor || !label.trim()} onClick={() => void run(save)}>Save current report</button><button className={button} disabled={busy || !actor} onClick={() => void run(() => loadHistory())}>Refresh saved reports</button></div>
  {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
  {pending && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2"><p>{pending.kind === 'save' ? 'A save request needs confirmation. Check its result or cancel it if it has not saved.' : 'An export request needs confirmation. Checking history does not start another download.'}</p><div className="flex gap-2 flex-wrap"><button className={button} disabled={busy} onClick={() => void run(async () => { try {
        await reconcile(pending);
    }
    catch (e) {
        if (e instanceof BiClientError && e.status === 404)
            throw new Error('This request is not yet recorded. A delayed request may still arrive. ' + (pending.kind === 'save' ? 'Cancel it before starting another save.' : 'Use Download prepared export to safely retry this same request.'));
        throw e;
    } })}>Check request result</button>{pending.kind === 'save' ? <button className={button} disabled={busy} onClick={() => void run(cancel)}>Cancel unused save</button> : !pending.outcome && <button className={button} disabled={busy} onClick={() => void run(() => download(pending))}>Download prepared export</button>}</div></div>}
  {history && <div><p className="text-sm text-muted-foreground">{history.total} saved or cancelled requests</p><ul className="divide-y mt-2">{history.items.map(item => <li key={item.id} className="flex justify-between items-center gap-3 py-2 text-sm"><div><p className="font-medium">{item.label || 'Cancelled save'}</p><p className="text-muted-foreground">{new Date(item.savedAt).toLocaleString()} · {item.actorName || 'Team member'}</p></div><button className={button} disabled={busy} onClick={() => void run(() => open(item.id))}>View {item.status === 'saved' ? 'report' : 'request'}</button></li>)}</ul><div className="flex gap-3 items-center mt-2"><button className={button} disabled={busy || offset === 0} onClick={() => void run(() => loadHistory(Math.max(0, offset - 20)))}>Previous reports</button><span className="text-xs">{history.total ? offset + 1 : 0}–{Math.min(offset + 20, history.total)} of {history.total}</span><button className={button} disabled={busy || offset + 20 >= history.total} onClick={() => void run(() => loadHistory(offset + 20))}>More reports</button></div></div>}
  {selected && <section aria-label="Saved report details" className="rounded-lg border border-border p-4 space-y-3"><div className="flex justify-between gap-4"><h3 className="font-semibold">{selected.label || 'Cancelled save'}</h3><button className={button} disabled={busy} onClick={() => { setSelected(null); setExports(null); }}>Close report</button></div>{savedReport ? <><p className="text-sm">{savedReport.dateRange.start} to {savedReport.dateRange.end} · {savedReport.source.filters.channel || 'All channels'} · {savedReport.source.filters.account === null ? 'All accounts' : savedReport.source.filters.account || 'Unattributed account'}</p><dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm"><div><dt>Spend</dt><dd className="font-semibold">{metricCurrency(savedReport.totals.spend)}</dd></div><div><dt>Clicks</dt><dd className="font-semibold">{savedReport.totals.clicks.toLocaleString()}</dd></div><div><dt>Reported conversions</dt><dd className="font-semibold">{formatConversions(savedReport.totals.conversions)}</dd></div><div><dt>Stored records</dt><dd className="font-semibold">{savedReport.coverage.records}</dd></div></dl><p className="text-sm text-muted-foreground">These are the saved figures. The current dashboard above can show newer data.</p><div className="flex gap-2">{(['csv', 'pdf'] as const).map(f => <button key={f} className={button} disabled={busy || !!pending} onClick={() => void run(() => startExport(f))}>Download {f.toUpperCase()}</button>)}</div><details className="text-xs break-all"><summary>Report reference</summary><p>{selected.id}</p><p>Source fingerprint: {selected.sourceHash}</p><p>Saved {new Date(selected.savedAt).toLocaleString()}</p></details>{exports && <div className="text-sm"><h4 className="font-medium">Export history</h4><p className="text-muted-foreground">Prepared means the saved file was authorized. Browser observations do not prove a file was received or sent to a client.</p><ul>{exports.items.map(x => <li key={x.id} className="py-2 border-b">{x.format.toUpperCase()} · {new Date(x.createdAt).toLocaleString()} · {x.actorName || 'Team member'} · {x.outcome === 'download_started' ? 'Browser download started' : x.outcome === 'download_failed' ? 'Browser download failed' : 'Prepared; browser outcome unknown'}</li>)}</ul><div className="flex items-center gap-3 mt-2"><button className={button} disabled={busy || exportOffset === 0} onClick={() => void run(() => loadExports(selected.id, exportOffset - 20))}>Previous exports</button><span>{exports.total ? exportOffset + 1 : 0}–{Math.min(exportOffset + 20, exports.total)} of {exports.total}</span><button className={button} disabled={busy || exportOffset + 20 >= exports.total} onClick={() => void run(() => loadExports(selected.id, exportOffset + 20))}>More exports</button></div></div>}</> : <p className="text-sm">This request was cancelled before a report was saved.</p>}</section>}
 </section>;
}
