'use client'

import type {TourCorrection} from '@/utils/services/tour-outcomes'
import {useEffect, useId, useRef, useState} from 'react'

export type SavedTourOutcome = {
  tour: {id: string; status: 'completed' | 'no_show'; outcome_notes?: string | null; correction?: TourCorrection | null}
  followup: 'configured' | 'not_configured' | 'suppressed' | 'legacy'
  correction?: TourCorrection
  leadStatus?: string
}

export function TourOutcomeForm({leadId, tourId, onSaved, correction = false}: {
  leadId: string; tourId: string; correction?: boolean; onSaved: (result: SavedTourOutcome) => void
}) {
  const outcomeId = useId()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<'completed' | 'no_show'>('completed')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const outcomeRequest = useRef<{id:string;outcome:string;notes:string}|null>(null)
  const correctionRequest = useRef<{id: string; reason: string} | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setSaving(true); setError(null)
    try {
      const reason = notes.trim()
      if (!correction && (outcomeRequest.current?.outcome!==outcome || outcomeRequest.current?.notes!==notes)) outcomeRequest.current={id:crypto.randomUUID(),outcome,notes}
      if (correction && correctionRequest.current?.reason !== reason) correctionRequest.current = {id: crypto.randomUUID(), reason}
      const response = await fetch(correction ? '/api/tours/correct' : `/api/leads/${leadId}/tours`, {
        method: correction ? 'POST' : 'PATCH', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(correction ? {tourId, requestId: correctionRequest.current!.id, reason} : {tourId, status: outcome, notes,requestId:outcomeRequest.current!.id}), signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The tour outcome could not be saved. Please retry.')
      if (result.tour?.id !== tourId || result.tour?.status !== (correction ? 'completed' : outcome)) throw new Error('The saved outcome could not be confirmed. Retry to check it safely.')
      if (!controller.signal.aborted) onSaved(result)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'The result is unconfirmed. Retry to check the same request safely.')
    } finally {
      if (!controller.signal.aborted) {setSaving(false); request.current = null}
    }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">{correction ? 'Correct no-show' : 'Record outcome'}</button>
  return <form onSubmit={save} aria-label={correction ? "Correct tour no-show" : "Record tour outcome"} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
    {correction ? <p className="text-sm font-medium text-slate-800">Confirm this tour was completed</p> : <>
    <label htmlFor={outcomeId} className="block text-sm text-slate-700">Tour outcome</label>
      <select id={outcomeId} value={outcome} disabled={saving} onChange={event => setOutcome(event.target.value as 'completed' | 'no_show')} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">
        <option value="completed">Completed</option><option value="no_show">No-show</option>
      </select>
    </>}
    <label className="block text-sm text-slate-700">{correction ? 'Reason for correction' : 'Outcome notes (optional)'}
      <textarea required={correction} value={notes} disabled={saving} maxLength={2000} onChange={event => setNotes(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" />
    </label>
    <p className="text-xs text-slate-500">{correction ? 'Saving reverses this tour’s no-show score penalty, stops queued no-show follow-ups and preserves the original history.' : 'Record what happened after the scheduled tour. Configured follow-ups are queued after saving.'}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={saving || (correction && !notes.trim())} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : correction ? 'Save correction' : 'Save outcome'}</button>
      <button type="button" disabled={saving} onClick={() => {setOpen(false); setError(null)}} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">Close</button>
    </div>
  </form>
}
