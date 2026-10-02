'use client';
import { useEffect, useRef, useState } from 'react';
import type { AuditDecisionController, AuditReply } from '@/utils/propertyaudit/use-audit-decisions';
import { AuditDecisionRecovery, auditButton, auditField } from './AuditDecisionHistory';
import { AuditInvocationEvidence } from './AuditWorkspaceControls';
type Run = {
    id: string;
    surface: string;
    model_name: string;
    status: string;
    measurement_mode: string;
    control_revision: number;
    archived_at: string | null;
    stopped_by_operator: boolean;
    retry_of: string | null;
    started_at: string;
    query_count: number;
    execution_count: number;
    provider_failure_reason: string | null;
};
type Source = {
    run: Run;
    job: {
        snapshot: Record<string, unknown>;
        state: string;
    } | null;
    answers: Array<{
        answer: {
            id: string;
            answer_summary: string | null;
            natural_response?: string | null;
            presence: boolean;
        };
        citations: Array<{
            url: string;
            domain: string;
        }>;
    }>;
    invocations: Array<{
        id: string;
        itemId: string;
        attempt: number;
        state: string;
        applied: boolean;
        startedAt: string;
        returnedAt: string | null;
        resultHash: string | null;
        errorCode: string | null;
    }>;
};
type Item = {
    id: string;
    ordinal: number;
    query: {
        text: string;
        type: string;
        weight: number;
        geo: string | null;
    };
    state: string;
    attempts: number;
    answerId: string | null;
    errorCode: string | null;
};
export function AuditRunDecisionControls({ runId, controller: c, onOpenRun }: {
    runId: string;
    controller: AuditDecisionController;
    onOpenRun?: (id: string) => void;
}) {
    const [data, setData] = useState<AuditReply | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState(''), [review, setReview] = useState('inconclusive'), [page, setPage] = useState(0), [linked, setLinked] = useState<string | null>(null);
    const generation = useRef(0);
    async function load() {
        const turn = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await c.read({ kind: 'run', id: runId });
            if (turn === generation.current)
                setData(r);
        }
        catch (e) {
            if (turn === generation.current)
                setError(e instanceof Error ? e.message : 'Saved audit source unavailable.');
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
        // Preserve typed review notes while refreshing exact source evidence.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runId, c.actor, c.version]);
    const source = data?.source as Source | undefined, run = source?.run, items = (data?.items || []) as unknown as Item[], disabled = busy || c.busy || !!c.pending || !c.canManage || !run;
    async function decide(operation: string) {
        if (!run || !data)
            return;
        const r = await c.execute({ operation, runId: run.id, revision: run.control_revision, sourceHash: data.hash, reason, ...(operation === 'run_review' ? { review } : {}) });
        if (r && typeof r.runId === 'string' && r.runId !== run.id)
            setLinked(r.runId);
    }
    return <section aria-label="Saved audit controls" className="space-y-4 rounded-xl border border-border bg-background p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Saved audit source and decisions</h3><button className={auditButton} disabled={busy || !c.actor} onClick={() => void load()}>Refresh saved audit</button></div><AuditDecisionRecovery controller={c}/>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{!data && !error && <p className="text-sm">Loading captured source…</p>}{run && <><p className="text-sm">{run.stopped_by_operator ? 'Stopped by an operator' : run.status} · {run.surface} · {run.model_name}{run.archived_at ? ' · Archived' : ''}</p>{run.measurement_mode === 'local_fixture' && <p className="rounded-lg border border-amber-500 p-3 text-sm">Synthetic local measurement. This is test evidence, not a provider result or a client outcome.</p>}{run.retry_of && <p className="text-sm">This is a linked retry using the earlier captured question source. {onOpenRun && <button className="underline" onClick={() => onOpenRun(run.retry_of!)}>Open original audit</button>}</p>}{!source?.job && <p className="text-sm text-muted-foreground">This older run has no complete captured execution source. A new run requires review of the current configuration.</p>}<p className="text-sm">{source?.answers.length || 0} retained answers · {items.length} captured question executions · {source?.invocations.length || 0} recorded provider invocations.</p><details><summary className="text-sm font-medium">Review captured questions</summary><ol className="mt-3 space-y-3">{items.slice(page * 20, page * 20 + 20).map(item => <li key={item.id} className="rounded-lg border border-border p-3 text-sm"><p className="whitespace-pre-wrap break-words">{item.ordinal}. {item.query.text}</p><p className="mt-1 text-xs text-muted-foreground">{item.query.type.replaceAll('_', ' ')} · weight {item.query.weight} · {item.query.geo || 'No location specified'} · {item.state}{item.errorCode ? ` · ${item.errorCode.replaceAll('_', ' ')}` : ''}</p>{item.answerId && (() => { const value = source?.answers.find(a => a.answer.id === item.answerId); return value ? <details className="mt-2"><summary>Saved answer and citations</summary><p className="mt-2 whitespace-pre-wrap break-words">{value.answer.natural_response || value.answer.answer_summary || 'No answer text recorded.'}</p><ul className="mt-2 space-y-1">{value.citations.map((citation, i) => <li key={i} className="break-all">{citation.url}</li>)}</ul></details> : null; })()}</li>)}</ol><div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>{items.length ? `${page * 20 + 1}–${Math.min((page + 1) * 20, items.length)} of ${items.length}` : 'No captured executions'}</span><button className={auditButton} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous questions</button><button className={auditButton} disabled={(page + 1) * 20 >= items.length} onClick={() => setPage(p => p + 1)}>Next questions</button></div></details><details><summary className="text-sm font-medium">Recorded provider responses</summary><ul className="mt-3 space-y-2">{source?.invocations.map(v => <li key={v.id} className="rounded-lg border border-border p-3 text-sm">Attempt {v.attempt} · {v.state === 'started' ? 'Response unconfirmed' : v.state === 'failed' ? 'Provider failure retained' : v.applied ? 'Returned response applied' : 'Returned response retained; not applied'}<p className="mt-1 text-xs text-muted-foreground">Started {new Date(v.startedAt).toLocaleString()}{v.returnedAt ? ` · returned ${new Date(v.returnedAt).toLocaleString()}` : ''}{v.errorCode ? ` · ${v.errorCode.replaceAll('_', ' ')}` : ''}</p><AuditInvocationEvidence id={v.id} controller={c}/></li>)}</ul>{source?.invocations.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No invocation receipts are recorded under the current contract. Older results retain their original provenance.</p>}</details><label className="block text-sm">Decision reason<textarea className={auditField} rows={2} maxLength={2000} value={reason} disabled={c.busy} onChange={e => setReason(e.target.value)}/></label><div className="flex flex-wrap gap-2">{['queued', 'running'].includes(run.status) ? <button className={auditButton} disabled={disabled} onClick={() => void decide('run_stop')}>Stop answer measurements</button> : <>{run.status === 'failed' && !run.archived_at && <button className={auditButton} disabled={disabled || !source?.job} onClick={() => void decide('run_retry')}>Request linked audit retry</button>}<button className={auditButton} disabled={disabled} onClick={() => void decide(run.archived_at ? 'run_restore' : 'run_archive')}>{run.archived_at ? 'Restore audit' : 'Archive audit'}</button></>}</div>{!['queued', 'running'].includes(run.status) && <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Review this exact measurement</legend><label className="block text-sm">Review conclusion<select className={auditField} value={review} disabled={disabled} onChange={e => setReview(e.target.value)}><option value="inconclusive">Inconclusive</option><option value="needs_correction">Needs correction</option><option value="accepted_for_planning">Accept for planning</option></select></label><button className={auditButton} disabled={disabled || !reason.trim()} onClick={() => void decide('run_review')}>Save audit evidence review</button><p className="text-xs text-muted-foreground">A planning decision does not verify a commercial outcome or an improvement caused by a change.</p></fieldset>}{linked && onOpenRun && <button className={auditButton} onClick={() => onOpenRun(linked)}>Open linked audit retry</button>}</>}</section>;
}
