'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Bot, Check, CheckCircle2, Clock, Copy, Edit3, FileText, Maximize2, RefreshCw, X } from 'lucide-react'

type ChatbotContext = {
  status: string
  requires_review: boolean
  last_generated_at: string | null
  stale_at: string | null
  last_change_summary: string | null
  error_message: string | null
  context_markdown: string
}

type Revision = {
  id: string
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
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-500" />
            Chatbot Context
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Luma answers from this generated client context. Vector RAG is preserved but no longer used for chatbot replies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${context?.status === 'generating' ? 'animate-spin' : ''}`} />
            {status.label}
          </span>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last generated</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {context?.last_generated_at ? new Date(context.last_generated_at).toLocaleString() : 'Never'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest change</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {context?.last_change_summary || 'No changes recorded yet'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Revision history</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {revisions.length} recent revision{revisions.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h3 className="font-semibold text-slate-900">Full System Prompt</h3>
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
    </div>
  )
}
