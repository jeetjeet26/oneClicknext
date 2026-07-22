'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Clock, FileEdit, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { BriefBuilder } from './BriefBuilder'
import { ReviewStudio } from './ReviewStudio'

interface PackageSummary {
  id: string
  status: string
  concept_summary: string | null
  created_at: string
  currentRevision: {
    id: string
    revision_number: number
    approval_status: string
  } | null
  variants: Array<{ platform: string }>
  publications: Array<{ status: string }>
}

interface CampaignWorkspaceProps {
  propertyId: string
}

const PACKAGE_STATUS: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600', icon: FileEdit },
  in_review: { label: 'Awaiting review', className: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700', icon: CheckCircle },
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700', icon: Clock },
  published: { label: 'Published', className: 'bg-green-100 text-green-700', icon: CheckCircle },
  archived: { label: 'Archived', className: 'bg-slate-100 text-slate-500', icon: XCircle },
}

export function CampaignWorkspace({ propertyId }: CampaignWorkspaceProps) {
  const [packages, setPackages] = useState<PackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [openPackageId, setOpenPackageId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/forgestudio/packages?propertyId=${propertyId}`)
      const data = await res.json()
      if (res.ok) setPackages(data.packages || [])
    } catch {
      // Non-fatal; the list simply stays empty.
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <BriefBuilder
        propertyId={propertyId}
        onGenerated={({ packageId }) => {
          load()
          setOpenPackageId(packageId)
        }}
      />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Campaigns</h3>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
          </div>
        ) : packages.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-6 text-center">
            No campaigns yet — write a brief above to generate your first coordinated,
            channel-specific drafts.
          </p>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => {
              const status = PACKAGE_STATUS[pkg.status] ?? PACKAGE_STATUS.draft
              const StatusIcon = status.icon
              const publishedCount = pkg.publications.filter(
                (publication) => publication.status === 'published'
              ).length
              return (
                <button
                  key={pkg.id}
                  onClick={() => setOpenPackageId(pkg.id)}
                  className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-violet-300 dark:hover:border-violet-500/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {pkg.concept_summary || 'Untitled concept'}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>
                          Rev {pkg.currentRevision?.revision_number ?? '—'} ·{' '}
                          {pkg.currentRevision?.approval_status ?? 'none'}
                        </span>
                        <span className="capitalize">
                          {pkg.variants.map((variant) => variant.platform).join(', ')}
                        </span>
                        {pkg.publications.length > 0 && (
                          <span>
                            {publishedCount}/{pkg.publications.length} published
                          </span>
                        )}
                        <span>{new Date(pkg.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full flex-shrink-0 ${status.className}`}
                    >
                      <StatusIcon className="w-3 h-3" />
                      {status.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {openPackageId && (
        <ReviewStudio
          propertyId={propertyId}
          packageId={openPackageId}
          onClose={() => setOpenPackageId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
