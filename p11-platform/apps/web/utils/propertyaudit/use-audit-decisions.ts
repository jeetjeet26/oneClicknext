'use client';
import { useEffect, useRef, useState } from 'react';
import { pendingAuditDecision, type AuditQueryFields } from './decision-contracts';
import type { Surface } from './types';
export type AuditQuery = {
    id: string;
    property_id: string;
    text: string;
    type: AuditQueryFields['type'];
    geo: string | null;
    weight: number | null;
    run_count: number | null;
    is_active: boolean | null;
    archived_at: string | null;
    decision_revision: number;
    created_at: string | null;
    updated_at: string | null;
};
export type AuditContext = {
    hash: string;
    queryCount: number;
    queries: AuditQuery[];
    property: {
        id: string;
        name: string;
        address: Record<string, unknown> | null;
        website_url: string | null;
        property_type: string | null;
        amenities: string[] | null;
        special_features: string[] | null;
    };
    brand: {
        id: string;
        unique_selling_points: unknown;
    } | null;
    competitors: Array<{
        id: string;
        name: string;
    }>;
    configuration: {
        domains: unknown;
        competitor_domains: unknown;
        crawl_page_cap: number;
    } | null;
};
export type AuditModels = {
    hash: string;
    measurementMode: string;
    surfaces: Array<{
        surface: Surface;
        modelName: string;
    }>;
};
export type AuditReply = {
    propertyId: string;
    actorId?: string;
    id?: string;
    state?: string;
    status?: string;
    operation?: string;
    canManage?: boolean;
    context?: AuditContext;
    models?: AuditModels;
    items?: Array<Record<string, unknown>>;
    count?: number;
    hash?: string;
    offset?: number;
    source?: Record<string, unknown>;
    [key: string]: unknown;
};
const storageKey = (actor: string, property: string) => `p11.audit-decision.v1:${actor}:${property}`;
export function useAuditDecisions(propertyId: string, onSaved: () => void) {
    const abortRef = useRef<AbortController | null>(null), actorRef = useRef(''), locked = useRef(false), savedRef = useRef(onSaved);
    savedRef.current = onSaved;
    const [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [context, setContext] = useState<AuditContext | null>(null), [models, setModels] = useState<AuditModels | null>(null), [busy, setBusy] = useState(false), [pending, setPending] = useState<{
        id: string;
    } | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [version, setVersion] = useState(0);
    async function read(input: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actorRef.current): Promise<AuditReply> {
        const query = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...input, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {}), response = await fetch('/api/propertyaudit/decisions' + (method === 'GET' ? '?' + query : ''), { method, cache: 'no-store', signal: abortRef.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, propertyId, expectedActorId: expectedActor }) } : {}) }), result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Audit result unavailable.');
        if (result.propertyId !== propertyId || method === 'GET' && expectedActor && result.actorId !== expectedActor || method === 'POST' && result.id !== input.id)
            throw new Error('This audit result does not match the current property, account or request.');
        return result;
    }
    function applyContext(r: AuditReply) { setCanManage(!!r.canManage); setContext(r.context!); setModels(r.models!); }
    async function refresh() { const r = await read({ kind: 'context' }); applyContext(r); return r; }
    useEffect(() => {
        const abort = new AbortController();
        abortRef.current = abort;
        void read({ kind: 'context' }, 'GET', '').then(r => {
            if (abort.signal.aborted)
                return;
            const raw = sessionStorage.getItem(storageKey(r.actorId!, propertyId));
            if (raw) {
                const parsed = pendingAuditDecision.safeParse(JSON.parse(raw));
                if (!parsed.success)
                    throw new Error('This browser has an unreadable saved audit request. Keep this tab and contact your administrator.');
                setPending(parsed.data);
            }
            actorRef.current = r.actorId!;
            setActor(r.actorId!);
            applyContext(r);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Audit controls unavailable.');
        });
        return () => abort.abort();
        // The property workspace owns and aborts all its pending reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]);
    async function work<T>(fn: () => Promise<T>): Promise<T | null> {
        if (locked.current)
            return null;
        locked.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            return await fn();
        }
        catch (e) {
            if (!abortRef.current?.signal.aborted)
                setError(e instanceof Error ? e.message : 'Audit result unavailable.');
            return null;
        }
        finally {
            locked.current = false;
            if (!abortRef.current?.signal.aborted)
                setBusy(false);
        }
    }
    async function settle(r: AuditReply) {
        sessionStorage.removeItem(storageKey(actorRef.current, propertyId));
        setPending(null);
        setNotice(r.status === 'cancelled_request' ? 'Unused audit request cancelled.' : r.operation === 'run_request' ? 'Audit request saved. Measurements remain pending.' : r.operation === 'run_retry' ? 'Linked audit retry saved with its original question source.' : r.operation === 'run_stop' ? 'Audit stopped. Earlier results and any returning responses remain in history.' : r.operation === 'query_restore' ? 'Questions restored as inactive. Review them before activation.' : r.operation === 'finding_review' || r.operation === 'recommendation_review' ? 'Review saved as a staff decision. A later measurement must verify any improvement.' : 'Audit decision saved.');
        setVersion(v => v + 1);
        savedRef.current();
        try {
            await refresh();
        }
        catch {
            if (!abortRef.current?.signal.aborted)
                setError('The audit decision is saved, but current configuration could not be refreshed. Reload before making another change.');
        }
        return r;
    }
    const execute = (input: Record<string, unknown>) => work(async () => {
        if (!actorRef.current || !canManage || pending)
            throw new Error('Resolve the saved request and current access before another audit decision.');
        const id = crypto.randomUUID();
        sessionStorage.setItem(storageKey(actorRef.current, propertyId), JSON.stringify({ id }));
        setPending({ id });
        return settle(await read({ ...input, id }, 'POST'));
    });
    const recover = () => work(async () => {
        if (!pending)
            throw new Error('No saved audit request.');
        return settle(await read({ kind: 'command', id: pending.id }));
    });
    const cancel = () => work(async () => {
        if (!pending)
            throw new Error('No saved audit request.');
        return settle(await read({ operation: 'cancel_request', id: pending.id }, 'POST'));
    });
    return { changed: () => { setVersion(v => v + 1); savedRef.current(); }, actor, canManage, context, models, busy, pending, error, notice, version, read, execute, recover, cancel, refresh: () => work(refresh) };
}
export type AuditDecisionController = ReturnType<typeof useAuditDecisions>;
