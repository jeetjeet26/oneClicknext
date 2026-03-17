'use client'

import { useState, useEffect, useCallback } from 'react'
import { DraftCard } from './DraftCard'
import { AssetPickerModal } from './AssetPickerModal'
import {
  Loader2,
  Filter,
  Grid,
  List,
  Search,
  FileText,
  Check,
  Clock,
  Archive
} from 'lucide-react'

interface ContentAsset {
  id: string
  name: string
  description: string | null
  asset_type: 'image' | 'video' | 'gif' | 'audio'
  file_url: string
  thumbnail_url: string | null
  file_size_bytes: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  format: string | null
  is_ai_generated: boolean
  generation_provider: string | null
  generation_prompt: string | null
  tags: string[]
  folder: string | null
  is_favorite: boolean
  usage_count: number
  created_at: string
}

interface ContentDraft {
  id: string
  title: string
  content_type: string
  platform: string
  caption: string
  hashtags: string[]
  call_to_action: string
  media_type: string
  media_urls: string[]
  thumbnail_url: string | null
  status: string
  scheduled_for: string | null
  created_at: string
  variations: string[]
  generation_params?: {
    readiness?: {
      state?: string
      blockers?: string[]
    }
  }
}

interface DraftListProps {
  propertyId: string
  onEditDraft?: (draft: ContentDraft) => void
  refreshTrigger?: number
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All', icon: FileText },
  { id: 'draft', label: 'Drafts', icon: FileText },
  { id: 'draft_partial', label: 'Partial', icon: Clock },
  { id: 'pending_review', label: 'Pending', icon: Clock },
  { id: 'approved', label: 'Approved', icon: Check },
  { id: 'scheduled', label: 'Scheduled', icon: Clock },
  { id: 'published', label: 'Published', icon: Check },
  { id: 'archived', label: 'Archived', icon: Archive },
]

export function DraftList({ propertyId, onEditDraft, refreshTrigger }: DraftListProps) {
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [total, setTotal] = useState(0)
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [selectedDraftForMedia, setSelectedDraftForMedia] = useState<ContentDraft | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ propertyId })
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      const res = await fetch(`/api/forgestudio/drafts?${params}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch drafts')
      }

      setDrafts(data.drafts || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [propertyId, statusFilter])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts, refreshTrigger])

  const handleApprove = async (draftId: string) => {
    try {
      const res = await fetch('/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, status: 'approved' })
      })

      if (res.ok) {
        fetchDrafts()
      }
    } catch (err) {
      console.error('Error approving draft:', err)
    }
  }

  const handleReject = async (draftId: string) => {
    try {
      const res = await fetch('/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, status: 'rejected' })
      })

      if (res.ok) {
        fetchDrafts()
      }
    } catch (err) {
      console.error('Error rejecting draft:', err)
    }
  }

  const handleDelete = async (draftId: string) => {
    if (!confirm('Are you sure you want to delete this draft?')) return

    try {
      const res = await fetch(`/api/forgestudio/drafts?draftId=${draftId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        fetchDrafts()
      }
    } catch (err) {
      console.error('Error deleting draft:', err)
    }
  }

  const handleSchedule = async (draftId: string, scheduledFor: string) => {
    try {
      const res = await fetch('/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, status: 'scheduled', scheduledFor })
      })

      if (res.ok) {
        fetchDrafts()
      }
    } catch (err) {
      console.error('Error scheduling draft:', err)
    }
  }

  const handlePublish = async (draftId: string) => {
    try {
      // First get the draft to find active connections
      const draft = drafts.find(d => d.id === draftId)
      if (!draft) return

      // Fetch connections for this property
      const connRes = await fetch(`/api/forgestudio/social/connections?propertyId=${propertyId}`)
      const connData = await connRes.json()
      
      const activeConnections = (connData.connections || [])
        .filter((c: { is_active: boolean; platform: string }) => c.is_active && c.platform === draft.platform)

      if (activeConnections.length === 0) {
        alert(`No active ${draft.platform} connection found. Please connect your account in the Connections tab.`)
        return
      }

      // Publish to all active connections for this platform
      const res = await fetch('/api/forgestudio/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          connectionIds: activeConnections.map((c: { id: string }) => c.id)
        })
      })

      if (res.ok) {
        fetchDrafts()
      } else {
        const data = await res.json()
        alert(data.error || 'Publishing failed')
      }
    } catch (err) {
      console.error('Error publishing draft:', err)
      alert('Publishing failed. Please try again.')
    }
  }

  const handleAttachMedia = (draft: ContentDraft) => {
    setSelectedDraftForMedia(draft)
    setShowAssetPicker(true)
  }

  const handleAssetSelected = async (asset: ContentAsset) => {
    if (!selectedDraftForMedia) return

    try {
      const res = await fetch('/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: selectedDraftForMedia.id,
          mediaUrls: [asset.file_url],
          mediaType: asset.asset_type,
          thumbnailUrl: asset.thumbnail_url || (asset.asset_type === 'image' ? asset.file_url : null)
        })
      })

      if (res.ok) {
        fetchDrafts()
        setShowAssetPicker(false)
        setSelectedDraftForMedia(null)
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to attach media')
      }
    } catch (err) {
      console.error('Error attaching media:', err)
      alert('Failed to attach media. Please try again.')
    }
  }

  const filteredDrafts = drafts.filter(draft =>
    draft.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
    draft.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Filters & Search */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Status Filters */}
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const Icon = filter.icon
              return (
                <button
                  key={filter.id}
                  onClick={() => setStatusFilter(filter.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === filter.id
                      ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {filter.label}
                </button>
              )
            })}
          </div>

          {/* Search & View Toggle */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search drafts..."
                className="pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm w-48"
              />
            </div>
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-600' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-600' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="text-sm text-slate-500">
        {loading ? 'Loading...' : `${filteredDrafts.length} of ${total} drafts`}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredDrafts.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <FileText className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            No drafts found
          </h3>
          <p className="text-slate-500">
            {searchQuery ? 'Try adjusting your search' : 'Generate some content to get started'}
          </p>
        </div>
      )}

      {/* Drafts Grid/List */}
      {!loading && !error && filteredDrafts.length > 0 && (
        <div className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-4'
        }>
          {filteredDrafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onApprove={handleApprove}
              onReject={handleReject}
              onEdit={onEditDraft}
              onDelete={handleDelete}
              onSchedule={handleSchedule}
              onPublish={handlePublish}
              onAttachMedia={handleAttachMedia}
            />
          ))}
        </div>
      )}

      {/* Asset Picker Modal */}
      {showAssetPicker && selectedDraftForMedia && (
        <AssetPickerModal
          propertyId={propertyId}
          onClose={() => {
            setShowAssetPicker(false)
            setSelectedDraftForMedia(null)
          }}
          onSelect={handleAssetSelected}
          title={selectedDraftForMedia.media_urls.length > 0 ? 'Change Media' : 'Attach Media'}
        />
      )}
    </div>
  )
}

