'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Bot, Check, CheckCircle2, Clock, Copy, Edit3, FileText, Maximize2, RefreshCw, X } from 'lucide-react'
import {
  presentChatbotContext,
  presentRevisionIdentity,
  type ChatbotContextRecord,
  type ChatbotContextRevisionRecord,
} from './knowledge-presentation'

type ChatbotContext = ChatbotContextRecord & {
  last_generated_at: string | null
  last_change_summary: string | null
  error_message: string | null
  context_markdown: string
  model?: string | null
  updated_at?: string | null
}

type Revision = ChatbotContextRevisionRecord & {
  change_summary: string | null
  created_at: string
}

type ChatbotContextStatusCardProps = {
  propertyId: string
}

function getStatusLabel(context: ChatbotContext | null): { label: string; className: string; icon: typeof Clock } {
  if (!context) {
    return { label: 'Not generated', className: 'bg-slate-100 text-slate-700', icon: Clock }
  }

  if (context.error_message || context.status === 'failed') {
    return { label: 'Failed', className: 'bg-red-100 text-red-700', icon: AlertCircle }
  }

  if (context.requires_review || context.status === 'needs_review') {
    return { label: 'Needs review', className: 'bg-amber-100 text-amber-700', icon: AlertCircle }
  }

  if (context.status === 'stale') {
    return { label: 'Stale', className: 'bg-orange-100 text-orange-700', icon: Clock }
  }

  if (context.status === 'generating') {
    return { label: 'Regenerating', className: 'bg-indigo-100 text-indigo-700', icon: RefreshCw }
  }

  return { label: 'Current', className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 }
}

