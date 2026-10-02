'use client';
import { useEffect, useRef, useState } from 'react';
import type { AuditContext, AuditDecisionController, AuditModels } from '@/utils/propertyaudit/use-audit-decisions';
import type { Surface } from '@/utils/propertyaudit/types';
import { getSurfaceLabel } from '@/utils/propertyaudit/types';
import { AuditPageButtons, useAuditPage, auditButton, auditField, AuditDecisionRecovery } from './AuditDecisionHistory';
import { AuditEvidence } from './AuditEvidence';
export { AuditEvidence } from './AuditEvidence';
import { AuditCrawlReceipts } from './AuditCrawlReceipts';
export function AuditInvocationEvidence({ id, controller: c }: {
    id: string;
    controller: AuditDecisionController;
}) {
    const [data, setData] = useState<Record<string, unknown> | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const turn = useRef(0);
    useEffect(() => () => { turn.current++; }, []);
    async function load() {
        const t = ++turn.current;
        setBusy(true);
        setError('');
        try {
            const r = await c.read({ kind: 'invocation', id });
            if (t === turn.current)
                setData(r.source || null);
        }
        catch (e) {
            if (t === turn.current)
                setError(e instanceof Error ? e.message : 'Response unavailable');
        }
        finally {
            if (t === turn.current)
                setBusy(false);
        }
    }
    return <div className="mt-2 space-y-2"><button className={auditButton} disabled={busy} onClick={() => void load()}>Inspect retained response</button>{error && <p role="alert">{error}</p>}{data && <details open><summary>Saved provider receipt</summary><div className="mt-2 max-h-96 overflow-auto rounded border border-border p-3"><AuditEvidence value={data}/></div></details>}</div>;
}
export function AuditRunInventory({ controller: c, onOpenRun }: {
    controller: AuditDecisionController;
    onOpenRun: (id: string) => void;
}) { const [archive, setArchive] = useState('current'), page = useAuditPage(c, 'runs', { archive }); return <section className="space-y-3 rounded-xl border border-border bg-background p-4" aria-label="Complete audit run history"><h3 className="font-semibold">Audit runs</h3><label className="block text-sm">Run inventory<select value={archive} className={auditField} onChange={e => setArchive(e.target.value)}><option value="current">Current runs</option><option value="archived">Archived runs</option><option value="all">All retained runs</option></select></label><button className={auditButton} disabled={page.busy} onClick={() => void page.load()}>Refresh run inventory</button>{page.error && <p role="alert">{page.error}</p>}<ul className="space-y-2">{page.data?.items?.map(r => <li key={String(r.id)}><button className={`${auditButton} w-full text-left`} onClick={() => onOpenRun(String(r.id))}><span className="font-medium">{String(r.surface)} · {r.stopped_by_operator ? 'Stopped by operator' : String(r.status)}</span><span className="mt-1 block text-xs">{new Date(String(r.started_at)).toLocaleString()} · {String(r.model_name)} · {r.measurement_mode === 'local_fixture' ? 'Synthetic local evidence' : String(r.measurement_mode || 'Legacy provenance')}{r.archived_at ? ' · Archived' : ''}{r.retry_of ? ' · Linked retry' : ''}</span></button></li>)}</ul><AuditPageButtons page={page} label="runs"/></section>; }
export function AuditReviewInventory({ controller: c, kind }: {
    controller: AuditDecisionController;
    kind: 'findings' | 'recommendations';
}) {
    const page = useAuditPage(c, kind), [review, setReview] = useState<Record<string, unknown> | null>(null), [status, setStatus] = useState('todo'), [owner, setOwner] = useState(''), [notes, setNotes] = useState(''), [reason, setReason] = useState('');
    async function save() {
        if (!review)
            return;
        const r = await c.execute({ operation: kind === 'findings' ? 'finding_review' : 'recommendation_review', resourceId: review.id, sourceHash: review.sourceHash, status, owner, notes, reason });
        if (r)
            setReview(null);
    }
    return <section aria-label={kind === 'findings' ? 'Technical audit findings' : 'Audit recommendations'} className="space-y-3 rounded-xl border border-border bg-background p-4"><h3 className="font-semibold">{kind === 'findings' ? 'Technical findings' : 'Evidence-grounded recommendations'}</h3><p className="text-sm text-muted-foreground">Status is a staff assessment. A future measurement must establish whether an issue improved.</p><button className={auditButton} disabled={page.busy} onClick={() => void page.load()}>Refresh {kind}</button>{page.error && <p role="alert">{page.error}</p>}<ul className="space-y-3">{page.data?.items?.map(r => <li className="space-y-2 rounded-lg border border-border p-3 text-sm" key={String(r.id)}><h4 className="font-medium">{String(r.title)}</h4><p>{String(r.status).replaceAll('_', ' ')} · {String(r.severity || r.priority || '')} · {String(r.owner || 'Unassigned')}</p><p className="whitespace-pre-wrap break-words">{String(r.description || r.narrative || '')}</p><details><summary>Source evidence and proposed changes</summary><div className="mt-2 max-h-96 overflow-auto"><AuditEvidence value={{ evidence: r.evidence || r.grounding, affected_urls: r.affected_urls, proposed_changes: r.proposed_changes, source_crawl_id: r.source_crawl_id || r.crawl_id }}/></div></details><button className={auditButton} disabled={!c.canManage || c.busy || !!c.pending} onClick={() => { setReview(r); setStatus(String(r.status)); setOwner(String(r.owner || '')); setNotes(String(r.notes || '')); setReason(''); }}>Review {kind === 'findings' ? 'finding' : 'recommendation'}</button></li>)}</ul><AuditPageButtons page={page} label={kind}/>{review && <form aria-label="Audit evidence review" className="space-y-3 rounded-lg border border-border p-4" onSubmit={e => { e.preventDefault(); void save(); }}><h4 className="font-medium">Review: {String(review.title)}</h4><label className="block text-sm">Reported status<select className={auditField} value={status} onChange={e => setStatus(e.target.value)}>{['todo', 'in_progress', 'fixed', 'wont_fix'].map(s => <option key={s} value={s}>{s === 'fixed' ? 'Staff reports fixed' : s.replaceAll('_', ' ')}</option>)}</select></label><label className="block text-sm">Responsible team<select className={auditField} value={owner} onChange={e => setOwner(e.target.value)}>{['', 'web_developer', 'content', 'seo', 'partnerships'].map(v => <option key={v} value={v}>{v.replaceAll('_', ' ') || 'Unassigned'}</option>)}</select></label><label className="block text-sm">Review notes<textarea className={auditField} maxLength={8000} value={notes} onChange={e => setNotes(e.target.value)}/></label><label className="block text-sm">Evidence review reason<textarea required className={auditField} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}/></label><div className="flex gap-2"><button className={auditButton} disabled={c.busy || !!c.pending || !c.canManage || !reason.trim()}>Save evidence decision</button><button className={auditButton} type="button" disabled={c.busy} onClick={() => setReview(null)}>Close review draft</button></div></form>}</section>;
}
export function AuditServiceHistory({ controller: c }: {
    controller: AuditDecisionController;
}) { const page = useAuditPage(c, 'service_history'), crawls = useAuditPage(c, 'crawls'); return <section className="space-y-4 rounded-xl border border-border bg-background p-4" aria-label="Audit worker history"><h3 className="font-semibold">Website crawls and worker history</h3><p className="text-sm text-muted-foreground">Worker observations have a separate source from staff decisions. No record here is approved for model training.</p><button className={auditButton} disabled={page.busy || crawls.busy} onClick={() => { void page.load(); void crawls.load(); }}>Refresh worker history</button>{crawls.error && <p role="alert">{crawls.error}</p>}<ul className="space-y-2">{crawls.data?.items?.map(r => <li key={String(r.id)} className="rounded-lg border border-border p-3 text-sm"><p className="break-words">{String(r.seed_url)} · {String(r.status)}{r.measurement_mode === 'local_fixture' ? ' · Synthetic fixture' : ''}</p><p>{String(r.pages_crawled)} pages captured · limit {String(r.page_cap)}</p><AuditCrawlControls id={String(r.id)} controller={c}/>{Boolean(r.error_message) && <p className="whitespace-pre-wrap">{String(r.error_message)}</p>}</li>)}</ul><AuditPageButtons page={crawls} label="crawls"/>{page.error && <p role="alert">{page.error}</p>}<ol className="space-y-2">{page.data?.items?.map(r => <li key={String(r.id)} className="rounded-lg border border-border p-3 text-sm"><p>{String(r.kind).replaceAll('_', ' ')} · {new Date(String(r.created_at)).toLocaleString()}</p><details><summary>Recorded worker evidence</summary><div className="mt-2 max-h-96 overflow-auto"><AuditEvidence value={r.detail}/></div></details></li>)}</ol><AuditPageButtons page={page} label="worker events"/></section>; }
export function AuditRunRequest({ controller: c, onClose }: {
    controller: AuditDecisionController;
    onClose: () => void;
}) {
    const [source, setSource] = useState<AuditContext | null>(c.context), [models, setModels] = useState<AuditModels | null>(c.models), [surfaces, setSurfaces] = useState<Surface[]>(['chatgpt']), [repeats, setRepeats] = useState(1), [crawl, setCrawl] = useState(Boolean(c.context?.property.website_url));
    const [preflight, setPreflight] = useState<{
        selection: string;
        surfaces?: Array<{
            surface: Surface;
            ready: boolean;
        }>;
        runtime?: {
            ready: boolean;
        };
    } | null>(null), [error, setError] = useState('');
    useEffect(() => {
        if (!source)
            return;
        const abort = new AbortController();
        void fetch(`/api/propertyaudit/preflight?propertyId=${source.property.id}&surfaces=${surfaces.join(',')}`, { signal: abort.signal, cache: 'no-store' }).then(async (r) => {
            if (!r.ok)
                throw new Error('Audit readiness could not be checked.');
            return r.json();
        }).then(r => { setPreflight({ ...r, selection: source.property.id + surfaces.join(',') }); setError(''); }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Audit readiness unavailable');
        });
        return () => abort.abort();
    }, [source, surfaces]);
    async function submit() {
        if (!source || !models)
            return;
        const r = await c.execute({ operation: 'run_request', sourceHash: source.hash, modelHash: models.hash, surfaces, executionCount: repeats, includeSiteCrawl: crawl });
        if (r)
            onClose();
    }
    async function refresh() {
        const r = await c.refresh();
        if (r) {
            setSource(r.context!);
            setModels(r.models!);
        }
    }
    const ready = preflight?.selection === source?.property.id + surfaces.join(',') && preflight?.runtime?.ready && surfaces.every(s => preflight.surfaces?.find(x => x.surface === s)?.ready), count = (source?.queryCount || 0) * repeats;
    return <div role="dialog" aria-modal="true" aria-label="Review audit request" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-border bg-background p-5"><div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">Review audit request</h2><button className={auditButton} disabled={c.busy} onClick={onClose}>Close audit request</button></div><AuditDecisionRecovery controller={c}/>{error && <p role="alert">{error}</p>}<p className="text-sm">{source?.queryCount || 0} active questions · {count * surfaces.length} requested measurements. Repeats show response variability; they do not establish statistical confidence.</p><fieldset className="space-y-2"><legend className="font-medium">Models to measure</legend>{models?.surfaces.filter(m => m.surface !== 'openai').map(m => <label key={m.surface} className="flex gap-2 text-sm"><input type="checkbox" checked={surfaces.includes(m.surface)} onChange={e => setSurfaces(old => e.target.checked ? [...old, m.surface] : old.filter(s => s !== m.surface))}/>{getSurfaceLabel(m.surface)} · {m.modelName}</label>)}</fieldset><label className="block text-sm">Repeat each question<input type="number" min={1} max={5} step={1} className={auditField} value={repeats} onChange={e => setRepeats(Number(e.target.value))}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={crawl} disabled={!source?.property.website_url} onChange={e => setCrawl(e.target.checked)}/><span>Include website crawl and grounded recommendations<br /><span className="break-all text-xs text-muted-foreground">{source?.property.website_url || 'Add the property website first'} · up to {source?.configuration?.crawl_page_cap || 500} pages</span></span></label>{!crawl && <p className="text-sm">This request measures AI answers only. New website findings and grounded recommendations require a crawl.</p>}<details><summary>Review the captured question set</summary><ol className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">{source?.queries.map(q => <li key={q.id} className="whitespace-pre-wrap break-words">{q.text} · {q.type} · weight {q.weight ?? 1} · {q.geo || 'No location specified'}</li>)}</ol></details>{!ready && <p className="text-sm text-amber-700">Audit execution is waiting for a ready worker and the selected providers.</p>}<div className="flex flex-wrap gap-2"><button className={auditButton} disabled={c.busy} onClick={() => void refresh()}>Refresh reviewed configuration</button><button className={auditButton} disabled={!c.canManage || c.busy || !!c.pending || !ready || surfaces.length === 0 || !Number.isInteger(repeats) || repeats < 1 || repeats > 5 || count < 1 || count > 300} onClick={() => void submit()}>Save and queue reviewed audit</button></div></section></div>;
}
function AuditCrawlControls({ id, controller: c }: {
    id: string;
    controller: AuditDecisionController;
}) {
    const [data, setData] = useState<{
        source: Record<string, unknown>;
        hash: string;
    } | null>(null), [error, setError] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), generation = useRef(0);
    useEffect(() => () => { generation.current++; }, []);
    async function read() {
        const n = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await c.read({ kind: 'crawl', id });
            if (n === generation.current)
                setData({ source: r.source!, hash: r.hash! });
        }
        catch (e) {
            if (n === generation.current)
                setError(e instanceof Error ? e.message : 'Crawl source unavailable');
        }
        finally {
            if (n === generation.current)
                setBusy(false);
        }
    }
    async function decide(operation: string) {
        if (!data)
            return;
        const r = await c.execute({ operation, crawlId: id, sourceHash: data.hash, reason });
        if (r)
            await read();
    }
    return <div className="mt-2 space-y-2"><button className={auditButton} disabled={busy} onClick={() => void read()}>Inspect website crawl</button>{error && <p role="alert">{error}</p>}{data && <div className="space-y-3"><details><summary>Captured website settings and progress</summary><div className="max-h-64 overflow-auto"><AuditEvidence value={data.source}/></div></details><AuditCrawlReceipts key={`${c.actor}:${c.context?.property.id}:${id}`} actorId={c.actor} propertyId={c.context?.property.id || ''} crawlId={id} version={c.version}/>{Boolean(data.source.operator_request_id) && <><label className="block text-sm">Website crawl decision reason<textarea className={auditField} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)}/></label>{data.source.status === 'queued' || data.source.status === 'running' ? <button className={auditButton} disabled={busy || c.busy || !!c.pending || !c.canManage} onClick={() => void decide('crawl_stop')}>Stop website crawl</button> : data.source.status === 'failed' ? <button className={auditButton} disabled={busy || c.busy || !!c.pending || !c.canManage} onClick={() => void decide('crawl_retry')}>Request linked website crawl retry</button> : null}</>}</div>}</div>;
}
