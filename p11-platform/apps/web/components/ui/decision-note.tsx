import type { ReactNode } from 'react'
import { hasDecisionNote } from '@/utils/actions/decision-note'

/** Optional context stays out of the primary action flow. */
export function DecisionNote({ children, summary = 'Add a note (optional)' }: { children: ReactNode; summary?: string }) {
  return <details className="text-sm">
    <summary className="cursor-pointer text-muted-foreground">{summary}</summary>
    <div className="mt-2">{children}</div>
  </details>
}

export function HistoryNote({ value }: { value: unknown }) {
  return hasDecisionNote(value) ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value}</p> : null
}
