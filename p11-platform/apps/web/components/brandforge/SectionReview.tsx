'use client'

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
    return 'Visual generation is not fully configured yet. Continue approving the text sections, then retry the visual asset step once Vertex AI credentials are available.'
  }

  if (normalized.includes('quota') || normalized.includes('rate limit')) {
    return 'The provider hit a temporary quota or rate limit. Wait a moment, then retry this section.'
  }

  if (normalized.includes('failed to extract json')) {
    return 'The model returned an unusable draft. Retry the section to request a cleaner response.'
  }

  if (step === 6) {
    return 'Logo/image steps rely on external providers and may degrade gracefully. You can retry this section or continue with the rest of the brand book once the provider is healthy.'
  }

  return message
}

function getLoadingHint(step: number, sectionName?: string) {
  if (step === 6 || sectionName === 'logo') {
    return 'Logo generation may take longer and can fall back to a placeholder if image credentials or quota are unavailable.'
  }

  if (step >= 10 || sectionName === 'photo_yep' || sectionName === 'photo_nope') {
    return 'Visual guidance sections can take a bit longer than text-only sections.'
  }

  return 'You can review, edit, or regenerate each section before approving it.'
}

export function SectionReview({ brandAssetId, onSectionChange, onComplete }: SectionReviewProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [draftSection, setDraftSection] = useState<any>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [isEditing, setIsEditing] = useState(false)
  const [editedData, setEditedData] = useState<any>({})
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [regenerateHint, setRegenerateHint] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const hasStartedGenerationRef = useRef(false)

  useEffect(() => {
    onSectionChange(currentStep)
  }, [currentStep, onSectionChange])

  useEffect(() => {
    // Generate first section on mount
    if (hasStartedGenerationRef.current) return
    hasStartedGenerationRef.current = true
    if (!draftSection && currentStep <= 12) {
      void generateNextSection()
    }
  }, [])

  async function generateNextSection() {
    setIsGenerating(true)
    setIsEditing(false)
    setEditedData({})
    setActionError(null)
    setActionInfo(null)

    try {
      const res = await fetch('/api/brandforge/generate-next-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandAssetId })
      })

      if (!res.ok) {
        throw new Error(
          buildActionableMessage(
            await getApiErrorMessage(res, 'Generation failed'),
            currentStep
          )
        )
      }

      const data = await res.json()
      setDraftSection(data)
      setCurrentStep(data.step)

      if (data.sectionName === 'logo' && data.data?.primary_url === '/placeholder-logo.png') {
        setActionInfo(
          'BrandForge kept moving with a placeholder logo. You can continue the book now and regenerate visual assets later from the brand-book page.'
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      console.error('Failed to generate section:', err)
      setActionError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRegenerate() {
    setIsGenerating(true)
    setShowRegenerateModal(false)
    setActionError(null)
    setActionInfo(null)

    try {
      const res = await fetch('/api/brandforge/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          brandAssetId, 
          hint: regenerateHint || undefined 
        })
      })

      if (!res.ok) {
        throw new Error(
          buildActionableMessage(
            await getApiErrorMessage(res, 'Regeneration failed'),
            currentStep
          )
        )
      }

      const data = await res.json()
      setDraftSection(data)
      setRegenerateHint('')
    } catch (err) {
      console.error('Failed to regenerate:', err)
      setActionError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleEdit() {
    if (!isEditing) {
      setIsEditing(true)
      setEditedData(draftSection.data)
      return
    }

    // Save edits
    try {
      setActionError(null)
      const res = await fetch('/api/brandforge/edit-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          brandAssetId, 
          updates: editedData 
        })
      })

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Edit failed'))
      }

      const data = await res.json()
      setDraftSection(data)
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save edit:', err)
      setActionError(err instanceof Error ? err.message : 'Edit failed')
    }
  }

  async function handleApprove() {
    try {
      setActionError(null)
      setActionInfo(null)
      const res = await fetch('/api/brandforge/approve-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandAssetId })
      })

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Approval failed'))
      }

      const data = await res.json()

      if (data.isComplete) {
        // All sections complete - generate PDF
        setIsGenerating(true)
        const pdfRes = await fetch('/api/brandforge/generate-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandAssetId })
        })

        const pdfData = await pdfRes.json().catch(() => ({}))

        if (!pdfRes.ok) {
          onComplete({
            brandAssetId,
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
          pdfUrl: typeof pdfData?.pdfUrl === 'string' ? pdfData.pdfUrl : null,
          exportError: null,
        })
      } else {
        // Move to next section
        setDraftSection(null)
        setCurrentStep(data.nextStep)
        await generateNextSection()
      }
    } catch (err) {
      console.error('Failed to approve:', err)
      setActionError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setIsGenerating(false)
    }
  }

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

  if (!draftSection) return null

  return (
    <div className="space-y-6">
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
            disabled={isGenerating}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
          >
            <Edit className="w-4 h-4" />
            {isEditing ? 'Save Edits' : 'Edit'}
          </button>
          <button
            onClick={() => setShowRegenerateModal(true)}
            disabled={isGenerating}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Regenerate
          </button>
        </div>
        <button
          onClick={handleApprove}
          disabled={isEditing || isGenerating}
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
                disabled={isGenerating}
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

function RenderSectionContent({ section, isEditing, editedData, onEdit }: any) {
  const data = isEditing ? editedData : section.data

  // Simple text renderer - can be expanded for each section type
  return (
    <div className="space-y-4">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">
            {key.replace(/_/g, ' ')}
          </label>
          {isEditing && typeof value === 'string' ? (
            <textarea
              value={value as string}
              onChange={(e) => onEdit({ ...editedData, [key]: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          ) : (
            <div className="text-slate-900 whitespace-pre-wrap">
              {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}























