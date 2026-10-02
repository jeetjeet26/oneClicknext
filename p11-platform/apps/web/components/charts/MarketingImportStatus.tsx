'use client'

import Link from 'next/link'
import { deriveImportJobState } from '@/utils/marketvision/import-job-state'
import type { useMarketingImport } from '@/utils/marketvision/use-marketing-import'

export function MarketingImportStatus({ tracker }: { tracker: ReturnType<typeof useMarketingImport> }) {
  if (!tracker.savedRequest) return null
  const { job } = tracker
  const state = job ? deriveImportJobState(job) : null
  const labels = { pending: 'Import queued', running: 'Import running', complete: 'Import completed', partial: 'Import partially completed', failed: 'Import failed', unknown: 'Import status unknown' }
  const progress = typeof job?.progress_pct === 'number' ? Math.max(0, Math.min(100, job.progress_pct)) : null
  const terminal = state && ['complete', 'partial', 'failed'].includes(state)
  return <section aria-label="Marketing import status" className="rounded-lg border border-border bg-card p-4 text-card-foreground">
    <h2 className="font-semibold" aria-live="polite">{state ? labels[state] : tracker.busy ? 'Recording import request' : 'Import acceptance unconfirmed'}</h2>
    {tracker.notice && <p role="alert" className="mt-2 text-sm text-amber-800 dark:text-amber-200">{tracker.notice}</p>}
    {job && <>
      <p className="mt-2 text-sm">Confirmed imported records: {job.records_imported ?? 'Not recorded'}</p>
      {job.current_step && <p className="mt-1 text-sm text-muted-foreground">Last recorded step: {job.current_step}</p>}
      {job.error_message && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{job.error_message}</p>}
      {state === 'running' && progress !== null && <div className="mt-3"><label htmlFor="marketing-import-progress" className="text-xs">Recorded progress: {progress}%</label><progress id="marketing-import-progress" max={100} value={progress} className="mt-1 block h-2 w-full accent-indigo-600" /></div>}
    </>}
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      <button onClick={tracker.refresh} disabled={tracker.busy} className="rounded border border-border px-3 py-2 disabled:opacity-50">Refresh import status</button>
      {!terminal && tracker.notice && <button onClick={tracker.retry} disabled={tracker.busy} className="rounded border border-border px-3 py-2 disabled:opacity-50">Retry same request</button>}
      {terminal && <button onClick={tracker.dismiss} className="rounded border border-border px-3 py-2">Dismiss result</button>}
      <Link href="/dashboard/pipelines" className="px-1 py-2 text-indigo-700 underline dark:text-indigo-300">View import history</Link>
    </div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Tracking details</summary><p className="mt-2 break-all">Request ID: {tracker.savedRequest.job_id}</p><p>Retrying this request checks or resumes this same queued job; it does not replay an already running or finished job.</p></details>
  </section>
}
