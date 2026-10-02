'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { LeadFields } from '@/utils/leads/record-contracts';
import type { RecordLead, LeadRecordController, Followup } from '@/utils/leads/use-lead-records';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40', field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2';
export function LeadRecordRecovery({ controller: c }: {
    controller: LeadRecordController;
}) { return <div className="space-y-2">{c.error && <p role="alert" className="rounded-lg border border-amber-500 p-3 text-sm">{c.error}</p>}{c.notice && <p role="status" className="rounded-lg border border-border p-3 text-sm">{c.notice}</p>}{c.pending && <section aria-label="Saved lead request" className="rounded-lg border border-border p-3 text-sm"><p>Check the last request before making another change. Cancelling an unused request prevents it from arriving later; a saved decision stays recorded.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={c.busy} onClick={() => void c.recover()}>Check lead request</button><button type="button" className={button} disabled={c.busy || !c.canManage} onClick={() => void c.cancel()}>Cancel unused lead request</button></div></section>}</div>; }
function FollowupChoices({ context, chosen, onChange, disabled }: {
    context: Followup | null;
    chosen: string[];
    onChange: (v: string[]) => void;
    disabled: boolean;
}) { return <fieldset className="space-y-3 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Existing follow-up (optional)</legend>{!context ? <p className="text-sm">Loading active follow-up…</p> : context.workflows.length === 0 ? <p className="text-sm text-muted-foreground">No enabled follow-up is configured. Saving a lead will not create or enable a default.</p> : context.workflows.map(w => <div key={w.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={chosen.includes(w.id)} onChange={e => onChange(e.target.checked ? [...chosen, w.id] : chosen.filter(id => id !== w.id))}/>{w.name}</label>{w.description && <p className="mt-1 text-xs text-muted-foreground">{w.description}</p>}<details className="mt-1 text-xs"><summary>Review follow-up steps</summary><ol className="mt-2 space-y-1">{w.steps.map((s, i) => <li key={i}>{i + 1}. {s.action === 'wait' ? 'Wait' : s.action === 'email' ? 'Email' : 'Text message'} · delay {s.delay_hours} hours{s.template_slug ? ` · ${s.template_slug}` : ''}</li>)}</ol></details></div>)}</fieldset>; }
export function LeadRecordEditor({ lead: latestLead, controller: c, onClose, onSaved }: {
    lead?: RecordLead;
    controller: LeadRecordController;
    onClose: () => void;
    onSaved: (lead?: RecordLead) => void;
}) {
    const [lead] = useState(latestLead);
    const formId = useId();
    const [fields, setFields] = useState<LeadFields>(() => ({ firstName: lead?.first_name || '', lastName: lead?.last_name || '', email: lead?.email || '', phone: lead?.phone || '', source: lead?.source || 'manual', bedrooms: lead?.bedrooms || '', moveInDate: lead?.move_in_date || '', notes: lead?.notes || '' })), [chosen, setChosen] = useState<string[]>([]), [prepareCrm, setPrepareCrm] = useState(false), [reason, setReason] = useState(''), [formError, setFormError] = useState('');
    const disabled = c.busy || !!c.pending || !c.canManage || !c.actor;
    const input = () => lead ? { operation: 'edit', leadId: lead.id, revision: lead.record_revision, fields, duplicateReason: '' } : { operation: 'create', fields, duplicateReason: '', workflowIds: [...chosen].sort(), workflowHash: c.followup?.hash, prepareCrm };
    async function submit(separate = false) {
        setFormError('');
        if (separate && !reason.trim()) {
            setFormError('Explain why these contact details belong in a separate record.');
            return;
        }
        const result = separate ? await c.saveSeparate({ ...input(), duplicateHash: c.matches?.hash, duplicateReason: reason }) : await c.execute(input());
        if (result?.leadId) {
            onSaved(result.lead);
            onClose();
        }
    }
    return <Dialog open onOpenChange={open => {
            if (!open && !c.busy)
                onClose();
        }}><DialogContent className="flex max-h-[90vh] max-w-2xl flex-col"><DialogHeader><DialogTitle>{lead ? 'Edit Lead' : 'Create Lead'}</DialogTitle><DialogDescription>Save reviewed contact details and preferences. Matching contact information is reviewed before a separate record is created.</DialogDescription></DialogHeader><form id={formId} className="space-y-4 overflow-auto p-5" onSubmit={e => { e.preventDefault(); void submit(); }}>
  <LeadRecordRecovery controller={c}/>{formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}{!c.canManage && c.actor && <p className="text-sm">An administrator or manager can edit lead records.</p>}
  <div className="grid gap-4 sm:grid-cols-2">{([['firstName', 'First Name', 'text'], ['lastName', 'Last Name', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['source', 'Source', 'text'], ['bedrooms', 'Bedroom preference', 'text'], ['moveInDate', 'Preferred move-in date', 'date']] as const).map(([key, label, type]) => <label key={key} className="text-sm">{label}<input type={type} className={field} required={['firstName', 'lastName', 'source'].includes(key)} disabled={c.busy} value={fields[key]} maxLength={key === 'email' ? 254 : key === 'phone' || key === 'bedrooms' ? 40 : 120} onChange={e => setFields(old => ({ ...old, [key]: e.target.value }))}/></label>)}</div><label className="block text-sm">Lead preferences and notes<textarea className={field} rows={3} maxLength={8000} disabled={c.busy} value={fields.notes} onChange={e => setFields(old => ({ ...old, notes: e.target.value }))}/></label>
  {!lead && <><FollowupChoices context={c.followup} chosen={chosen} onChange={setChosen} disabled={disabled}/><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={prepareCrm} disabled={disabled} onChange={e => setPrepareCrm(e.target.checked)}/>Prepare a CRM transfer for separate review if setup is qualified</label></>}
  {c.matches && <section aria-label="Matching contacts" className="space-y-3 rounded-lg border border-amber-500 p-3 text-sm"><h3 className="font-semibold">{c.matches.count} existing lead(s) use this contact information</h3><p>No existing record was changed. Check that you are recording a separate person. {c.matches.count > c.matches.items.length ? `Showing ${c.matches.items.length} matching examples.` : ''}</p><ul className="space-y-2">{c.matches.items.map(m => <li key={m.id}>{m.first_name} {m.last_name} · {m.email || m.phone}<p className="text-xs text-muted-foreground">Search these contact details to inspect or edit the existing lead.</p></li>)}</ul><label className="block">Reason for a separate record<textarea className={field} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={c.busy}/></label><button type="button" className={button} disabled={c.busy || !c.canManage || !c.pending || !reason.trim()} onClick={() => void submit(true)}>{lead ? 'Save these reviewed shared contact details' : 'Create a separate lead'}</button></section>}
 </form><DialogFooter><button type="button" className={button} disabled={c.busy} onClick={onClose}>Close</button><button type="submit" form={formId} className={button} disabled={disabled || !c.followup}>{c.busy ? 'Saving…' : lead ? 'Save Changes' : 'Create Lead'}</button></DialogFooter></DialogContent></Dialog>;
}
type History = {
    id: string;
    actorName: string;
    created_at: string;
    input: {
        operation: string;
        reason?: string;
        duplicateReason?: string;
    };
    before_state: RecordLead | null;
    after_state: {
        lead: RecordLead;
        startedFollowups: unknown[];
        stoppedFollowups: unknown[];
        crmPreparation?: {
            state: string;
        };
    } | null;
};
const changes = (before: RecordLead | null, after: RecordLead) => Object.entries({ first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone', source: 'Source', status: 'Reported status', bedrooms: 'Bedroom preference', move_in_date: 'Move-in preference', notes: 'Preferences and notes' }).filter(([key]) => !before || before[key as keyof RecordLead] !== after[key as keyof RecordLead]).map(([key, label]) => ({ key, label, before: before?.[key as keyof RecordLead], after: after[key as keyof RecordLead] }));
export function LeadRecordHistory({ leadId, controller: c }: {
    leadId: string;
    controller: LeadRecordController;
}) {
    const generation = useRef(0);
    const [data, setData] = useState<{
        items: History[];
        count: number;
        hash: string;
        offset: number;
    } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    async function load(offset = 0, hash?: string) {
        const turn = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await c.read({ kind: 'history', id: leadId, offset, expectedHash: hash });
            if (turn === generation.current)
                setData(r as unknown as typeof data);
        }
        catch (e) {
            if (turn === generation.current)
                setError(e instanceof Error ? e.message : 'Lead history unavailable.');
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
        // Each lead/actor gets a fresh read; obsolete reads cannot replace its history.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leadId, c.actor, c.notice]);
    return <section aria-label="Lead record history" className="mb-5 rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Lead record history</h3><button className={button} disabled={busy || !c.actor} onClick={() => void load()}>Refresh record history</button></div>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{!data && !error && <p className="mt-3 text-sm">Loading saved changes…</p>}{data?.count === 0 && <p className="mt-3 text-sm text-muted-foreground">No changes have been recorded under the current history contract. Earlier details retain their original source.</p>}<ol className="mt-3 space-y-3">{data?.items.map(h => <li key={h.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">{({ create: 'Lead created', edit: 'Details edited', status: 'Reported status changed', start_followup: 'Follow-up started', prepare_crm: 'CRM preparation reviewed' } as Record<string, string>)[h.input.operation] || 'Lead decision'} · {h.actorName}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</p>{(h.input.reason || h.input.duplicateReason) && <p className="mt-2 break-words">{h.input.reason || h.input.duplicateReason}</p>}{h.after_state && <><dl className="mt-3 space-y-2">{changes(h.before_state, h.after_state.lead).map(v => <div key={v.key}><dt className="text-muted-foreground">{v.label}</dt><dd className="whitespace-pre-wrap break-words">{h.before_state ? `${v.before || 'Not recorded'} → ` : ''}{String(v.after || 'Not recorded')}</dd></div>)}</dl>{h.after_state.stoppedFollowups?.length > 0 && <p className="mt-2">{h.after_state.stoppedFollowups.length} future follow-up(s) stopped.</p>}{h.after_state.startedFollowups?.length > 0 && <p className="mt-2">{h.after_state.startedFollowups.length} selected follow-up(s) started.</p>}{h.after_state.crmPreparation && <p className="mt-2">CRM preparation: {h.after_state.crmPreparation.state.replaceAll('_', ' ')}. Delivery is reviewed separately.</p>}</>}</li>)}</ol>{data && <div className="mt-4 flex flex-wrap items-center gap-2 text-sm"><span>{data.count ? `${data.offset + 1}–${Math.min(data.offset + 20, data.count)} of ${data.count}` : '0 decisions'}</span><button className={button} disabled={busy || data.offset === 0} onClick={() => void load(Math.max(0, data.offset - 20), data.hash)}>Previous decisions</button><button className={button} disabled={busy || data.offset + 20 >= data.count} onClick={() => void load(data.offset + 20, data.hash)}>Next decisions</button></div>}</section>;
}
export function LeadFollowupControls({ lead, controller: c }: {
    lead: RecordLead;
    controller: LeadRecordController;
}) { const [chosen, setChosen] = useState<string[]>([]); const disabled = c.busy || !!c.pending || !c.canManage; return <section aria-label="Lead follow-up choices" className="mb-5 space-y-3 rounded-lg border border-border p-4"><h3 className="font-semibold">Review new follow-up or CRM preparation</h3><FollowupChoices context={c.followup} chosen={chosen} onChange={setChosen} disabled={disabled}/><div className="flex flex-wrap gap-2"><button className={button} disabled={disabled || chosen.length === 0 || ['leased', 'lost'].includes(lead.status)} onClick={() => void c.execute({ operation: 'start_followup', leadId: lead.id, revision: lead.record_revision, workflowIds: [...chosen].sort(), workflowHash: c.followup?.hash })}>Start selected follow-up</button><button className={button} disabled={disabled} onClick={() => void c.execute({ operation: 'prepare_crm', leadId: lead.id, revision: lead.record_revision })}>Prepare CRM review</button><button className={button} disabled={c.busy} onClick={() => void c.refreshContext()}>Refresh follow-up choices</button></div><p className="text-xs text-muted-foreground">Reported leased or lost status stops future follow-up. Correcting that status does not restart it. A delivery already underway may finish.</p></section>; }
