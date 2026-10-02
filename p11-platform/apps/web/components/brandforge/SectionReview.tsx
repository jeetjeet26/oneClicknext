'use client'

import { brandRequest, brandResponse } from '@/utils/brandforge/client-requests'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Edit, Sparkles, Check, AlertCircle } from 'lucide-react'
import type { BrandForgeCompletionResult } from './types'

interface SectionReviewProps {
  brandAssetId: string
  onSectionChange: (section: number) => void
  onComplete: (result: BrandForgeCompletionResult) => void
}

const SECTION_TITLES: Record<string, string> = {
  introduction: 'Introduction & Market Context',
  positioning: 'Positioning Statement',
  target_audience: 'Target Audience',
  personas: 'Resident Personas',
  name_story: 'Brand Name & Story',
  logo: 'Logo Design',
  typography: 'Typography System',
  colors: 'Color Palette',
  design_elements: 'Design Elements',
  photo_yep: 'Photo Guidelines - Yep',
  photo_nope: 'Photo Guidelines - Nope',
  implementation: 'Implementation Examples',
}

function getSectionTitle(step: number, sectionName?: string) {
  if (sectionName && SECTION_TITLES[sectionName]) {
    return SECTION_TITLES[sectionName]
  }

  return (
    {
      1: 'Introduction & Market Context',
      2: 'Positioning Statement',
      3: 'Target Audience',
      4: 'Resident Personas',
      5: 'Brand Name & Story',
      6: 'Logo Design',
      7: 'Typography System',
      8: 'Color Palette',
      9: 'Design Elements',
      10: 'Photo Guidelines - Yep',
      11: 'Photo Guidelines - Nope',
      12: 'Implementation Examples',
    }[step] || 'Brand content'
  )
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json()
    if (typeof body?.details === 'string' && body.details.length > 0) {
      return `${body.error || fallback}: ${body.details}`
    }
    if (typeof body?.error === 'string' && body.error.length > 0) {
      return body.error
    }
  } catch {
    // Ignore parse errors and use fallback.
  }

  return fallback
}

function buildActionableMessage(message: string, step: number) {
  const normalized = message.toLowerCase()

  if (normalized.includes('vertex ai not configured') || normalized.includes('google_application_credentials')) {
    return 'Visual generation is not configured yet. Restore Vertex AI credentials, then retry this section.'
  }

  if (normalized.includes('quota') || normalized.includes('rate limit')) {
    return 'The provider hit a temporary quota or rate limit. Wait a moment, then retry this section.'
  }

  if (normalized.includes('failed to extract json')) {
    return 'The model returned an unusable draft. Retry the section to request a cleaner response.'
  }

  if (step === 6) {
    return 'Logo/image steps rely on external providers. If generation fails, fix provider health or credentials and retry this section.'
  }

  return message
}

function getLoadingHint(step: number, sectionName?: string) {
  if (step === 6 || sectionName === 'logo') {
    return 'Logo generation may take longer and requires healthy image credentials and quota.'
  }

  if (step >= 10 || sectionName === 'photo_yep' || sectionName === 'photo_nope') {
    return 'Visual guidance sections can take a bit longer than text-only sections.'
  }

  return 'You can review, edit, or regenerate each section before approving it.'
}

