'use client'

import {ReviewAnalysisBatchPanel} from '@/components/reviewflow/ReviewAnalysisBatchPanel'
import { useState, useCallback } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { 
  ReviewList, 
  ReviewStats, 
  TicketList, 
  ReviewFlowConfig,
  ReviewDetailDrawer,
  ImportReviewsModal,
  TodayQueue,
  InsightsPanel
} from '@/components/reviewflow'
import {
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Settings,
  RefreshCw,
  Loader2,
  Star,
  Plus,
  Lightbulb
} from 'lucide-react'

interface Review {
  id: string
  platform: string
  reviewer_name: string | null
  reviewer_avatar_url: string | null
  rating: number | null
  review_text: string
  review_date: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  sentiment_score: number | null
  is_urgent: boolean
  response_status: string
  topics: string[]
  created_at: string
  review_responses?: Array<{
    id: string
    response_text: string
    response_type: string
    status: string
    tone: string
    created_at: string
  }>
  review_tickets?: Array<{
    id: string
    title: string
    priority: string
    status: string
  }>
}

type TabId = 'overview' | 'reviews' | 'insights' | 'tickets' | 'settings'

export default function ReviewFlowPage() {
  const { currentProperty } = usePropertyContext()
  return <ReviewFlowWorkspace key={currentProperty.id}/>
}

function ReviewFlowWorkspace() {
  const { currentProperty } = usePropertyContext()
  const [initialIntakeId,setInitialIntakeId]=useState<string>(),[initialBatchId,setInitialBatchId]=useState<string>(),[batchOpen,setBatchOpen]=useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [generating, setGenerating] = useState<string | null>(null)
  const [generationError,setGenerationError]=useState('')
  const [showImportModal, setShowImportModal] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1)
  }, [])

  const handleGenerateResponse = async (reviewId: string) => {
    setGenerating(reviewId);setGenerationError('')
    try {
      const response=await fetch(`/api/reviewflow/reviews?propertyId=${currentProperty.id}&reviewId=${reviewId}&limit=1`,{cache:'no-store',signal:AbortSignal.timeout(20_000)})
      const data=await response.json();if(!response.ok||!data.reviews?.[0])throw new Error(data.error||'The saved review is unavailable.')
      setSelectedReview(data.reviews[0])
    } catch(error){setGenerationError(error instanceof Error?error.message:'The response workspace could not be opened.')}
    finally{setGenerating(null)}
  }

  const tabs = [
    { id: 'overview' as TabId, label: 'Today', icon: TrendingUp },
    { id: 'reviews' as TabId, label: 'Reviews', icon: MessageSquare },
    { id: 'insights' as TabId, label: 'Insights', icon: Lightbulb },
    { id: 'tickets' as TabId, label: 'Tickets', icon: AlertTriangle },
    { id: 'settings' as TabId, label: 'Settings', icon: Settings }
  ]

  return (
    <div className="space-y-6 p-4 sm:p-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
            <Star className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span className="text-slate-900 dark:text-slate-100">ReviewFlow AI</span>
              <span className="text-xs px-2 py-0.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-full">
                Beta
              </span>
            </h1>
            <p className="text-slate-500">
              AI-powered review management for {currentProperty.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-lg hover:from-rose-600 hover:to-pink-700 transition-all shadow-lg shadow-rose-500/25"
          >
            <Plus className="w-4 h-4" />
            Import Reviews
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-rose-500 text-rose-600 dark:text-rose-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {generating&&<p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Opening the saved response workspace…</p>}
      {generationError&&<p role="alert" className="text-sm text-red-600">{generationError}</p>}
      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Priority-first Today queue */}
          <TodayQueue
            propertyId={currentProperty.id}
            refreshKey={refreshKey}
            onOpenReview={handleGenerateResponse}
            onOpenIntake={id=>{setInitialIntakeId(id);setActiveTab('settings')}}
            onOpenBatch={id=>{setInitialBatchId(id);setBatchOpen(true);setActiveTab('reviews')}}
          />

          {/* Stats */}
          <ReviewStats 
            key={`stats-${refreshKey}`}
            propertyId={currentProperty.id} 
          />
        </div>
      )}

      {activeTab === 'reviews' && (
       <div className="space-y-6"><details open={batchOpen} onToggle={e=>setBatchOpen(e.currentTarget.open)}><summary className="cursor-pointer rounded-xl border p-4 font-medium">Analyze all unanalysed reviews</summary><div className="mt-3">{batchOpen&&<ReviewAnalysisBatchPanel propertyId={currentProperty.id} onReview={handleGenerateResponse} initialId={initialBatchId}/>}</div></details>
        <ReviewList
          key={`reviews-${refreshKey}`}
          propertyId={currentProperty.id}
          onSelectReview={(review) => setSelectedReview(review as Review)}
          onGenerateResponse={handleGenerateResponse}
        /></div>
      )}

      {activeTab === 'insights' && (
        <InsightsPanel
          onReview={handleGenerateResponse}
          propertyId={currentProperty.id}
          refreshKey={refreshKey}
        />
      )}

      {activeTab === 'tickets' && (
        <TicketList
          key={`tickets-${refreshKey}`}
          propertyId={currentProperty.id}
        />
      )}

      {activeTab === 'settings' && (
        <ReviewFlowConfig propertyId={currentProperty.id} initialIntakeId={initialIntakeId} />
      )}

      {/* Review Detail Drawer */}
      {selectedReview && (
        <ReviewDetailDrawer
          key={`${currentProperty.id}:${selectedReview.id}`}
          propertyId={currentProperty.id}
          review={selectedReview}
          onClose={() => setSelectedReview(null)}
          onUpdate={() => {
            handleRefresh()
            // Re-fetch the selected review to show updated data
          }}
        />
      )}

      {/* Import Reviews Modal */}
      {showImportModal && (
        <ImportReviewsModal
          propertyId={currentProperty.id}
          onClose={() => setShowImportModal(false)}
          onImported={handleRefresh}
        />
      )}
    </div>
  )
}

