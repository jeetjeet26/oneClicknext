'use client'

// SiteForge Conversational Generation Wizard
// Multi-phase wizard similar to BrandForge conversational flow
// Phase 1: Pre-analysis (Brand Agent findings)
// Phase 2: Property assets (photos and floor plans)
// Phase 3: Conversation (Plan with user input)
// Phase 4: Confirmation (Review and approve)
// Phase 5: Generation (Progress tracking)
// Created: December 16, 2025

import { useCallback, useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'
import { PropertyAssetsStep } from './PropertyAssetsStep'
import type { GenerationPreferences, WebsiteStatusResponse } from '@/types/siteforge'
import {
  approvedReadinessCapabilities,
  buildGenerationRequest,
  classifyWebsiteStatus,
  preferencesMatch,
  responseErrorMessage,
  siteForgeStatusEndpoint,
} from './orchestration'
import type { PersistedSiteForgeBrief } from '@/utils/siteforge/briefs/repository'

interface ConversationalGenerationWizardProps {
  propertyId: string
  propertyName: string
  open: boolean
  onClose: () => void
}

type Phase =
  | 'analyzing'
  | 'assets'
  | 'conversation'
  | 'confirmation'
  | 'generating'
  | 'complete'
  | 'failed'

interface BrandAnalysis {
  brandContext: Record<string, unknown> & {
    source?: string
    confidence?: number
  }
  stats: {
    photos: number
    documents: number
    hasBrandForge: boolean
  }
  analysisQuality?: {
    level: 'strong' | 'good' | 'needs_review'
    warnings: string[]
  }
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface ServerPlanSnapshot {
  planId: string
  planVersionId: string
  revision: number
  contentHash: string
  planState: 'ready_for_review' | 'confirmed' | 'consumed' | 'draft' | 'denied'
  plan: {
    summary: string
    preferences: GenerationPreferences
    pages: Array<{
      slug: string
      title: string
      sections: Array<{ id: string; label: string; purpose: string }>
    }>
    brandDirection: {
      positioning: string
      visualDirection: string
    }
    conversionStrategy: {
      primaryAction: string
    }
    recommendations: string[]
  }
  readiness: {
    ready: boolean
    issues: Array<{
      code: string
      severity: 'warning' | 'blocker'
      message: string
    }>
  }
}

export function ConversationalGenerationWizard({
  propertyId,
  propertyName,
  open,
  onClose
}: ConversationalGenerationWizardProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('analyzing')
  const [analysis, setAnalysis] = useState<BrandAnalysis | null>(null)
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [userInput, setUserInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStep, setGenerationStep] = useState('')
  const [websiteId, setWebsiteId] = useState<string | null>(null)
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const [canRetryGeneration, setCanRetryGeneration] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [serverPlan, setServerPlan] = useState<ServerPlanSnapshot | null>(null)
  const [changeRequest, setChangeRequest] = useState('')
  const [durableBriefs, setDurableBriefs] = useState<
    PersistedSiteForgeBrief[]
  >([])
  const [preferences, setPreferences] = useState<GenerationPreferences>({
    ctaPriority: 'contact',
    enabledCapabilities: [],
  })
  const chatEndRef = useRef<HTMLDivElement>(null)
  
  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation])
  
  // Poll generation status
  useEffect(() => {
    if (phase === 'generating' && websiteId) {
      let cancelled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const startedAt = Date.now()

      const poll = async () => {
        try {
          const res = await fetch(siteForgeStatusEndpoint(websiteId), {
            cache: 'no-store',
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(
              responseErrorMessage(res.status, data, 'checking generation progress')
            )
          }
          if (cancelled) return
          const status = data as WebsiteStatusResponse
          
          setGenerationProgress(status.progress || 0)
          setGenerationStep(status.currentStep || '')
          if (typeof status.jobId === 'string') setGenerationJobId(status.jobId)

          const outcome = classifyWebsiteStatus(status, 'generation')
          if (outcome.terminal && outcome.succeeded) {
            setPhase('complete')
            setTimeout(() => {
              router.push(`/dashboard/siteforge/${websiteId}`)
            }, 2000)
            return
          }
          if (outcome.terminal && !outcome.succeeded) {
            setGenerationError(outcome.message)
            setCanRetryGeneration(
              status.lifecycleStatus === 'failed' &&
              typeof status.attemptCount === 'number' &&
              typeof status.maxAttempts === 'number' &&
              status.attemptCount < status.maxAttempts &&
              !status.cancelRequested
            )
            setPhase('failed')
            return
          }
          if (Date.now() - startedAt >= 10 * 60_000) {
            throw new Error(
              'Generation is still not complete after 10 minutes. Check SiteForge job logs, then retry the failed job or return to the plan.'
            )
          }
          timeout = setTimeout(poll, 2000)
        } catch (err) {
          console.error('Status poll error:', err)
          if (!cancelled) {
            setGenerationError(
              err instanceof Error
                ? err.message
                : 'Could not check generation progress. Retry from the saved plan.'
            )
            setCanRetryGeneration(false)
            setPhase('failed')
          }
        }
      }

      void poll()
      return () => {
        cancelled = true
        if (timeout) clearTimeout(timeout)
      }
    }
  }, [phase, router, websiteId])

  const resetWizard = useCallback(() => {
    setPhase('analyzing')
    setAnalysis(null)
    setConversation([])
    setUserInput('')
    setLoading(false)
    setGenerationProgress(0)
    setGenerationStep('')
    setWebsiteId(null)
    setGenerationJobId(null)
    setCanRetryGeneration(false)
    setGenerationError('')
    setServerPlan(null)
    setChangeRequest('')
    setPreferences({ ctaPriority: 'contact', enabledCapabilities: [] })
  }, [])

  const preferencesForApprovedReadiness =
    useCallback(async (): Promise<GenerationPreferences> => {
      const response = await fetch(
        `/api/onboarding/readiness?propertyId=${encodeURIComponent(propertyId)}`,
        { cache: 'no-store' }
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Could not load approved SiteForge readiness')
      }
      const snapshots = Array.isArray(body.snapshots) ? body.snapshots : []
      if (
        !snapshots.some(
          (snapshot: unknown) =>
            Boolean(snapshot) &&
            typeof snapshot === 'object' &&
            !Array.isArray(snapshot) &&
            (snapshot as { status?: unknown }).status === 'approved'
        )
      ) {
        throw new Error(
          'Approve SiteForge readiness in Web Director before reviewing this plan.'
        )
      }
      const nextPreferences: GenerationPreferences = {
        ...preferences,
        enabledCapabilities: approvedReadinessCapabilities(snapshots),
      }
      setPreferences(nextPreferences)
      return nextPreferences
    }, [preferences, propertyId])

  const prepareProjectShell = useCallback(async () => {
    const response = await fetch('/api/siteforge/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        responseErrorMessage(
          response.status,
          body,
          'preparing the SiteForge project'
        )
      )
    }
    const projectWebsiteId =
      body &&
      typeof body === 'object' &&
      body.project &&
      typeof body.project === 'object' &&
      typeof body.project.websiteId === 'string'
        ? body.project.websiteId
        : null
    if (!projectWebsiteId) {
      throw new Error('SiteForge prepared a project without a website identifier')
    }
    setWebsiteId(projectWebsiteId)
    return projectWebsiteId
  }, [propertyId])
  
  const runPreAnalysis = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/siteforge/analyze?propertyId=${propertyId}`)
      
      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.status}`)
      }
      
      const data = await res.json()
      
      if (!data.brandContext) {
        throw new Error('No brand context returned from analysis')
      }

      await prepareProjectShell()
      setAnalysis(data)
      setPhase('assets')
      
    } catch (error) {
      console.error('Pre-analysis error:', error)
      setGenerationError(
        `Failed to analyze brand: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
      setPhase('failed')
    } finally {
      setLoading(false)
    }
  }, [prepareProjectShell, propertyId])

  // Phase 1: Run pre-analysis when dialog opens
  useEffect(() => {
    if (open && phase === 'analyzing') {
      void runPreAnalysis()
    } else if (!open) {
      resetWizard()
    }
  }, [open, phase, resetWizard, runPreAnalysis])

  useEffect(() => {
    if (!open || !websiteId) return
    let cancelled = false
    void fetch(
      `/api/siteforge/briefs?websiteId=${encodeURIComponent(websiteId)}`,
      { cache: 'no-store' }
    )
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || 'Failed to list durable briefs')
        }
        if (!cancelled) setDurableBriefs(body.briefs || [])
      })
      .catch(error => {
        if (!cancelled) {
          console.warn('Could not list durable SiteForge briefs:', error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, websiteId])

  async function continueFromAssets() {
    if (!websiteId) {
      setGenerationError(
        'The SiteForge project is not ready yet. Close this window and retry.'
      )
      return
    }
    onClose()
    router.push(`/dashboard/siteforge/${websiteId}?workspace=plan`)
  }
  
  async function sendMessage() {
    if (!userInput.trim()) return
    
    // Add user message
    const userMsg: ConversationMessage = {
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString()
    }
    setConversation(prev => [...prev, userMsg])
    setUserInput('')
    setLoading(true)
    
    try {
      const approvedPreferences = await preferencesForApprovedReadiness()
      const res = await fetch('/api/siteforge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          planId: serverPlan?.planId,
          expectedRevision: serverPlan?.revision,
          conversationHistory: conversation,
          userMessage: userInput,
          preferences: approvedPreferences,
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Chat failed: ${res.status}`)
      }

      const data = await res.json()

      setServerPlan(data)
      // Add AI response
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: data.aiResponse,
        timestamp: new Date().toISOString()
      }])

    } catch (error) {
      console.error('Send message error:', error)
      // Show error in chat so user knows something went wrong
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Something went wrong: ${error instanceof Error ? error.message : 'Failed to send message'}. Please try again.`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  async function persistSelectedPreferences(
    currentPlan: ServerPlanSnapshot
  ): Promise<ServerPlanSnapshot> {
    const approvedPreferences = await preferencesForApprovedReadiness()
    if (preferencesMatch(currentPlan.plan.preferences, approvedPreferences)) {
      return currentPlan
    }

    const response = await fetch('/api/siteforge/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        planId: currentPlan.planId,
        expectedRevision: currentPlan.revision,
        conversationHistory: conversation,
        userMessage: null,
        preferences: approvedPreferences,
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        responseErrorMessage(response.status, result, 'saving plan preferences')
      )
    }
    const persisted = result as ServerPlanSnapshot
    setServerPlan(persisted)
    return persisted
  }

  async function saveWizardToDurableBrief() {
    const currentBrief = durableBriefs[0]
    if (!currentBrief || !serverPlan) return
    setLoading(true)
    setGenerationError('')
    try {
      const reference = {
        label: `SiteForge wizard plan revision ${serverPlan.revision}`,
        sourceId: serverPlan.planVersionId,
        notes: serverPlan.plan.summary,
      }
      const response = await fetch('/api/siteforge/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId: currentBrief.websiteId,
          expectedVersion: currentBrief.version,
          status: 'draft',
          brief: {
            ...currentBrief.brief,
            references: [
              ...currentBrief.brief.references.filter(
                item => item.sourceId !== serverPlan.planVersionId
              ),
              reference,
            ],
          },
          unresolvedContradictions: currentBrief.unresolvedContradictions,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save wizard work to brief')
      }
      setDurableBriefs(current => [body.brief, ...current])
      setGenerationError('Wizard plan saved as a new durable brief draft.')
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : 'Failed to save wizard work to brief'
      )
    } finally {
      setLoading(false)
    }
  }

  function resumeDurableBrief(brief: PersistedSiteForgeBrief) {
    onClose()
    router.push(`/dashboard/siteforge/${brief.websiteId}?workspace=brief`)
  }

  async function reviewPlan() {
    if (!serverPlan) return
    setLoading(true)
    setGenerationError('')
    try {
      await persistSelectedPreferences(serverPlan)
      setPhase('confirmation')
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Could not save plan preferences'
      )
    } finally {
      setLoading(false)
    }
  }
  
  async function startGeneration() {
    if (!serverPlan || !websiteId) {
      setGenerationError(
        'Review a saved plan in a prepared SiteForge project before starting generation.'
      )
      setPhase('failed')
      return
    }

    setPhase('generating')
    setLoading(true)
    setGenerationError('')
    
    try {
      const approvedPlan = await persistSelectedPreferences(serverPlan)
      const decisionResponse = await fetch(
        `/api/siteforge/plans/${approvedPlan.planId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            expectedRevision: approvedPlan.revision,
            contentHash: approvedPlan.contentHash,
            decisionStatus: 'approved',
            decisionReason: 'Approved in the SiteForge generation wizard.',
          }),
        }
      )
      const decision = await decisionResponse.json().catch(() => ({}))
      if (!decisionResponse.ok) {
        throw new Error(
          typeof decision.error === 'string'
            ? decision.error
            : `Plan approval failed (${decisionResponse.status})`
        )
      }

      const res = await fetch('/api/siteforge/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildGenerationRequest(websiteId, approvedPlan, crypto.randomUUID())
        )
      })
      
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : `Generation failed to start (${res.status})`
        )
      }
      if (typeof data.websiteId !== 'string' || !data.websiteId) {
        throw new Error('Generation started without a website identifier')
      }
      setWebsiteId(data.websiteId)
      if (typeof data.jobId === 'string') setGenerationJobId(data.jobId)
      
    } catch (error) {
      console.error('Generation start error:', error)
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to start generation'
      )
      setPhase('failed')
    } finally {
      setLoading(false)
    }
  }

  async function cancelGeneration() {
    if (!generationJobId) return
    setLoading(true)
    try {
      const response = await fetch(
        `/api/siteforge/jobs/${generationJobId}/cancel`,
        { method: 'POST' }
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : `Cancellation failed (${response.status})`
        )
      }
      setGenerationError('Generation cancelled.')
      setCanRetryGeneration(false)
      setPhase('failed')
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to cancel generation'
      )
    } finally {
      setLoading(false)
    }
  }

  async function retryGeneration() {
    if (!generationJobId) return
    setLoading(true)
    setGenerationError('')
    try {
      const response = await fetch(
        `/api/siteforge/jobs/${generationJobId}/retry`,
        { method: 'POST' }
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : `Retry failed (${response.status})`
        )
      }
      setCanRetryGeneration(false)
      setGenerationProgress(0)
      setGenerationStep('Retry queued')
      setPhase('generating')
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to retry generation'
      )
    } finally {
      setLoading(false)
    }
  }

  async function requestPlanChanges() {
    if (!serverPlan || !changeRequest.trim()) return
    setLoading(true)
    try {
      const modifiedPlan = {
        ...serverPlan.plan,
        recommendations: [
          ...serverPlan.plan.recommendations,
          changeRequest.trim(),
        ],
      }
      const response = await fetch(
        `/api/siteforge/plans/${serverPlan.planId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            expectedRevision: serverPlan.revision,
            contentHash: serverPlan.contentHash,
            decisionStatus: 'modified',
            decisionReason: changeRequest.trim(),
            modifiedPlan,
          }),
        }
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : `Plan update failed (${response.status})`
        )
      }
      setServerPlan({
        ...serverPlan,
        planVersionId: result.planVersionId,
        revision: result.revision,
        contentHash: result.contentHash,
        planState: 'ready_for_review',
        plan: modifiedPlan,
      })
      setConversation(current => [
        ...current,
        {
          role: 'user',
          content: changeRequest.trim(),
          timestamp: new Date().toISOString(),
        },
      ])
      setChangeRequest('')
      setPhase('conversation')
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to save requested changes'
      )
    } finally {
      setLoading(false)
    }
  }

  async function discardPlan() {
    if (!serverPlan) return
    setLoading(true)
    try {
      const response = await fetch(
        `/api/siteforge/plans/${serverPlan.planId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            expectedRevision: serverPlan.revision,
            contentHash: serverPlan.contentHash,
            decisionStatus: 'denied',
            decisionReason: 'Discarded in the SiteForge generation wizard.',
          }),
        }
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : `Plan discard failed (${response.status})`
        )
      }
      onClose()
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to discard plan'
      )
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className={`flex w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 ${
          phase === 'assets'
            ? 'h-auto max-h-[calc(100dvh-1rem)] sm:max-h-[min(90dvh,900px)]'
            : 'h-[calc(100dvh-1rem)] sm:h-[min(90dvh,900px)]'
        }`}
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <span>🎨</span>
            {phase === 'analyzing' && 'Analyzing Brand Intelligence...'}
            {phase === 'assets' && `Add Property Assets for ${propertyName}`}
            {phase === 'conversation' && `Planning Website for ${propertyName}`}
            {phase === 'confirmation' && 'Review Your Plan'}
            {phase === 'generating' && 'Generating Website...'}
            {phase === 'complete' && '✅ Website Ready!'}
            {phase === 'failed' && 'Generation Needs Attention'}
          </DialogTitle>
        </DialogHeader>
        <div
          className={`min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] px-4 pb-5 sm:px-6 sm:pb-6 ${
            phase === 'assets' ? 'shrink' : 'flex-1'
          }`}
        >
          {/* Phase 1: Analyzing */}
          {phase === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin text-4xl">🔍</div>
            <p className="text-lg font-medium">Analyzing brand intelligence...</p>
            <p className="text-sm text-gray-500">
              Reading BrandForge data, vector embeddings, and knowledge base
            </p>
          </div>
          )}
        
        {/* Phase 2: Property assets */}
        {phase === 'assets' && analysis && (
          <div className="min-w-0 space-y-4 py-4">
            <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 p-4 dark:from-indigo-950/30 dark:to-purple-950/30">
              <h3 className="text-sm font-semibold">
                Add the real property content SiteForge should use
              </h3>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Property photography and floor-plan images are optional. Add
                them only when you want SiteForge to use them.
              </p>
            </div>
            <PropertyAssetsStep
              propertyId={propertyId}
              onPhotoCountChange={count =>
                setAnalysis(current =>
                  current
                    ? {
                        ...current,
                        stats: {
                          ...current.stats,
                          photos: Math.max(current.stats.photos, count),
                        },
                        analysisQuality: current.analysisQuality
                          ? {
                              ...current.analysisQuality,
                              warnings:
                                count > 0
                                  ? current.analysisQuality.warnings.filter(
                                      warning =>
                                        !warning
                                          .toLowerCase()
                                          .includes('no property photos')
                                    )
                                  : current.analysisQuality.warnings,
                            }
                          : undefined,
                      }
                    : current
                )
              }
            />
            {generationError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {generationError}
              </p>
            )}
            <div className="-mx-4 flex justify-end border-t bg-white px-4 py-3 dark:bg-gray-800 sm:-mx-6 sm:px-6">
              <Button
                onClick={() => void continueFromAssets()}
                disabled={loading}
              >
                {loading ? 'Preparing project…' : 'Continue in Web Director →'}
              </Button>
            </div>
          </div>
        )}

        {/* Phase 3: Conversation */}
        {phase === 'conversation' && analysis && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Brand Analysis Summary */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 p-4 rounded-lg mb-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>✅</span>
                <span>Brand Analysis Complete</span>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-gray-500">Confidence</div>
                  <div className="font-semibold">
                    {analysis.brandContext?.confidence 
                      ? (analysis.brandContext.confidence * 100).toFixed(0) 
                      : '0'}%
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Source</div>
                  <div className="font-semibold capitalize">
                    {analysis.brandContext?.source || 'analyzing'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Photos</div>
                  <div className="font-semibold">{analysis.stats?.photos || 0} analyzed</div>
                </div>
              </div>
              
              {analysis.stats?.hasBrandForge && (
                <div className="text-xs text-indigo-600 dark:text-indigo-400">
                  ⭐ Using BrandForge brand book
                </div>
              )}

              {analysis.analysisQuality?.warnings.map(warning => (
                <div
                  key={warning}
                  className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  Review recommended: {warning}
                </div>
              ))}
            </div>

            <div className="mb-4 space-y-3 rounded-lg border p-4">
              <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Durable brief workspace</h3>
                    <p className="text-xs text-gray-500">
                      {durableBriefs.length
                        ? `${durableBriefs.length} saved version${durableBriefs.length === 1 ? '' : 's'} available.`
                        : 'No website-anchored brief exists for this property yet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {durableBriefs[0] ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => resumeDurableBrief(durableBriefs[0])}
                        >
                          List / resume briefs
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading || !serverPlan}
                          onClick={() => void saveWizardToDurableBrief()}
                        >
                          Save wizard plan to brief
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Set the direction</h3>
                <p className="text-xs text-gray-500">
                  Optional—leave a choice unselected and SiteForge will use its brand recommendation.
                </p>
              </div>
              <PreferencePicker
                label="Visual style"
                value={preferences.style}
                options={[
                  ['modern', 'Modern'],
                  ['luxury', 'Luxury'],
                  ['cozy', 'Warm'],
                  ['vibrant', 'Vibrant'],
                  ['professional', 'Professional'],
                ]}
                onChange={style => setPreferences(current => ({
                  ...current,
                  style: style as GenerationPreferences['style'],
                }))}
              />
              <PreferencePicker
                label="Primary focus"
                value={preferences.emphasis}
                options={[
                  ['amenities', 'Amenities'],
                  ['location', 'Location'],
                  ['lifestyle', 'Lifestyle'],
                  ['value', 'Value'],
                  ['community', 'Community'],
                ]}
                onChange={emphasis => setPreferences(current => ({
                  ...current,
                  emphasis: emphasis as GenerationPreferences['emphasis'],
                }))}
              />
              <PreferencePicker
                label="Primary action"
                value={preferences.ctaPriority}
                options={[
                  ['tours', 'Schedule tours'],
                  ['applications', 'Apply now'],
                  ['contact', 'Contact team'],
                  ['calls', 'Call property'],
                ]}
                onChange={ctaPriority => setPreferences(current => ({
                  ...current,
                  ctaPriority: ctaPriority as GenerationPreferences['ctaPriority'],
                }))}
              />
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Approved connected capabilities
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['crm', 'CRM / LeadPulse delivery'],
                    ['tours', 'LumaLeasing tour booking'],
                    ['chatbot', 'Property chatbot'],
                    ['analytics', 'Analytics and tag manager'],
                  ] as const).map(([capability, label]) => (
                    <label key={capability} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={preferences.enabledCapabilities?.includes(capability) || false}
                        readOnly
                        disabled
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  These values come from the approved readiness snapshot. Manage
                  capability integrations and approvals in Web Director.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void continueFromAssets()}
                  disabled={loading}
                >
                  Manage readiness in Web Director
                </Button>
              </fieldset>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
              {conversation.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                    <div className={`text-xs mt-1 ${
                      msg.role === 'user' ? 'text-indigo-200' : 'text-gray-500'
                    }`}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="animate-pulse">●</span>
                      <span>AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>
            
            {generationError && (
              <p
                role="alert"
                className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
              >
                {generationError}
              </p>
            )}

            {/* Input Area */}
            <div className="border-t pt-4 space-y-2">
              <Textarea
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Type your response... (e.g., 'Focus more on the pool and add virtual tour options')"
                rows={3}
                disabled={loading}
                className="resize-none"
              />
              
              <div className="flex flex-wrap justify-between gap-2">
                <div className="text-xs text-gray-500">
                  Chat is optional. You can review the plan whenever you are ready.
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGenerationError('')
                      setPhase('assets')
                    }}
                    disabled={loading}
                  >
                    Property assets
                  </Button>
                  <Button
                    variant="outline"
                    onClick={sendMessage}
                    disabled={loading || !userInput.trim()}
                  >
                    Send
                  </Button>
                  <Button
                    onClick={() => void reviewPlan()}
                    disabled={loading || !serverPlan}
                  >
                    {loading ? 'Saving preferences…' : 'Review plan →'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Phase 4: Confirmation */}
        {phase === 'confirmation' && (
          <div className="space-y-4 py-4">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-800 rounded-lg p-6">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-bold text-lg mb-2">
                <span>✅</span>
                <span>Ready for your approval</span>
              </div>
              <p className="text-sm text-green-600 dark:text-green-400">
                Confirm the direction below. Generation starts only when you click Generate Website.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <PlanChoice
                label="Visual style"
                value={preferenceLabel('style', serverPlan?.plan.preferences.style)}
              />
              <PlanChoice
                label="Primary focus"
                value={preferenceLabel('emphasis', serverPlan?.plan.preferences.emphasis)}
              />
              <PlanChoice
                label="Primary action"
                value={preferenceLabel(
                  'ctaPriority',
                  serverPlan?.plan.preferences.ctaPriority
                )}
              />
            </div>

            {serverPlan && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">Saved plan revision {serverPlan.revision}</h4>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    serverPlan.readiness.ready
                      ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                  }`}>
                    {serverPlan.readiness.ready ? 'Ready to approve' : 'Blocked'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {serverPlan.plan.summary}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {serverPlan.plan.pages.map(page => (
                    <div key={page.slug} className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
                      <div className="text-sm font-semibold">{page.title}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {page.sections.map(section => section.label).join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
                {serverPlan.readiness.issues.map(issue => (
                  <div
                    key={issue.code}
                    className={`rounded-md px-3 py-2 text-xs ${
                      issue.severity === 'blocker'
                        ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    }`}
                  >
                    {issue.message}
                  </div>
                ))}
              </div>
            )}
            
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span>📋</span>
                Current AI recommendation:
              </h4>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm space-y-3 max-h-60 overflow-y-auto">
                {conversation.filter(m => m.role === 'assistant').slice(-1).map((msg, idx) => (
                  <div key={idx} className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-4">
              <label htmlFor="siteforge-change-request" className="text-sm font-medium">
                Want a different direction?
              </label>
              <Textarea
                id="siteforge-change-request"
                value={changeRequest}
                onChange={event => setChangeRequest(event.target.value)}
                placeholder="Describe the change. SiteForge will save it as a new plan revision."
                rows={2}
                disabled={loading}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={requestPlanChanges}
                  disabled={loading || !changeRequest.trim()}
                >
                  Save as new revision
                </Button>
              </div>
            </div>
            
            <div className="flex justify-between pt-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPhase('conversation')}
                  disabled={loading}
                >
                  ← Continue planning
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setGenerationError('')
                    setPhase('assets')
                  }}
                  disabled={loading}
                >
                  Edit property assets
                </Button>
                <Button
                  variant="ghost"
                  onClick={discardPlan}
                  disabled={loading}
                >
                  Discard plan
                </Button>
              </div>
              <Button
                onClick={startGeneration}
                disabled={loading || !serverPlan?.readiness.ready}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {loading ? (
                  <>
                    <span className="animate-spin mr-2">⚙️</span>
                    Starting...
                  </>
                ) : (
                  <>🚀 Generate Website</>
                )}
              </Button>
            </div>
          </div>
        )}
        
        {/* Phase 5: Generating */}
        {phase === 'generating' && (
          <div className="py-8 space-y-6">
            <div className="text-center">
              <div className="text-lg font-medium mb-2">
                {generationStep || 'Generating your website...'}
              </div>
              <div className="text-sm text-gray-500">
                This typically takes 3-5 minutes
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>Progress</span>
                <span>{generationProgress}%</span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500 ease-out"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
            
            {/* Agent Status */}
            <div className="space-y-2">
              <AgentStep
                label="Brand Agent"
                status={generationProgress >= 10 ? 'complete' : 'pending'}
                description="Analyzing brand context"
              />
              <AgentStep
                label="Architecture Agent"
                status={generationProgress >= 30 ? 'complete' : generationProgress >= 10 ? 'active' : 'pending'}
                description="Planning site structure"
              />
              <AgentStep
                label="Design Agent"
                status={generationProgress >= 50 ? 'complete' : generationProgress >= 30 ? 'active' : 'pending'}
                description="Creating design system"
              />
              <AgentStep
                label="Photo Agent"
                status={generationProgress >= 75 ? 'complete' : generationProgress >= 50 ? 'active' : 'pending'}
                description="Processing photos"
              />
              <AgentStep
                label="Content Agent"
                status={generationProgress >= 90 ? 'complete' : generationProgress >= 75 ? 'active' : 'pending'}
                description="Generating content"
              />
              <AgentStep
                label="Quality Agent"
                status={generationProgress >= 100 ? 'complete' : generationProgress >= 90 ? 'active' : 'pending'}
                description="Validating quality"
              />
            </div>

            {generationJobId && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={cancelGeneration} disabled={loading}>
                  Cancel generation
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* Phase 6: Complete */}
        {phase === 'complete' && (
          <div className="py-12 text-center space-y-4">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-2xl font-bold">Website Ready!</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Redirecting to preview...
            </p>
          </div>
        )}

          {phase === 'failed' && (
          <div className="space-y-5 py-8">
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/30">
              <h3 className="font-semibold text-red-800 dark:text-red-300">
                SiteForge could not finish this generation
              </h3>
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                {generationError || 'Website generation failed. Please try again.'}
              </p>
            </div>
            {analysis ? (
              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setPhase('conversation')}>
                  ← Review plan
                </Button>
                {canRetryGeneration && generationJobId ? (
                  <Button onClick={retryGeneration} disabled={loading}>
                    {loading ? 'Retrying…' : 'Retry failed job'}
                  </Button>
                ) : (
                  <Button onClick={() => setPhase('conversation')} disabled={loading}>
                    Refine plan
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => {
                    setGenerationError('')
                    setPhase('analyzing')
                  }}
                >
                  Retry analysis
                </Button>
              </div>
            )}
          </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AgentStep({ 
  label, 
  status, 
  description 
}: { 
  label: string
  status: 'pending' | 'active' | 'complete'
  description: string 
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
      <div className="flex-shrink-0">
        {status === 'complete' && <span className="text-green-600 dark:text-green-400">✅</span>}
        {status === 'active' && <span className="text-indigo-600 dark:text-indigo-400 animate-pulse">⚙️</span>}
        {status === 'pending' && <span className="text-gray-400">⏳</span>}
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </div>
  )
}

function PreferencePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: Array<[string, string]>
  onChange: (value: string | undefined) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(([optionValue, optionLabel]) => {
          const selected = value === optionValue
          return (
            <Button
              key={optionValue}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              onClick={() => onChange(selected ? undefined : optionValue)}
            >
              {optionLabel}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function PlanChoice({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3 dark:bg-gray-900">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

const preferenceLabels = {
  style: {
    modern: 'Modern',
    luxury: 'Luxury',
    cozy: 'Warm',
    vibrant: 'Vibrant',
    professional: 'Professional',
  },
  emphasis: {
    amenities: 'Amenities',
    location: 'Location',
    lifestyle: 'Lifestyle',
    value: 'Value',
    community: 'Community',
  },
  ctaPriority: {
    tours: 'Schedule tours',
    applications: 'Apply now',
    contact: 'Contact team',
    calls: 'Call property',
  },
} satisfies Record<
  'style' | 'emphasis' | 'ctaPriority',
  Record<string, string>
>

function preferenceLabel(
  key: 'style' | 'emphasis' | 'ctaPriority',
  value:
    | GenerationPreferences['style']
    | GenerationPreferences['emphasis']
    | GenerationPreferences['ctaPriority']
): string {
  if (!value) {
    return 'AI recommendation'
  }
  const labels = preferenceLabels[key] as Record<string, string>
  return labels[value] || value
}










