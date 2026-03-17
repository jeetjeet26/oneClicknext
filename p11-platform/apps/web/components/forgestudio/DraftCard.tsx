'use client'

import { useState } from 'react'
import {
  MoreVertical,
  Edit2,
  Trash2,
  Calendar,
  Check,
  X,
  Clock,
  Instagram,
  Facebook,
  Linkedin,
  Twitter,
  FileText,
  Video,
  Image as ImageIcon,
  Sparkles,
  Send,
  Loader2,
  ImagePlus,
  Replace
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
  generation_params?: {
    readiness?: {
      state?: string
      blockers?: string[]
    }
  }
}

interface DraftCardProps {
  draft: ContentDraft
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onEdit?: (draft: ContentDraft) => void
  onDelete?: (id: string) => void
  onSchedule?: (id: string, date: string) => void
  onPublish?: (id: string) => void
  onAttachMedia?: (draft: ContentDraft) => void
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Draft' },
  draft_partial: { bg: 'bg-orange-100 dark:bg-orange-500/20', text: 'text-orange-700 dark:text-orange-300', label: 'Partial Draft' },
  generating: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Generating' },
  pending_review: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', label: 'Ready for Review' },
  approved: { bg: 'bg-green-100 dark:bg-green-500/20', text: 'text-green-600 dark:text-green-400', label: 'Approved' },
  scheduled: { bg: 'bg-violet-100 dark:bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400', label: 'Scheduled' },
  published: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Published' },
  rejected: { bg: 'bg-red-100 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
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

export function DraftCard({ draft, onApprove, onReject, onEdit, onDelete, onSchedule, onPublish, onAttachMedia }: DraftCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [publishing, setPublishing] = useState(false)

  const statusStyle = STATUS_STYLES[draft.status] || STATUS_STYLES.draft
  const readinessBlockers = Array.isArray(draft.generation_params?.readiness?.blockers)
    ? draft.generation_params?.readiness?.blockers || []
    : []
  const PlatformIcon = PLATFORM_ICONS[draft.platform] || FileText
  const platformColor = PLATFORM_COLORS[draft.platform] || 'text-slate-500'

  const handleSchedule = () => {
    if (scheduleDate && onSchedule) {
      onSchedule(draft.id, scheduleDate)
      setShowScheduler(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow">
      {/* Media Preview */}
      {draft.media_urls.length > 0 ? (
        <div className="relative aspect-video bg-slate-100 dark:bg-slate-700">
          {draft.media_type === 'video' ? (
            <video
              src={draft.media_urls[0]}
              className="w-full h-full object-cover"
              muted
            />
          ) : (
            <img
              src={draft.thumbnail_url || draft.media_urls[0]}
              alt={draft.title}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute top-2 left-2 flex items-center gap-2">
            {draft.media_type === 'video' ? (
              <span className="px-2 py-1 bg-black/50 text-white text-xs rounded-lg flex items-center gap-1">
                <Video className="w-3 h-3" /> Video
              </span>
            ) : (
              <span className="px-2 py-1 bg-black/50 text-white text-xs rounded-lg flex items-center gap-1">
                <ImageIcon className="w-3 h-3" /> Image
              </span>
            )}
            <span className="px-2 py-1 bg-violet-500/80 text-white text-xs rounded-lg flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> AI
            </span>
          </div>
        </div>
      ) : (
        /* No Media - Show Add Media Button */
        <button
          onClick={() => onAttachMedia?.(draft)}
          className="relative aspect-video bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-700 dark:to-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-violet-400 dark:hover:border-violet-500 transition-colors group flex flex-col items-center justify-center gap-2"
        >
          <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <ImagePlus className="w-6 h-6 text-violet-500" />
          </div>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400">
            Attach Media from Library
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Add an image or video to this post
          </span>
        </button>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700`}>
              <PlatformIcon className={`w-4 h-4 ${platformColor}`} />
            </div>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
          
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <MoreVertical className="w-4 h-4 text-slate-400" />
            </button>
            
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 mt-1 z-20 w-44 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600 shadow-lg py-1">
                  <button
                    onClick={() => { onEdit?.(draft); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" /> Edit
                  </button>
                  <button
                    onClick={() => { onAttachMedia?.(draft); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 text-violet-600 dark:text-violet-400"
                  >
                    {draft.media_urls.length > 0 ? (
                      <><Replace className="w-4 h-4" /> Change Media</>
                    ) : (
                      <><ImagePlus className="w-4 h-4" /> Attach Media</>
                    )}
                  </button>
                  <button
                    onClick={() => { setShowScheduler(true); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <Calendar className="w-4 h-4" /> Schedule
                  </button>
                  <hr className="my-1 border-slate-200 dark:border-slate-700" />
                  <button
                    onClick={() => { onDelete?.(draft.id); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Content Preview */}
        <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3 mb-3">
          {draft.caption}
        </p>

        {/* Hashtags */}
        {draft.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {draft.hashtags.slice(0, 4).map((tag, i) => (
              <span key={i} className="text-xs text-violet-600 dark:text-violet-400">
                #{tag}
              </span>
            ))}
            {draft.hashtags.length > 4 && (
              <span className="text-xs text-slate-400">
                +{draft.hashtags.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Scheduled Time */}
        {draft.scheduled_for && (
          <div className="flex items-center gap-1 text-xs text-slate-500 mb-3">
            <Clock className="w-3 h-3" />
            Scheduled for {new Date(draft.scheduled_for).toLocaleDateString()} at{' '}
            {new Date(draft.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Actions */}
        {(draft.status === 'draft' || draft.status === 'draft_partial' || draft.status === 'pending_review') && (
          <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => onApprove?.(draft.id)}
              disabled={draft.status !== 'pending_review'}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={() => onReject?.(draft.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded-lg transition-colors"
            >
              <X className="w-4 h-4" /> Reject
            </button>
          </div>
        )}

        {draft.status === 'draft_partial' && readinessBlockers.length > 0 && (
          <div className="mt-2 rounded-lg bg-orange-50 px-2.5 py-2 text-xs text-orange-700 dark:bg-orange-500/10 dark:text-orange-300">
            Missing: {readinessBlockers.slice(0, 3).join(', ')}
          </div>
        )}

        {/* Publish Action for Approved */}
        {draft.status === 'approved' && (
          <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={async () => {
                setPublishing(true)
                await onPublish?.(draft.id)
                setPublishing(false)
              }}
              disabled={publishing}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {publishing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Publishing...</>
              ) : (
                <><Send className="w-4 h-4" /> Publish Now</>
              )}
            </button>
            <button
              onClick={() => setShowScheduler(true)}
              className="flex items-center justify-center gap-1 px-4 py-2 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Schedule Post
            </h3>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowScheduler(false)}
                className="flex-1 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!scheduleDate}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

