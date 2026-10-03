'use client';
import { useEffect, useRef, useState } from 'react';
import { pendingLeadRecord } from './record-contracts';
export type LeadStatus = 'new' | 'contacted' | 'tour_booked' | 'toured' | 'leased' | 'lost';
export type RecordLead = {
    id: string;
    property_id: string;
    record_revision: number;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    source: string;
    status: LeadStatus;
    notes?: string | null;
    bedrooms?: string | null;
    move_in_date?: string | null;
    created_at: string;
    updated_at?: string | null;
    last_contacted_at?: string | null;
    score?: number | null;
    score_bucket?: string | null;
    external_crm_id?: string | null;
    crm_sync_status?: 'pending' | 'retrying' | 'created' | 'linked' | 'failed' | 'skipped' | 'dead_lettered';
    crm_synced_at?: string | null;
};
export type Followup = {
    hash: string;
    workflows: Array<{
        id: string;
        name: string;
        description: string | null;
        steps: Array<{
            action: string;
            delay_hours: number;
            template_slug?: string;
        }>;
    }>;
};
export type LeadMatches = {
    hash: string;
    count: number;
    items: Array<{
        id: string;
        record_revision: number;
        first_name: string;
        last_name: string;
        email: string | null;
        phone: string | null;
    }>;
};
type Reply = {
    propertyId: string;
    actorId?: string;
    id?: string;
    leadId?: string;
    status?: string;
    lead?: RecordLead;
    canManage?: boolean;
    followup?: Followup;
    startedFollowups?: number;
    stoppedFollowups?: number;
    crmPreparation?: {
        state: string;
        handoffId?: string;
    };
    matches?: LeadMatches;
    error?: string;
    [key: string]: unknown;
};
class ReplyError extends Error {
    constructor(message: string, readonly result?: Reply) { super(message); }
}
const key = (actor: string, property: string) => `p11.lead-record.v1:${actor}:${property}`;
export function useLeadRecords(propertyId: string, onSaved: (lead: RecordLead) => void) {
    const controller = useRef<AbortController | null>(null), locked = useRef(false), actorRef = useRef(''), savedRef = useRef(onSaved);
    savedRef.current = onSaved;
    const [actor, setActor] = useState(''), [canManage, setCanManage] = useState(false), [followup, setFollowup] = useState<Followup | null>(null), [pending, setPending] = useState<{
        id: string;
    } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [matches, setMatches] = useState<LeadMatches | null>(null);
    async function request(input: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', expectedActor = actorRef.current): Promise<Reply> {
        const q = new URLSearchParams(method === 'GET' ? Object.fromEntries(Object.entries({ ...input, propertyId }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {});
        const response = await fetch('/api/leads' + (method === 'GET' ? '?' + q : ''), { method, cache: 'no-store', signal: controller.current?.signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, propertyId, expectedActorId: expectedActor }) } : {}) });
        const r = await response.json();
        if (!response.ok)
            throw new ReplyError(r.error || 'Lead result unavailable.', r);
        if (r.propertyId !== propertyId || method === 'POST' && input.id && r.id !== input.id || method === 'GET' && expectedActor && r.actorId !== expectedActor)
            throw new Error('This lead response does not match the current property, account or request.');
        return r;
    }
    async function refreshContext() { const r = await request({ kind: 'context' }); setCanManage(!!r.canManage); setFollowup(r.followup!); return r; }
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        void request({ kind: 'context' }, 'GET', '').then(r => {
            if (abort.signal.aborted)
                return;
            const raw = sessionStorage.getItem(key(r.actorId!, propertyId));
            if (raw) {
                const parsed = pendingLeadRecord.safeParse(JSON.parse(raw));
                if (!parsed.success)
                    throw new Error('This browser has an unreadable saved lead request. Keep this tab and contact your administrator.');
                setPending(parsed.data);
            }
            actorRef.current = r.actorId!;
            setActor(r.actorId!);
            setCanManage(!!r.canManage);
            setFollowup(r.followup!);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : 'Lead controls unavailable.');
        });
        return () => abort.abort();
        // The workspace is keyed by property; obsolete calls are aborted before switching.
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
            if (!controller.current?.signal.aborted) {
                setError(e instanceof Error ? e.message : 'Lead result could not be confirmed.');
                if (e instanceof ReplyError && e.result?.matches)
                    setMatches(e.result.matches);
            }
            return null;
        }
        finally {
            locked.current = false;
            if (!controller.current?.signal.aborted)
                setBusy(false);
        }
    }
    async function settle(r: Reply) {
        sessionStorage.removeItem(key(actorRef.current, propertyId));
        setPending(null);
        setMatches(null);
        let message = r.status === 'cancelled_request' ? 'Unused lead request cancelled.' : 'Lead decision saved.';
        if (r.stoppedFollowups)
            message += ` ${r.stoppedFollowups} follow-up workflow(s) stopped.`;
        if (r.startedFollowups)
            message += ` ${r.startedFollowups} reviewed follow-up workflow(s) started.`;
        if (r.crmPreparation)
            message += r.crmPreparation.handoffId ? ' CRM transfer prepared for separate review.' : ' CRM setup or qualification needs review; no transfer was sent.';
        setNotice(message);
        try {
            if (r.leadId) {
                const current = await request({ kind: 'lead', id: r.leadId });
                if (current.lead)
                    savedRef.current(current.lead);
                setFollowup(current.followup!);
                setCanManage(!!current.canManage);
            }
            else
                await refreshContext();
        }
        catch {
            if (!controller.current?.signal.aborted)
                setError('The decision is saved, but current lead details could not be refreshed. Reload before editing.');
        }
        return r;
    }
    async function save(input: Record<string, unknown>) { const id = crypto.randomUUID(); sessionStorage.setItem(key(actorRef.current, propertyId), JSON.stringify({ id })); setPending({ id }); return settle(await request({ ...input, id }, 'POST')); }
    function execute(input: Record<string, unknown>) {
        return work(async () => {
            if (!actorRef.current || !canManage || pending)
                throw new Error('Resolve the saved request and current access before changing this lead.');
            return save(input);
        });
    }
    function recover() {
        return work(async () => {
            if (!pending)
                throw new Error('No saved lead request.');
            return settle(await request({ kind: 'command', id: pending.id }));
        });
    }
    function cancel() {
        return work(async () => {
            if (!pending)
                throw new Error('No saved lead request.');
            return settle(await request({ operation: 'cancel_request', id: pending.id }, 'POST'));
        });
    }
    function saveSeparate(input: Record<string, unknown>) {
        return work(async () => {
            if (!pending || !matches || !canManage)
                throw new Error('Review the current matching contacts first.');
            const resolved = await request({ operation: 'cancel_request', id: pending.id }, 'POST');
            await settle(resolved);
            if (resolved.status !== 'cancelled_request')
                return resolved;
            return save(input);
        });
    }
    return { actor, canManage, followup, pending, busy, error, notice, matches, execute, recover, cancel, saveSeparate, read: request, refreshContext: () => work(refreshContext), clearNotice: () => setNotice('') };
}
export type LeadRecordController = ReturnType<typeof useLeadRecords>;