export function ChatbotContextStatusCard({ propertyId }: ChatbotContextStatusCardProps) {
  const [context, setContext] = useState<ChatbotContext | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFullPrompt, setShowFullPrompt] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')

  const loadContext = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/chatbot-context?propertyId=${propertyId}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load chatbot context')
      }
      setContext(data.context ?? null)
      setRevisions(data.revisions ?? [])
      setEditing(false)
      setDraftPrompt(data.context?.context_markdown ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chatbot context')
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    loadContext()
  }, [loadContext])

  const regenerate = async () => {
    setRegenerating(true)
    setError(null)
    try {
      const response = await fetch('/api/chatbot-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to regenerate chatbot context')
      }
      await loadContext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate chatbot context')
    } finally {
      setRegenerating(false)
    }
  }

  const startEditing = () => {
    setDraftPrompt(context?.context_markdown ?? '')
    setEditing(true)
    setError(null)
  }

  const cancelEditing = () => {
    setDraftPrompt(context?.context_markdown ?? '')
    setEditing(false)
    setError(null)
  }

  const savePrompt = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/chatbot-context', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, contextMarkdown: draftPrompt }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save chatbot context')
      }
      await loadContext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save chatbot context')
    } finally {
      setSaving(false)
    }
  }

  const status = getStatusLabel(context)
  const StatusIcon = status.icon
  const contextPresentation = presentChatbotContext(context)
  const systemPrompt = context?.context_markdown
    ? context.context_markdown
    : 'No generated chatbot context exists yet. Regenerate to build one from active property setup, uploads, pricing, and website sources.'

  const copyPrompt = async () => {
    if (!systemPrompt) return
    await navigator.clipboard.writeText(systemPrompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section
      className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm"
      aria-labelledby="chatbot-context-heading"
      aria-busy={loading}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="chatbot-context-heading" className="font-semibold text-slate-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-500" />
            Chatbot Context
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Luma answers from this generated client context. Vector RAG is preserved but no longer used for chatbot replies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
            <StatusIcon
              className={`h-3.5 w-3.5 ${context?.status === 'generating' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {status.label}
          </span>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            aria-label={regenerating ? 'Regenerating chatbot context' : 'Regenerate chatbot context'}
          >
            <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {contextPresentation.availabilityExplanation && (
        <p className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-800">
          {contextPresentation.availabilityExplanation}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Context state</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {contextPresentation.lifecycleLabel}
          </p>
          {context?.stale_at && contextPresentation.lifecycleLabel === 'Stale' && (
            <p className="mt-1 text-xs text-slate-500">
              Since <time dateTime={context.stale_at}>{new Date(context.stale_at).toLocaleString()}</time>
            </p>
          )}
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Review state</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {contextPresentation.reviewLabel}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last generated</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {context?.last_generated_at ? new Date(context.last_generated_at).toLocaleString() : 'Never'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Revision history</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {revisions.length} recent revision{revisions.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {context && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <h4 className="text-sm font-medium text-slate-800">Context identity and sources</h4>
          <dl className="mt-2 space-y-2 text-xs text-slate-600">
            {contextPresentation.identity && (
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="font-medium text-slate-700">Context:</dt>
                <dd className="break-all font-mono">{contextPresentation.identity}</dd>
              </div>
            )}
            {contextPresentation.documentCount !== null && (
              <div className="flex gap-2">
                <dt className="font-medium text-slate-700">Context document records:</dt>
                <dd>{contextPresentation.documentCount}</dd>
              </div>
            )}
            {context.model && (
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="font-medium text-slate-700">Generator:</dt>
                <dd className="break-all font-mono">{context.model}</dd>
              </div>
            )}
          </dl>
          {contextPresentation.sourceIds.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                {contextPresentation.sourceIds.length} source ID{contextPresentation.sourceIds.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-1" aria-label="Chatbot context source IDs">
                {contextPresentation.sourceIds.map(sourceId => (
                  <li key={sourceId} className="break-all font-mono text-xs text-slate-600">{sourceId}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No knowledge source IDs are recorded for this context.</p>
          )}
        </div>
      )}

      {revisions.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <h4 className="text-sm font-medium text-slate-800">Recent revision identities</h4>
          <ol className="mt-3 space-y-3" aria-label="Recent chatbot context revisions">
            {revisions.map(revision => {
              const identity = presentRevisionIdentity(revision)
              return (
                <li key={revision.id} className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <code className="break-all text-slate-800">{identity.id}</code>
                    <time dateTime={revision.created_at}>{new Date(revision.created_at).toLocaleString()}</time>
                  </div>
                  {revision.change_summary && <p className="mt-1 text-slate-700">{revision.change_summary}</p>}
                  {identity.model && <p className="mt-1">Generator: <code>{identity.model}</code></p>}
                  {identity.changedSourceIds.length > 0 && (
                    <p className="mt-1 break-all">Changed sources: <code>{identity.changedSourceIds.join(', ')}</code></p>
                  )}
                  {identity.removedSourceIds.length > 0 && (
                    <p className="mt-1 break-all">Removed sources: <code>{identity.removedSourceIds.join(', ')}</code></p>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {context?.last_change_summary && (
        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest change</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{context.last_change_summary}</p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <FileText className="h-4 w-4" />
            Full system prompt
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startEditing}
              disabled={loading || !context?.context_markdown || editing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={copyPrompt}
              disabled={loading || !context?.context_markdown}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setShowFullPrompt(true)}
              disabled={loading || !context?.context_markdown}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Expand
            </button>
          </div>
        </div>
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draftPrompt}
              onChange={(event) => setDraftPrompt(event.target.value)}
              className="min-h-[520px] w-full resize-y rounded-md border border-slate-200 bg-white p-4 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              aria-label="Edit chatbot context"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Regenerate will overwrite manual text with a fresh generated context.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={saving || !draftPrompt.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-white p-4 font-mono text-xs leading-5 text-slate-700">
            {loading ? 'Loading chatbot context...' : systemPrompt}
          </pre>
        )}
      </div>

      {showFullPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-system-prompt-heading"
        >
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h3 id="full-system-prompt-heading" className="font-semibold text-slate-900">Full System Prompt</h3>
                <p className="text-sm text-slate-500">
                  This is the generated property-specific context used by Luma for this property.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFullPrompt(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close full system prompt"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto p-4">
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
                {systemPrompt}
              </pre>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