export function SectionReview({ brandAssetId, onSectionChange, onComplete }: SectionReviewProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [draftSection, setDraftSection] = useState<{ step: number; sectionName: string; version?: number; data: Record<string, unknown> } | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [isEditing, setIsEditing] = useState(false)
  const [editedData, setEditedData] = useState<Record<string, unknown>>({})
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [regenerateHint, setRegenerateHint] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const revisionRef = useRef<number | null>(null)
  const [savedPropertyId, setSavedPropertyId] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<{ id: string; kind: string } | null>(null)
  const requestMemory = useRef(new Map<string, { identity: string; requestId: string }>())
  const busyRef = useRef(false)
  const hasStartedGenerationRef = useRef(false)

  useEffect(() => {
    onSectionChange(currentStep)
  }, [currentStep, onSectionChange])

  useEffect(() => {
    if (hasStartedGenerationRef.current) return
    hasStartedGenerationRef.current = true
    void reloadSavedBrand()
    // The wizard keys this review by brand ID; mounting loads that saved revision once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function rememberRevision(value: number) { revisionRef.current = value; setRevision(value) }
  async function reloadSavedBrand() {
    if (busyRef.current) return
    busyRef.current = true; setIsGenerating(true); setActionError(null)
    try {
      const response = await fetch(`/api/brandforge/revision?brandAssetId=${encodeURIComponent(brandAssetId)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Saved draft could not be loaded'))
      const saved = await response.json()
      rememberRevision(saved.revision); setSavedPropertyId(saved.propertyId)
      setCurrentStep(saved.currentStep || 1)
      setDraftSection(saved.draft ? { ...saved.draft, sectionName: saved.draft.name } : null)
      setPendingRequest(saved.operations.find((item: { state: string }) => item.state === 'running') || null)
      requestMemory.current.clear()
      setIsEditing(false)
      if (saved.isComplete) onComplete({ brandAssetId, pdfUrl: saved.pdfUrl || null, revision: saved.revision })
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Saved draft could not be loaded') }
    finally { busyRef.current = false; setIsGenerating(false) }
  }
  async function stopRequest() {
    if (!pendingRequest || !savedPropertyId || busyRef.current) return
    busyRef.current = true; setIsGenerating(true); setActionError(null)
    try {
      const response = await fetch('/api/brandforge/revision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: savedPropertyId, requestId: pendingRequest.id, decisionId: crypto.randomUUID() }) })
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Request could not be stopped'))
      setPendingRequest(null)
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Request could not be stopped') }
    finally { busyRef.current = false; setIsGenerating(false) }
    await reloadSavedBrand()
  }

  async function generateNextSection() {
    if (busyRef.current || !revisionRef.current || pendingRequest) return
    busyRef.current = true
    setIsGenerating(true)
    setIsEditing(false)
    setEditedData({})
    setActionError(null)
    setActionInfo(null)

    try {
      const res = await fetch('/api/brandforge/generate-next-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'generate', { brandAssetId, revision: revisionRef.current })
      })

      const data = await brandResponse(res, requestMemory, 'generate')
      setDraftSection(data)
      rememberRevision(data.revision)
      setCurrentStep(data.step)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'

      setActionError(message)
    } finally {
      busyRef.current = false
      setIsGenerating(false)
    }
  }

  async function handleRegenerate() {
    if (busyRef.current || !revisionRef.current || pendingRequest) return
    busyRef.current = true
    setIsGenerating(true)
    setShowRegenerateModal(false)
    setActionError(null)
    setActionInfo(null)

    try {
      const res = await fetch('/api/brandforge/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'regenerate', { brandAssetId, revision: revisionRef.current, hint: regenerateHint || undefined })
      })

      const data = await brandResponse(res, requestMemory, 'regenerate')
      setDraftSection(data)
      rememberRevision(data.revision)
      setRegenerateHint('')
    } catch (err) {

      setActionError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      busyRef.current = false
      setIsGenerating(false)
    }
  }

  async function handleEdit() {
    if (!draftSection) return
    if (busyRef.current || !revisionRef.current || pendingRequest) return
    if (!isEditing) {
      setIsEditing(true)
      setEditedData(draftSection.data)
      return
    }

    // Save edits
    busyRef.current = true; setIsGenerating(true)
    try {
      setActionError(null)
      const res = await fetch('/api/brandforge/edit-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'edit', { brandAssetId, revision: revisionRef.current, updates: editedData })
      })

      const data = await brandResponse(res, requestMemory, 'edit')
      setDraftSection(data)
      rememberRevision(data.revision)
      setIsEditing(false)
    } catch (err) {

      setActionError(err instanceof Error ? err.message : 'Edit failed')
    } finally { busyRef.current = false; setIsGenerating(false) }
  }

  async function handleApprove() {
    if (busyRef.current || !revisionRef.current || pendingRequest) return
    busyRef.current = true; setIsGenerating(true)
    try {
      setActionError(null)
      setActionInfo(null)
      const res = await fetch('/api/brandforge/approve-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'approve', { brandAssetId, revision: revisionRef.current })
      })

      const data = await brandResponse(res, requestMemory, 'approve')

      rememberRevision(data.revision)
      if (data.isComplete) {
        // All sections complete - generate PDF
        setIsGenerating(true)
        const pdfRes = await fetch('/api/brandforge/generate-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: brandRequest(requestMemory, 'export', { brandAssetId, revision: data.revision })
        })

        const pdfData = await pdfRes.json().catch(() => ({}))

        if (!pdfRes.ok) {
          if (pdfData.state === 'failed' || pdfData.state === 'cancelled') requestMemory.current.delete('export')
          onComplete({
            brandAssetId,
            revision: data.revision,
            pdfUrl: null,
            exportError: buildActionableMessage(
              typeof pdfData?.error === 'string' ? pdfData.error : 'Final export failed',
              currentStep
            ),
          })
          return
        }

        onComplete({
          brandAssetId,
          revision: pdfData.revision,
          pdfUrl: typeof pdfData?.pdfUrl === 'string' ? pdfData.pdfUrl : null,
          exportError: null,
        })
      } else {
        // Move to next section
        setDraftSection(null)
        setCurrentStep(data.nextStep)
        busyRef.current = false
        await generateNextSection()
      }
    } catch (err) {

      setActionError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      busyRef.current = false
      setIsGenerating(false)
    }
  }

  const savedControls = <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-600">{revision ? `Saved version ${revision}` : 'Load the saved brand to continue.'}</p><button type="button" onClick={() => void reloadSavedBrand()} disabled={isGenerating} className="text-sm font-medium text-indigo-700 disabled:opacity-50">Reload saved brand</button></div>
    {pendingRequest && <div className="text-sm text-amber-900"><p>A {pendingRequest.kind} request is still open. Reload to check for its result, or stop it to prevent a late result from changing this brand.</p><button type="button" onClick={() => void stopRequest()} disabled={isGenerating} className="mt-2 font-medium underline">Stop this request</button></div>}
  </div>

  if (isGenerating && !draftSection) {
    const loadingTitle = getSectionTitle(currentStep)
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Generating Section {currentStep}/12
        </h3>
        <p className="text-slate-600">
          {loadingTitle}
        </p>
        <p className="text-sm text-slate-500 mt-2">
          {getLoadingHint(currentStep)}
        </p>
      </div>
    )
  }

  if (!draftSection) return <div>{savedControls}{actionError && <p role="alert" className="mb-4 text-red-700">{actionError}</p>}<button type="button" onClick={() => void generateNextSection()} disabled={isGenerating || !revision || Boolean(pendingRequest)} className="rounded-lg bg-indigo-600 px-5 py-3 text-white disabled:opacity-50">Generate next section</button></div>

  return (
    <div className="space-y-6">
      {savedControls}
      {/* Section header */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-indigo-600 mb-1">
              Step {currentStep} of 12
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              {getSectionTitle(currentStep, draftSection.sectionName)}
            </h2>
          </div>
          <div className="text-right text-sm text-slate-600">
            Version {draftSection.version || 1}
          </div>
        </div>
      </div>

      {actionInfo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {actionInfo}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Section content */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <RenderSectionContent 
          section={draftSection}
          isEditing={isEditing}
          editedData={editedData}
          onEdit={setEditedData}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={handleEdit}
            disabled={isGenerating || Boolean(pendingRequest)}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
          >
            <Edit className="w-4 h-4" />
            {isEditing ? 'Save Edits' : 'Edit'}
          </button>
          <button
            onClick={() => setShowRegenerateModal(true)}
            disabled={isGenerating || Boolean(pendingRequest)}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Regenerate
          </button>
        </div>
        <button
          onClick={handleApprove}
          disabled={isEditing || isGenerating || Boolean(pendingRequest)}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          {currentStep === 12 ? 'Approve & Finish' : 'Approve & Continue'}
        </button>
      </div>

      {/* Regenerate modal */}
      {showRegenerateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Regenerate Section</h3>
            <p className="text-sm text-slate-600 mb-4">
              Optionally provide feedback to guide the regeneration:
            </p>
            <textarea
              value={regenerateHint}
              onChange={(e) => setRegenerateHint(e.target.value)}
              placeholder="e.g., 'Make it more casual' or 'Use warmer colors'"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowRegenerateModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isGenerating || Boolean(pendingRequest)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RenderSectionContent({ section, isEditing, editedData, onEdit }: { section: { data: Record<string, unknown> }; isEditing: boolean; editedData: Record<string, unknown>; onEdit: (value: Record<string, unknown>) => void }) {
 const data = isEditing ? editedData : section.data
 return <StructuredBrandFields value={data} editing={isEditing} path="brand-section" onChange={value => onEdit(value as Record<string, unknown>)} />
}
const hiddenBrandFields = new Set(['_meta','status','approved_at','approved_by','version','generatedAt','generated_at'])
function StructuredBrandFields({ value, editing, path, onChange }: { value: unknown; editing: boolean; path: string; onChange: (value: unknown) => void }) {
 if (Array.isArray(value)) return <div className="space-y-3">{value.map((item,index) => <div key={index} className="rounded-lg border border-slate-200 p-3"><StructuredBrandFields value={item} editing={editing} path={`${path}-${index}`} onChange={next => onChange(value.map((old,i) => i === index ? next : old))}/>{editing && <button type="button" className="mt-2 text-sm text-red-700" onClick={() => onChange(value.filter((_,i) => i !== index))}>Remove item {index + 1}</button>}</div>)}{editing && <button type="button" className="text-sm font-medium text-indigo-700" onClick={() => onChange([...value, value[0] && typeof value[0] === 'object' && !Array.isArray(value[0]) ? Object.fromEntries(Object.keys(value[0]).filter(key => !hiddenBrandFields.has(key)).map(key => [key, ''])) : ''])}>Add item</button>}</div>
 if (value && typeof value === 'object') return <div className="space-y-4">{Object.entries(value).filter(([key]) => !hiddenBrandFields.has(key)).map(([key,entry]) => <div key={key}><label htmlFor={`${path}-${key}`} className="mb-1 block text-sm font-medium capitalize text-slate-700">{key.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2')}</label><StructuredBrandFields value={entry} editing={editing} path={`${path}-${key}`} onChange={next => onChange({ ...value, [key]: next })}/></div>)}</div>
 if (editing) {
  if (typeof value === 'boolean') return <input id={path} type="checkbox" checked={value} onChange={event => onChange(event.target.checked)}/>
  if (typeof value === 'number') return <input id={path} type="number" value={value} onChange={event => { if (event.target.value !== '') onChange(Number(event.target.value)) }} className="rounded-lg border border-slate-300 p-2"/>
  return <textarea id={path} value={String(value ?? '')} rows={3} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 p-3"/>
 }
 if (typeof value === 'string' && /^https?:\/\//.test(value) && /\.(png|jpg|jpeg|webp)(?:[?#]|$)/i.test(value)) return <a href={value} target="_blank" rel="noopener noreferrer">
  {/* Governed uploads may be on any configured storage origin. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={value} alt="Brand visual candidate" width={320} height={200} className="max-h-64 max-w-full rounded-lg border object-contain"/></a>
 if (typeof value === 'string' && /^https?:\/\//.test(value)) return <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-700 underline">View referenced asset</a>
 return <p className="whitespace-pre-wrap text-slate-900">{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value ?? 'Not set')}</p>
}
