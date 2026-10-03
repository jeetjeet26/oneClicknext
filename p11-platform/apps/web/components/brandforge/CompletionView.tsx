'use client'

import Link from 'next/link'
import {AssistantFactsWorkbench}from '@/components/community/AssistantFactsWorkbench'
import { brandRequest, brandResponse } from '@/utils/brandforge/client-requests'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Download, Eye, FileText, Loader2 } from 'lucide-react'
import type { BrandForgeCompletionResult } from './types'

interface CompletionViewProps {
  propertyId: string
  brandAssetId: string
  completionResult: BrandForgeCompletionResult | null
  onReview?: () => void
}

export function CompletionView({
  propertyId,
  brandAssetId,
  completionResult,
  onReview,
}: CompletionViewProps) {
  const requestMemory = useRef(new Map<string, { identity: string; requestId: string }>())
  const [revision, setRevision] = useState<number | null>(completionResult?.revision ?? null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(completionResult?.pdfUrl ?? null)
  const [exportError, setExportError] = useState<string | null>(completionResult?.exportError ?? null)
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string; action: string }>>([])
  const [isRetryingExport, setIsRetryingExport] = useState(false)
  const [reviewFacts,setReviewFacts]=useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [embedMessage, setEmbedMessage] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/brandforge/status?propertyId=${propertyId}`)
      if (!res.ok) throw new Error('Saved brand status could not be loaded')
      const data = await res.json()
      const statusAsset = data?.brandAsset
      setRevision(statusAsset?.revision ?? null)
      setPdfUrl(statusAsset?.exportUrl ?? null)

      if (statusAsset?.exportUrl) {
        setPdfUrl(statusAsset.exportUrl)
        setExportError(null)
      }

      if (Array.isArray(statusAsset?.warnings)) {
        setWarnings(
          statusAsset.warnings.map((warning: { code?: string; message?: string; action?: string }) => ({
            code: warning.code || 'warning',
            message: warning.message || 'BrandForge needs attention.',
            action: warning.action || 'Review the brand-book status and retry the failed step.',
          }))
        )
      }
    } catch (error) {
      console.error('Failed to refresh BrandForge status:', error)
    }
  }, [propertyId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  async function reviseBrand() {
    if (!revision || isRetryingExport) return
    setIsRetryingExport(true); setExportError(null)
    try {
      const response = await fetch('/api/brandforge/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: brandRequest(requestMemory, 'revise', { brandAssetId, revision, step: 1 }) })
      await brandResponse(response, requestMemory, 'revise')
      onReview?.()
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Revision could not be started') }
    finally { setIsRetryingExport(false) }
  }

  async function retryExport() {
    if (isRetryingExport || !revision) return
    setIsRetryingExport(true)
    setExportError(null)

    try {
      const response = await fetch('/api/brandforge/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'export', { brandAssetId, revision }),
      })

      const data = await brandResponse(response, requestMemory, 'export')
      setPdfUrl(typeof data?.pdfUrl === 'string' ? data.pdfUrl : null)
      setExportError(null)
      await refreshStatus()
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to generate brand-book export')
    } finally {
      setIsRetryingExport(false)
    }
  }

  async function embedToKnowledgeBase() {
    if (!revision || isEmbedding) return
    setIsEmbedding(true)
    setEmbedMessage(null)

    try {
      const response = await fetch('/api/brandforge/embed-to-kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'publish', { brandAssetId, propertyId, revision }),
      })

      const data = await brandResponse(response, requestMemory, 'publish')
      setEmbedMessage(
        `Brand knowledge published (${data.embeddedChunks ?? 0} sections). Review and publish assistant facts below to use this version in Luma.`
      )
    } catch (error) {
      setEmbedMessage(error instanceof Error ? error.message : 'Failed to add brand book to the knowledge base')
    } finally {
      setIsEmbedding(false)
    }
  }

  const isExportReady = Boolean(pdfUrl)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-8 text-center">
      <Link className="mb-4 inline-block rounded-lg border px-3 py-2 text-sm" href={`/dashboard/brandforge/${propertyId}/assets`}>Review brand assets</Link>
      <div className="mb-6">
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
            isExportReady ? 'bg-green-100' : 'bg-amber-100'
          }`}
        >
          {isExportReady ? (
            <CheckCircle className="w-12 h-12 text-green-600" />
          ) : (
            <AlertCircle className="w-12 h-12 text-amber-600" />
          )}
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          {isExportReady ? 'Brand Book Complete!' : 'Brand Book Sections Complete'}
        </h2>
        <p className="text-slate-600">
          {isExportReady
            ? 'Your brand-book export is ready. You can download it now or add it to the knowledge base for other products.'
            : 'All 12 sections are approved. The final export still needs attention before download.'}
        </p>
      </div>

      {exportError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
          <p className="font-medium">Export needs attention</p>
          <p className="mt-1">{exportError}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-4 space-y-2 text-left">
          {warnings.map((warning) => (
            <div
              key={warning.code}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
            >
              <p>{warning.message}</p>
              <p className="mt-1 text-slate-500">{warning.action}</p>
            </div>
          ))}
        </div>
      )}

      {embedMessage && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {embedMessage}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-left text-sm text-indigo-950">
        <p className="font-medium">Bring published brand knowledge into Luma</p>
        <p className="mt-1">Publishing brand knowledge updates the source. Review the complete assistant-facts draft and publish it explicitly before Luma uses the new version.</p>
        <button type="button" onClick={()=>setReviewFacts(v=>!v)}className="mt-3 rounded-lg border border-indigo-300 px-4 py-2">{reviewFacts?'Hide assistant facts review':'Review assistant facts'}</button>
        {reviewFacts&&<div className="mt-4"><AssistantFactsWorkbench key={propertyId}propertyId={propertyId}/></div>}
      </div>
      <div className="flex flex-wrap gap-4 justify-center">
        {onReview && <button type="button" disabled={!revision || isRetryingExport} onClick={() => void reviseBrand()} className="px-6 py-2 border border-slate-300 rounded-lg disabled:opacity-50">Revise brand</button>}
        <a
          href={`/dashboard/brandforge/${propertyId}`}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
        >
          <Eye className="w-4 h-4" />
          View Brand Book
        </a>
        {isExportReady ? (
          <a
            href={pdfUrl ?? '#'}
            download
            className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download Brand Export
          </a>
        ) : (
          <button
            onClick={retryExport}
            disabled={isRetryingExport || !revision}
            className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            {isRetryingExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Retry Export
          </button>
        )}
        <button
          onClick={embedToKnowledgeBase}
          disabled={isEmbedding || !revision}
          className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
        >
          {isEmbedding ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Add to Knowledge Base
        </button>
      </div>
    </div>
  )
}























