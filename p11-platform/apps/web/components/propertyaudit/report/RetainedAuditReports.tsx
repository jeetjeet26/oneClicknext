"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { auditReportId, type AuditReportOptions } from '@/utils/propertyaudit/report-contracts';
import { auditReportArtifactMeta, reportRow, reportRows } from '@/utils/propertyaudit/retained-report';
type Row = Record<string, unknown>;
const sections: AuditReportOptions['sections'] = ['summary', 'scores', 'models', 'competitors', 'recommendations', 'queries', 'appendix'];
const formats: Record<AuditReportOptions['format'], string> = { html: 'Print-ready HTML', markdown: 'Markdown', findings_csv: 'Technical findings CSV', queries_csv: 'Active questions CSV' };
const button = 'rounded border px-3 py-2 text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800';
const friendlyDate = (v: unknown) => { const d = new Date(String(v)); return Number.isNaN(d.valueOf()) ? 'Unknown time' : d.toLocaleString(); };
const presets: Record<AuditReportOptions['template'], AuditReportOptions['sections']> = { comprehensive: [...sections], executive: ['summary', 'models', 'recommendations'], competitive: ['summary', 'models', 'competitors', 'queries'], progress: ['summary', 'scores', 'recommendations', 'appendix'] };
const field = 'w-full rounded border p-2 bg-white dark:bg-gray-900';
async function response(res: Response) {
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || 'Report unavailable.');
    return data as Row;
}
export function RetainedAuditReports({ propertyId, runId, batchId, initialFormat = 'html' }: {
    propertyId: string;
    runId?: string | null;
    batchId?: string | null;
    initialFormat?: AuditReportOptions['format'];
}) {
    const [actor, setActor] = useState(''), [history, setHistory] = useState<Row | null>(null), [offset, setOffset] = useState(0), [detail, setDetail] = useState<Row | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<{
        id: string;
        actor: string;
    } | null>(null), [version, setVersion] = useState(0);
    const [options, setOptions] = useState<AuditReportOptions>({ format: initialFormat, template: 'comprehensive', sections: [...sections], ...(batchId ? { batchId } : runId ? { runId } : {}) });
    const alive = useRef(true), detailSequence = useRef(0), historyHash = useRef<string | undefined>(undefined), pendingRef = useRef(pending), key = `p11-audit-report:${propertyId}`;
    pendingRef.current = pending;
    useEffect(() => {
        alive.current = true;
        try {
            const v = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (v && auditReportId.safeParse(v.id).success && auditReportId.safeParse(v.actor).success)
                setPending(v);
        }
        catch {
            setError('Saved report recovery is unavailable in this browser. Keep this page open while working.');
        }
        return () => { alive.current = false; detailSequence.current++; };
    }, [key]);
    useEffect(() => {
        const abort = new AbortController();
        const params = new URLSearchParams({ propertyId, offset: String(offset) });
        if (offset && historyHash.current)
            params.set('hash', historyHash.current);
        fetch(`/api/propertyaudit/reports?${params}`, { signal: abort.signal }).then(response).then(data => {
            if (data.propertyId !== propertyId || typeof data.actorId !== 'string')
                throw new Error('The report history does not match this property.');
            if (!abort.signal.aborted) {
                setActor(data.actorId);
                historyHash.current = String(data.hash);
                setHistory(data);
            }
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e.message);
        });
        return () => abort.abort();
    }, [propertyId, offset, version]);
    const loadDetail = useCallback(async (id: string) => {
        const seq = ++detailSequence.current;
        const data = await response(await fetch(`/api/propertyaudit/reports?${new URLSearchParams({ propertyId, id })}`));
        if (data.propertyId !== propertyId || data.id !== id)
            throw new Error('The saved report does not match this request.');
        if (alive.current && seq === detailSequence.current)
            setDetail(data);
        return data;
    }, [propertyId]);
    const remember = (value: {
        id: string;
        actor: string;
    } | null) => {
        if (value)
            sessionStorage.setItem(key, JSON.stringify(value));
        else
            sessionStorage.removeItem(key);
        pendingRef.current = value;
        setPending(value);
    };
    const refresh = () => { historyHash.current = undefined; setOffset(0); setVersion(v => v + 1); };
    const post = async (body: Row) => {
        const result = await response(await fetch('/api/propertyaudit/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId, expectedActorId: actor, ...body }) }));
        if (result.propertyId !== propertyId || result.id !== body.id)
            throw new Error('The report result does not match this saved request.');
        return result;
    };
    const decide = async (operation: 'prepare' | 'resume' | 'cancel', savedId?: string) => {
        if (busy || !actor)
            return;
        setBusy(true);
        setError('');
        setNotice('');
        const id = savedId || crypto.randomUUID();
        try {
            if (pendingRef.current && pendingRef.current.id !== id)
                throw new Error('Recover or cancel the earlier report request first.');
            if (pendingRef.current && pendingRef.current.actor !== actor)
                throw new Error('Sign back in as the original requester to recover this report.');
            remember({ id, actor });
            const result = await post({ id, operation, ...(operation === 'prepare' ? { options } : {}) });
            if (!alive.current)
                return;
            remember(null);
            setNotice(result.status === 'cancelled' ? 'Report request cancelled. Its captured evidence remains in history.' : 'Report saved. Choose Download to retrieve the retained artifact.');
            refresh();
            await loadDetail(id);
        }
        catch (e) {
            if (alive.current)
                setError(e instanceof Error ? e.message : 'The report result is uncertain. Check its saved request.');
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const recover = async () => {
        if (!pending)
            return;
        setBusy(true);
        setError('');
        try {
            if (pending.actor !== actor)
                throw new Error('Sign back in as the original requester to recover this report.');
            const data = await loadDetail(pending.id), r = reportRow(data.record);
            if (['ready', 'cancelled'].includes(String(r.state))) {
                remember(null);
                setNotice(r.state === 'ready' ? 'The earlier report was saved. No new source was captured.' : 'The earlier request was cancelled.');
                refresh();
            }
            else
                setNotice('The source was saved. Resume rendering to finish this exact report.');
        }
        catch (e) {
            if (alive.current)
                setError(e instanceof Error ? e.message : 'Saved request unavailable.');
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const download = async () => {
        if (!detail || busy)
            return;
        const r = reportRow(detail.record), reportId = String(r.id), downloadId = crypto.randomUUID();
        setBusy(true);
        setError('');
        setNotice('');
        let initiated = false;
        try {
            await post({ id: downloadId, operation: 'download', reportId });
            const res = await fetch(`/api/propertyaudit/reports?${new URLSearchParams({ propertyId, id: reportId, artifact: '1', downloadId })}`);
            if (!res.ok)
                await response(res);
            const blob = await res.blob();
            if (!alive.current)
                return;
            const meta = auditReportArtifactMeta(reportId, r.options as AuditReportOptions), url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url;
            a.download = meta.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            initiated = true;
            await post({ id: downloadId, operation: 'observe', reportId, outcome: 'download_initiated' });
            if (alive.current) {
                setNotice('Download initiated by the browser. Client receipt and PDF saving are not verified.');
                await loadDetail(reportId);
            }
        }
        catch (e) {
            if (alive.current) {
                setError(`${initiated ? 'The browser initiated the download, but its history acknowledgment is uncertain. ' : ''}${e instanceof Error ? e.message : 'Download failed.'}`);
                try {
                    await loadDetail(reportId);
                }
                catch { }
            }
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const r = reportRow(detail?.record), canDecide = !!actor && !busy && (!pending || pending.actor === actor), isReport = options.format === 'html' || options.format === 'markdown';
    return <section aria-label="Saved audit reports" className="space-y-5 min-w-0">
  <p className="text-sm text-gray-600 dark:text-gray-300">Save a report from retained measurements and current findings. Reports make no new model or website requests. Open downloaded HTML in your browser to print or save it as PDF.</p>
  {error && <p role="alert" className="rounded border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice && <p role="status" className="rounded border p-3 text-sm">{notice}</p>}
  {pending && !busy && <div className="rounded border border-amber-300 p-3 space-y-2"><p className="text-sm">An earlier report request needs confirmation. Check it before starting another.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={!canDecide} onClick={() => void recover()}>Check saved report</button><button className={button} disabled={!canDecide} onClick={() => void decide('cancel', pending.id)}>Cancel pending report</button></div></div>}
  <fieldset disabled={busy || !!pending} className="space-y-3 rounded border p-4"><legend className="px-2 font-semibold">New retained report</legend>
   <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Output format<select aria-label="Report output format" className={field} value={options.format} onChange={e => setOptions(v => ({ ...v, format: e.target.value as AuditReportOptions['format'] }))}>{Object.entries(formats).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
    {isReport && <label className="text-sm">Report style<select aria-label="Report style" className={field} value={options.template} onChange={e => setOptions(v => ({ ...v, template: e.target.value as AuditReportOptions['template'], sections: presets[e.target.value as AuditReportOptions['template']] }))}><option value="comprehensive">Comprehensive audit</option><option value="executive">Executive brief</option><option value="competitive">Competitive evidence</option><option value="progress">Progress review</option></select></label>}</div>
   {isReport ? <><p className="text-sm">Scope: {options.batchId ? 'the selected audit batch' : options.runId ? 'the selected measurement run' : 'the latest completed, unarchived provider batch'}. All source runs and incomplete coverage are retained.</p><div className="flex flex-wrap gap-3">{sections.map(s => <label key={s} className="text-sm capitalize"><input type="checkbox" checked={options.sections.includes(s)} disabled={s === 'summary'} onChange={() => setOptions(v => ({ ...v, sections: v.sections.includes(s) ? v.sections.filter(x => x !== s) : [...v.sections, s] }))}/> {s}</label>)}</div></> : <p className="text-sm">{options.format === 'queries_csv' ? 'Exports every active question with its saved revision and recent measurements for unchanged wording. Screen filters do not limit this complete inventory.' : 'Exports the complete retained findings inventory. Reported fixes are staff reports.'}</p>}
   {options.format === 'findings_csv' && <label className="block text-sm"><input type="checkbox" checked={options.includeFixed !== false} onChange={e => setOptions(v => ({ ...v, includeFixed: e.target.checked }))}/> Include staff-reported fixed findings</label>}
   <button className={button} disabled={!actor || busy || !!pending} onClick={() => void decide('prepare')}>{busy ? 'Saving…' : 'Save report'}</button>
  </fieldset>
  <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Saved reports ({String(history?.count ?? '…')})</h3><button className={button} disabled={busy} onClick={() => { setError(''); refresh(); }}>Refresh reports</button></div>
   {reportRows(history?.items).map(item => <button key={String(item.id)} className="block w-full rounded border p-3 text-left text-sm break-words hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setError(''); void loadDetail(String(item.id)).catch(e => setError(e.message)); }}><span className="font-medium">{formats[reportRow(item.options).format as AuditReportOptions['format']] || 'Cancelled request'}</span> · {String(item.state)}<br />{friendlyDate(item.created_at)}<span className="block text-xs text-gray-500">{item.actor_id === actor ? 'Requested by you' : 'Requested by another team member'}</span></button>)}
   {history && Number(history.count) === 0 && <p className="text-sm">No saved reports yet.</p>}
   <div className="flex gap-2"><button className={button} disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous reports</button><button className={button} disabled={!history || offset + 25 >= Number(history.count) || busy} onClick={() => setOffset(offset + 25)}>More reports</button></div>
  </div>
  {detail && <section aria-label="Selected saved report" className="rounded border p-4 space-y-3 break-words"><h3 className="font-semibold">Saved report detail</h3><p className="text-sm">{formats[reportRow(r.options).format as AuditReportOptions['format']] || 'Cancelled request'} · {String(r.state)} · Captured {friendlyDate(r.created_at)}</p>
   {r.state === 'ready' && <button className={button} disabled={busy || !actor} onClick={() => void download()}>Download saved report</button>}
   {r.state === 'prepared' && detail.canResume === true && <div className="flex gap-2"><button className={button} disabled={!canDecide || !!pending && pending.id !== r.id} onClick={() => void decide('resume', String(r.id))}>Resume rendering saved source</button><button className={button} disabled={!canDecide || !!pending && pending.id !== r.id} onClick={() => void decide('cancel', String(r.id))}>Cancel rendering</button></div>}
   {Boolean(r.source_hash) && <details><summary className="cursor-pointer text-sm">Captured source details</summary><p className="text-xs mt-2">Source {String(r.source_hash)} · Artifact {String(r.artifact_hash || 'not prepared')}</p><p className="text-sm mt-2">{reportRows(reportRow(r.source).runs).length} selected runs, {reportRows(reportRow(r.source).queries).length} active questions, {reportRows(reportRow(r.source).findings).length} current findings.</p><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.source, null, 2)}</pre></details>}
   <h4 className="font-medium text-sm">Download history</h4>{reportRows(detail.observations).length ? reportRows(detail.observations).map(o => <p key={String(o.id)} className="text-xs">{friendlyDate(o.created_at)} · {o.outcome === 'prepared' ? 'Prepared; browser outcome unknown' : String(o.outcome).replaceAll('_', ' ')} · {o.actor_id === actor ? 'You' : 'Another team member'}</p>) : <p className="text-sm text-gray-500">No download preparation recorded.</p>}
  </section>}
 </section>;
}
