'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tables } from '@/types/supabase'
import { deriveImportJobState } from './import-job-state'
import { IMPORT_UUID, parseImportRequest, type MarketingImportRequest } from './import-request'

export type TrackedImportJob = Pick<Tables<'import_jobs'>, 'id' | 'property_id' | 'status' | 'progress_pct' | 'current_step' | 'records_imported' | 'campaigns_found' | 'error_message'>
const isTerminal = (job: TrackedImportJob | null) => job && ['complete', 'partial', 'failed'].includes(deriveImportJobState(job))

// Mount within a property-keyed view: all requests and timers are cancelled when
// that property is left, while its request identity survives in session storage.
export function useMarketingImport(propertyId: string, onComplete: () => void) {
  const [savedRequest, setSavedRequest] = useState<MarketingImportRequest | null>(null)
  const [job, setJob] = useState<TrackedImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const saved = useRef<MarketingImportRequest | null>(null)
  const controller = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposed = useRef(false)
  const deadline = useRef(0)
  const completion = useRef('')
  const completeCallback = useRef(onComplete)
  const pollCallback = useRef<() => Promise<void>>(async () => {})
  const storageKey = `p11-marketing-import:${propertyId}`

  useEffect(() => { completeCallback.current = onComplete }, [onComplete])

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const receiveJob = useCallback((value: TrackedImportJob) => {
    if (value.id !== saved.current?.job_id || value.property_id !== propertyId) throw new Error('Import status did not match this property and request.')
    setJob(value)
    setNotice(null)
    clearTimer()
    const state = deriveImportJobState(value)
    if (isTerminal(value)) {
      if (['complete', 'partial'].includes(state) && completion.current !== `${value.id}:${state}`) {
        completion.current = `${value.id}:${state}`
        completeCallback.current()
      }
    } else if (state === 'unknown') {
      setNotice('The recorded status is unknown. Review this job before starting another import.')
    } else if (Date.now() >= deadline.current) {
      setNotice('Completion has not been confirmed. Tracking is saved; refresh status to check again before starting another import.')
    } else {
      timer.current = setTimeout(() => void pollCallback.current(), 3_000)
    }
  }, [propertyId, clearTimer])

  const poll = useCallback(async () => {
    if (!saved.current || disposed.current) return
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    try {
      const response = await fetch(`/api/marketvision/import?job_id=${saved.current.job_id}&property_id=${propertyId}`, { signal: AbortSignal.any([active.signal, AbortSignal.timeout(25_000)]), cache: 'no-store' })
      const result = await response.json()
      if (!response.ok || !result.job) throw new Error(response.status === 404 ? 'No saved job was found yet. Retry this same request to confirm acceptance.' : 'Import status is unavailable. Tracking is saved; refresh status before retrying.')
      if (!active.signal.aborted && !disposed.current) receiveJob(result.job)
    } catch (error) {
      if (!active.signal.aborted && !disposed.current) {
        clearTimer()
        setNotice(error instanceof Error ? error.message : 'Import status is unavailable.')
      }
    } finally { if (!active.signal.aborted && !disposed.current) setBusy(false) }
  }, [propertyId, receiveJob, clearTimer])

  useEffect(() => { pollCallback.current = poll }, [poll])
  useEffect(() => {
    disposed.current = false
    deadline.current = Date.now() + 300_000
    try {
      const value = sessionStorage.getItem(storageKey)
      const restored = value ? parseImportRequest(JSON.parse(value)) : null
      if (restored?.property_id === propertyId && restored.job_id && IMPORT_UUID.test(restored.job_id)) {
        saved.current = restored as MarketingImportRequest
        setSavedRequest(saved.current)
        void pollCallback.current()
      }
    } catch { /* Invalid or unavailable local storage does not authorize a new request. */ }
    return () => { disposed.current = true; clearTimer(); controller.current?.abort() }
  }, [propertyId, storageKey, clearTimer])

  const submit = useCallback(async (request: MarketingImportRequest) => {
    clearTimer()
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    saved.current = request
    setSavedRequest(request)
    setJob(null)
    setNotice(null)
    setBusy(true)
    deadline.current = Date.now() + 300_000
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)) } catch { /* Server job history remains authoritative. */ }
    try {
      const response = await fetch('/api/marketvision/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.any([active.signal, AbortSignal.timeout(25_000)]),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Import acceptance could not be confirmed. Check status before retrying this same request.')
      if (result.job_id !== request.job_id || !result.job) throw new Error('A saved import job was not confirmed. Check status before retrying this same request.')
      if (!active.signal.aborted && !disposed.current) receiveJob(result.job)
    } catch (error) {
      if (!active.signal.aborted && !disposed.current) setNotice(error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : 'Import acceptance could not be confirmed. Check status before retrying this same request.')
    } finally { if (!active.signal.aborted && !disposed.current) setBusy(false) }
  }, [storageKey, clearTimer, receiveJob])

  const start = () => {
    if (busy || (saved.current && (!isTerminal(job) || saved.current.job_id !== job?.id))) return
    void submit({ property_id: propertyId, job_id: crypto.randomUUID(), channels: ['google_ads', 'meta_ads'], date_range: 'LAST_30_DAYS' })
  }
  const retry = () => { if (saved.current && !busy) void submit(saved.current) }
  const refresh = () => { deadline.current = Date.now() + 300_000; clearTimer(); void poll() }
  const dismiss = () => {
    if (!isTerminal(job)) return
    clearTimer()
    saved.current = null
    setSavedRequest(null)
    setJob(null)
    setNotice(null)
    try { sessionStorage.removeItem(storageKey) } catch { /* Optional local persistence. */ }
  }
  return { job, savedRequest, busy, notice, start, retry, refresh, dismiss, importing: Boolean(savedRequest && !isTerminal(job)) }
}
