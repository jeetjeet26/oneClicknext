'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  Link2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { AssetPickerModal } from './AssetPickerModal'

const CHANNELS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' },
] as const

type ChannelId = (typeof CHANNELS)[number]['id']

interface Connection {
  id: string
  platform: string
  account_name: string
  account_username: string | null
  is_active: boolean
}

interface SourceFact {
  text: string
  source?: string
}

interface BriefBuilderProps {
  propertyId: string
  onGenerated: (result: { packageId: string; revisionId: string }) => void
}

/** Normalize legacy 'twitter' connections onto the 'x' channel. */
function channelForConnection(platform: string): ChannelId | null {
  const normalized = platform === 'twitter' ? 'x' : platform
  return CHANNELS.some((channel) => channel.id === normalized)
    ? (normalized as ChannelId)
    : null
}

export function BriefBuilder({ propertyId, onGenerated }: BriefBuilderProps) {
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [facts, setFacts] = useState<SourceFact[]>([])
  const [factDraft, setFactDraft] = useState('')
  const [mustAvoid, setMustAvoid] = useState('')
  const [selectedConnections, setSelectedConnections] = useState<string[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  const [connections, setConnections] = useState<Connection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimWarnings, setClaimWarnings] = useState<Array<{ type: string; text: string }>>([])

  useEffect(() => {
    let cancelled = false
    setLoadingConnections(true)
    fetch(`/api/forgestudio/social/connections?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setConnections(
          (data.connections || []).filter(
            (conn: Connection) => conn.is_active && channelForConnection(conn.platform)
          )
        )
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingConnections(false))
    return () => {
      cancelled = true
    }
  }, [propertyId])

  const selectedChannels = [
    ...new Set(
      selectedConnections
        .map((id) => connections.find((conn) => conn.id === id))
        .map((conn) => (conn ? channelForConnection(conn.platform) : null))
        .filter((channel): channel is ChannelId => Boolean(channel))
    ),
  ]

  const addFact = () => {
    const text = factDraft.trim()
    if (!text) return
    setFacts((prev) => [...prev, { text, source: 'operator' }])
    setFactDraft('')
  }

  const canGenerate =
    title.trim().length > 0 &&
    objective.trim().length > 0 &&
    selectedConnections.length > 0 &&
    !generating

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerating(true)
    setError(null)
    setClaimWarnings([])

    try {
      // 1. Create the brief.
      const briefRes = await fetch('/api/forgestudio/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          title: title.trim(),
          objective: objective.trim(),
          topic: topic.trim() || null,
          audience: audience.trim() || null,
          sourceFacts: facts,
          constraints: mustAvoid.trim()
            ? { mustAvoid: mustAvoid.split(';').map((item) => item.trim()).filter(Boolean) }
            : {},
          channels: selectedChannels,
          connectionIds: selectedConnections,
          assetIds: selectedAssetIds,
        }),
      })
      const briefData = await briefRes.json()
      if (!briefRes.ok) {
        throw new Error(briefData.error || 'Failed to create brief')
      }

      // 2. Generate the package from the brief.
      const generateRes = await fetch(`/api/forgestudio/briefs/${briefData.brief.id}/generate`, {
        method: 'POST',
      })
      const generateData = await generateRes.json()
      if (!generateRes.ok) {
        if (generateRes.status === 422 && generateData.unsupportedClaims) {
          setClaimWarnings(generateData.unsupportedClaims)
          throw new Error(
            'Generation was blocked because it required facts without a trusted source. Add the missing facts above and try again.'
          )
        }
        throw new Error(generateData.error || 'Generation failed')
      }

      onGenerated({
        packageId: generateData.package.id,
        revisionId: generateData.revision.id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">New Campaign Brief</h3>
        <p className="text-sm text-slate-500">
          You control the facts, assets, destinations, and timing. The AI drafts channel-specific
          copy from trusted sources only — nothing publishes without your approval.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p>{error}</p>
            {claimWarnings.length > 0 && (
              <ul className="mt-2 list-disc list-inside">
                {claimWarnings.map((claim, index) => (
                  <li key={index}>
                    <span className="font-medium">{claim.type}:</span> {claim.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Campaign title *
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="August pool season push"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Topic / theme
          </label>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Resort-style pool at golden hour"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Objective *
        </label>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="Drive tour bookings from young professionals moving this fall"
          rows={2}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Audience
          </label>
          <input
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="Young professionals, pet owners"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Avoid (separate with ;)
          </label>
          <input
            value={mustAvoid}
            onChange={(event) => setMustAvoid(event.target.value)}
            placeholder="specific rent amounts; competitor names"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
          />
        </div>
      </div>

      {/* Source facts */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Approved facts the AI may use
        </label>
        <p className="text-xs text-slate-500 mb-2">
          Pricing, specials, availability, or testimonials will only be mentioned if you list them
          here or they exist in your knowledge base.
        </p>
        <div className="flex gap-2">
          <input
            value={factDraft}
            onChange={(event) => setFactDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addFact()
              }
            }}
            placeholder="One month free on 12-month leases signed in August"
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
          />
          <button
            onClick={addFact}
            className="px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {facts.length > 0 && (
          <ul className="mt-2 space-y-1">
            {facts.map((fact, index) => (
              <li
                key={index}
                className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300"
              >
                <span>{fact.text}</span>
                <button
                  onClick={() => setFacts((prev) => prev.filter((_, i) => i !== index))}
                  className="text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Destinations */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Destinations *
        </label>
        {loadingConnections ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading connected accounts…
          </div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Link2 className="w-4 h-4" />
            No active social connections. Connect accounts in the Connections tab first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {connections.map((connection) => {
              const selected = selectedConnections.includes(connection.id)
              const channel = channelForConnection(connection.platform)
              return (
                <button
                  key={connection.id}
                  onClick={() =>
                    setSelectedConnections((prev) =>
                      selected
                        ? prev.filter((id) => id !== connection.id)
                        : [...prev, connection.id]
                    )
                  }
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    selected
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-violet-400'
                  }`}
                >
                  {channel} · {connection.account_username || connection.account_name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Assets */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Community assets
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAssetPicker(true)}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Select photos / videos
          </button>
          {selectedAssetIds.length > 0 && (
            <span className="text-sm text-slate-500 flex items-center gap-1">
              {selectedAssetIds.length} selected
              <button
                onClick={() => setSelectedAssetIds([])}
                className="text-slate-400 hover:text-red-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Instagram and TikTok require media — select at least one image or video for those
          channels.
        </p>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
            canGenerate
              ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:opacity-90'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
          }`}
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Generating channel drafts…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" /> Generate for review
            </>
          )}
        </button>
      </div>

      {showAssetPicker && (
        <AssetPickerModal
          propertyId={propertyId}
          title="Add community asset"
          onClose={() => setShowAssetPicker(false)}
          onSelect={(asset) => {
            setSelectedAssetIds((prev) =>
              prev.includes(asset.id) ? prev : [...prev, asset.id]
            )
            setShowAssetPicker(false)
          }}
        />
      )}

      <p className="text-xs text-slate-400 flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        Scheduling happens after you approve the generated revision in the review studio.
      </p>
    </div>
  )
}
