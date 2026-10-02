'use client';
import { useState } from 'react';
import type { AuditDecisionController, AuditQuery, AuditContext } from '@/utils/propertyaudit/use-audit-decisions';
import { auditQueryFields, type AuditQueryFields } from '@/utils/propertyaudit/decision-contracts';
import { generateAuditQueryProposal } from '@/utils/propertyaudit/query-proposal';
import type { PropertyAuditSeedKeyword } from '@/utils/propertyaudit/seed-keywords';
import { SeedKeywordUploadModal } from './query/SeedKeywordUploadModal';
import { AuditPageButtons, useAuditPage, auditButton, auditField } from './AuditDecisionHistory';
const blank: AuditQueryFields = { text: '', type: 'branded', geo: '', weight: 1, runCount: 1, isActive: true };
const fields = (q: AuditQuery): AuditQueryFields => ({ text: q.text, type: q.type, geo: q.geo || '', weight: q.weight ?? 1, runCount: q.run_count ?? 1, isActive: q.is_active === true });
export function AuditQueryManager({ controller: c }: {
    controller: AuditDecisionController;
}) {
    const [search, setSearch] = useState(''), [archive, setArchive] = useState('current'), [selected, setSelected] = useState<AuditQuery[]>([]), [reason, setReason] = useState(''), [edit, setEdit] = useState<{
        query: AuditQuery | null;
        source: AuditContext;
        fields: AuditQueryFields;
    } | null>(null), [seedOpen, setSeedOpen] = useState(false), [error, setError] = useState(''), [proposal, setProposal] = useState<{
        source: AuditContext;
        queries: AuditQueryFields[];
        seeds: PropertyAuditSeedKeyword[];
    } | null>(null);
    const page = useAuditPage(c, 'queries', { search, archive }), disabled = c.busy || !!c.pending || !c.canManage || !c.context || page.busy || !!page.error;
    function generate(seeds: PropertyAuditSeedKeyword[] = []) {
        if (!c.context)
            return;
        setError('');
        const rows = generateAuditQueryProposal(c.context, seeds).map(q => ({ text: q.text, type: q.type, geo: q.geo || '', weight: q.weight ?? 1, runCount: q.run_count ?? 1, isActive: q.is_active === true }));
        setProposal({ source: c.context, queries: rows, seeds });
    }
    async function save() {
        if (!edit)
            return;
        setError('');
        const parsed = auditQueryFields.safeParse(edit.fields);
        if (!parsed.success) {
            setError('Review the question, location, weight and repeat count.');
            return;
        }
        const r = await c.execute(edit.query ? { operation: 'query_edit', selection: [{ id: edit.query.id, revision: edit.query.decision_revision }], fields: parsed.data, reason } : { operation: 'query_create', sourceKind: 'manual', sourceHash: edit.source.hash, sourceEvidence: {}, queries: [parsed.data] });
        if (r)
            setEdit(null);
    }
    async function selectionDecision() {
        const r = await c.execute({ operation: archive === 'archived' ? 'query_restore' : 'query_archive', selection: selected.map(q => ({ id: q.id, revision: q.decision_revision })), reason });
        if (r)
            setSelected([]);
    }
    async function accept() {
        if (!proposal)
            return;
        const parsed = proposal.queries.map(q => auditQueryFields.safeParse(q));
        if (parsed.some(q => !q.success)) {
            setError('Every proposed question needs valid text and settings.');
            return;
        }
        const r = await c.execute({ operation: 'query_create', queries: proposal.queries, sourceKind: proposal.seeds.length ? 'keyword_intake' : 'property_templates', sourceHash: proposal.source.hash, sourceEvidence: { seeds: proposal.seeds, templateVersion: 'property-templates-v1' } });
        if (r)
            setProposal(null);
    }
    return <section aria-label="Audit question management" className="space-y-4 rounded-xl border border-border bg-background p-4"><h3 className="font-semibold">Questions for future audits</h3><p className="text-sm text-muted-foreground">Review wording and activation here. Earlier runs keep the questions they actually used. Archived questions retain their evidence and restore as inactive.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex flex-wrap gap-2"><button className={auditButton} disabled={disabled} onClick={() => {
            if (c.context)
                setEdit({ query: null, source: c.context, fields: { ...blank } });
        }}>Add audit question</button><button className={auditButton} disabled={disabled} onClick={() => generate()}>Prepare property questions</button><button className={auditButton} disabled={disabled} onClick={() => setSeedOpen(true)}>Prepare from seed CSV</button><button className={auditButton} disabled={c.busy} onClick={() => { void c.refresh(); void page.load(); setSelected([]); }}>Refresh questions</button></div>
 <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Find audit questions<input className={auditField} maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setSelected([]); }}/></label><label className="text-sm">Question inventory<select className={auditField} value={archive} onChange={e => { setArchive(e.target.value); setSelected([]); }}><option value="current">Current, including inactive</option><option value="archived">Archived</option></select></label></div>{page.error && <p role="alert" className="text-sm text-red-700">{page.error}</p>}
 <ul className="space-y-2">{(page.data?.items as unknown as AuditQuery[] || []).map(q => <li key={q.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"><input aria-label={`Select ${q.text}`} type="checkbox" disabled={disabled} checked={selected.some(s => s.id === q.id)} onChange={e => setSelected(old => e.target.checked ? [...old.filter(s => s.id !== q.id), q] : old.filter(s => s.id !== q.id))}/><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words">{q.text}</p><p className="mt-1 text-xs text-muted-foreground">{q.type.replaceAll('_', ' ')} · {q.archived_at ? 'Archived' : q.is_active ? 'Active' : 'Inactive'} · weight {q.weight ?? 1} · {q.geo || 'No location specified'}</p></div>{!q.archived_at && <button className={auditButton} disabled={disabled} onClick={() => {
                    if (c.context)
                        setEdit({ query: q, source: c.context, fields: fields(q) });
                }}>Edit question</button>}</li>)}</ul><AuditPageButtons page={page} label="questions"/>
 <label className="block text-sm">Question decision reason<textarea className={auditField} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}/></label>{selected.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{selected.length} selected</span><button className={auditButton} disabled={disabled || selected.length > 100} onClick={() => void selectionDecision()}>{archive === 'archived' ? 'Restore selected as inactive' : 'Archive selected questions'}</button><button className={auditButton} onClick={() => setSelected([])}>Clear selection</button></div>}
 {edit && <form aria-label="Audit question form" className="space-y-3 rounded-lg border border-border p-4" onSubmit={e => { e.preventDefault(); void save(); }}><h4 className="font-medium">{edit.query ? 'Edit captured question version' : 'New question'}</h4><label className="block text-sm">Question text<textarea required className={auditField} maxLength={2000} value={edit.fields.text} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, text: e.target.value } })}/></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Question type<select className={auditField} value={edit.fields.type} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, type: e.target.value as AuditQueryFields['type'] } })}>{['branded', 'category', 'comparison', 'local', 'faq', 'voice_search'].map(t => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></label><label className="text-sm">Location<input className={auditField} maxLength={300} value={edit.fields.geo} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, geo: e.target.value } })}/></label><label className="text-sm">Question weight<input type="number" min={0.5} max={2} step={0.1} className={auditField} value={edit.fields.weight} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, weight: Number(e.target.value) } })}/></label><label className="text-sm">Default repeats<input type="number" min={1} max={5} step={1} className={auditField} value={edit.fields.runCount} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, runCount: Number(e.target.value) } })}/></label></div><label className="flex gap-2 text-sm"><input type="checkbox" checked={edit.fields.isActive} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, isActive: e.target.checked } })}/>Active for future runs</label><p className="text-xs text-muted-foreground">The reviewed run repeat count applies to all its selected questions.</p><div className="flex gap-2"><button className={auditButton} type="submit" disabled={disabled}>Save question decision</button><button type="button" className={auditButton} disabled={c.busy} onClick={() => setEdit(null)}>Close question draft</button></div></form>}
 {proposal && <section aria-label="Proposed audit questions" className="space-y-3 rounded-lg border border-border p-4"><h4 className="font-medium">Review {proposal.queries.length} proposed questions</h4><p className="text-sm text-muted-foreground">Prepared from the saved property, brand, competitor names and {proposal.seeds.length} seed keywords. Edit or remove suggestions before saving. Existing questions remain; duplicate wording is held for review.</p><ol className="max-h-96 space-y-3 overflow-y-auto">{proposal.queries.map((q, i) => <li key={i} className="rounded border border-border p-3"><label className="block text-sm">Proposed question {i + 1}<textarea className={auditField} maxLength={2000} value={q.text} onChange={e => setProposal({ ...proposal, queries: proposal.queries.map((v, n) => n === i ? { ...v, text: e.target.value } : v) })}/></label><p className="text-xs text-muted-foreground">{q.type} · {q.geo} · weight {q.weight}</p><label className="mr-3 text-sm"><input type="checkbox" checked={q.isActive} onChange={e => setProposal({ ...proposal, queries: proposal.queries.map((v, n) => n === i ? { ...v, isActive: e.target.checked } : v) })}/> Activate</label><button className={auditButton} onClick={() => setProposal({ ...proposal, queries: proposal.queries.filter((_, n) => n !== i) })}>Remove suggestion {i + 1}</button></li>)}</ol><div className="flex gap-2"><button className={auditButton} disabled={disabled || proposal.queries.length === 0 || proposal.queries.length > 100} onClick={() => void accept()}>Save reviewed question set</button><button className={auditButton} disabled={c.busy} onClick={() => setProposal(null)}>Discard proposal</button></div></section>}
 <SeedKeywordUploadModal isOpen={seedOpen} onClose={() => setSeedOpen(false)} onGenerate={async (seeds) => generate(seeds)} isGenerating={false} propertyName={c.context?.property.name}/></section>;
}
