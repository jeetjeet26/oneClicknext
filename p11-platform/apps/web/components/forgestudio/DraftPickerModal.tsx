'use client'
import {Instagram,Facebook,Linkedin,Twitter} from '@/components/ui/BrandIcons'

import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Loader2,
  Search,
  FileText,
  Check,
  Clock,
  Image as ImageIcon,
  Video,
  Sparkles
} from 'lucide-react'

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
}

interface DraftPickerModalProps {
  propertyId: string
  onClose: () => void
  onSelect: (draft: ContentDraft) => void
  title?: string
  assetPreview?: {
    type: 'image' | 'video'
    url: string
    name: string
  }
}

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  twitter: Twitter,
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'text-pink-500',
  facebook: 'text-blue-600',
  linkedin: 'text-blue-700',
  twitter: 'text-slate-700 dark:text-slate-300',
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Draft' },
  generating: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Generating' },
  pending_review: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { bg: 'bg-green-100 dark:bg-green-500/20', text: 'text-green-600 dark:text-green-400', label: 'Approved' },
  scheduled: { bg: 'bg-violet-100 dark:bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400', label: 'Scheduled' },
  published: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Published' },
  rejected: { bg: 'bg-red-100 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
}

export function DraftPickerModal({
  propertyId,
  onClose,
  onSelect,
  title = 'Select a Draft',
  assetPreview
}: DraftPickerModalProps) {
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDraft, setSelectedDraft] = useState<ContentDraft | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ propertyId })
      const res = await fetch(`/api/forgestudio/drafts?${params}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch drafts')
      }

      // Filter out published posts - only show drafts that can still be edited
      const editableDrafts = (data.drafts || []).filter(
        (d: ContentDraft) => !['published'].includes(d.status)
      )
      setDrafts(editableDrafts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  const filteredDrafts = drafts.filter(draft =>
    draft.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
    draft.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleConfirm = () => {
    if (selectedDraft) {
      onSelect(selectedDraft)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col shadow-2xl border border-slate-200 dark:border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-violet-500" />
              {title}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Choose which draft to add this asset to
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Asset Preview */}
        {assetPreview && (
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                {assetPreview.type === 'video' ? (
                  <video src={assetPreview.url} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={assetPreview.url} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {assetPreview.name}
                </p>
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  {assetPreview.type === 'video' ? (
                    <><Video className="w-3 h-3" /> Video</>
                  ) : (
                    <><ImageIcon className="w-3 h-3" /> Image</>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search drafts..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
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
            <div className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                No drafts found
              </h3>
              <p className="text-slate-500">
                {searchQuery ? 'Try adjusting your search' : 'Create a social post first in the Create tab'}
              </p>
            </div>
          )}

          {/* Drafts List */}
          {!loading && !error && filteredDrafts.length > 0 && (
            <div className="space-y-3">
              {filteredDrafts.map((draft) => {
                const isSelected = selectedDraft?.id === draft.id
                const PlatformIcon = PLATFORM_ICONS[draft.platform] || FileText
                const platformColor = PLATFORM_COLORS[draft.platform] || 'text-slate-500'
                const statusStyle = STATUS_STYLES[draft.status] || STATUS_STYLES.draft
                const hasMedia = draft.media_urls.length > 0

                return (
                  <div
                    key={draft.id}
                    onClick={() => setSelectedDraft(draft)}
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-violet-500 ring-2 ring-violet-500/20 bg-violet-50 dark:bg-violet-500/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-500/50 bg-white dark:bg-slate-800'
                    }`}
                  >
                    {/* Selection Indicator */}
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-6 h-6 bg-violet-500 rounded-full flex items-center justify-center shadow-lg">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}

                    <div className="flex items-start gap-3">
                      {/* Thumbnail or Platform Icon */}
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 flex-shrink-0 flex items-center justify-center">
                        {hasMedia ? (
                          draft.media_type === 'video' ? (
                            <video src={draft.media_urls[0]} className="w-full h-full object-cover" muted />
                          ) : (
                            <img src={draft.thumbnail_url || draft.media_urls[0]} alt="" className="w-full h-full object-cover" />
                          )
                        ) : (
                          <PlatformIcon className={`w-6 h-6 ${platformColor}`} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <PlatformIcon className={`w-4 h-4 ${platformColor}`} />
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                            {statusStyle.label}
                          </span>
                          {hasMedia && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                              {draft.media_type === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                              Has media
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                          {draft.caption}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Created {new Date(draft.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="text-sm text-slate-500">
            {selectedDraft ? (
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                Selected draft
              </span>
            ) : (
              'Click a draft to select it'
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedDraft}
              className="px-5 py-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25"
            >
              Add to Draft
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

