'use client'

import { useEffect, useState } from 'react'
import {
  X,
  Image as ImageIcon,
  Video,
  Wand2,
  Loader2,
  Sparkles,
  Check
} from 'lucide-react'

interface AssetGeneratorModalProps {
  propertyId: string
  onClose: () => void
  onGenerated: () => void
}

const GENERATION_TYPES = [
  { id: 'text-to-image', label: 'Text to Image', icon: ImageIcon, description: 'Generate image from text prompt', disabled: false },
  { id: 'image-to-image', label: 'Image to Image', icon: ImageIcon, description: 'Transform existing image', disabled: false },
  { id: 'text-to-video', label: 'Text to Video', icon: Video, description: 'Generate video from text (Veo)', disabled: false },
  { id: 'image-to-video', label: 'Image to Video', icon: Video, description: 'Animate an image (Veo)', disabled: false },
]

const STYLES = [
  { id: 'natural', label: 'Natural/Realistic' },
  { id: 'luxury', label: 'Luxury/Premium' },
  { id: 'modern', label: 'Modern/Minimalist' },
  { id: 'vibrant', label: 'Vibrant/Colorful' },
  { id: 'cozy', label: 'Cozy/Warm' },
  { id: 'professional', label: 'Professional/Corporate' },
]

const ASPECT_RATIOS = [
  { id: '1:1', label: 'Square (1:1)' },
  { id: '3:4', label: 'Portrait (3:4)' },
  { id: '16:9', label: 'Landscape (16:9)' },
  { id: '9:16', label: 'Stories (9:16)' },
]

interface SourceAsset {
  id: string
  name: string
  file_url: string
  thumbnail_url: string | null
  asset_type: string
  approval_status: string
  curation_status: string
  rights_status: string
}

export function AssetGeneratorModal({ propertyId, onClose, onGenerated }: AssetGeneratorModalProps) {
  const [generationType, setGenerationType] = useState('text-to-image')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [style, setStyle] = useState('natural')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [quality, setQuality] = useState<'standard' | 'high'>('high')
  const [sourceAssetId, setSourceAssetId] = useState('')
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([])
  const [saveName, setSaveName] = useState('')
  
  // Video-specific settings (Veo 3)
  const [videoDuration, setVideoDuration] = useState<4 | 8>(8)
  const [includeAudio, setIncludeAudio] = useState(true)
  
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const needsSourceImage = generationType === 'image-to-image' || generationType === 'image-to-video'
  const isVideoGeneration = generationType === 'text-to-video' || generationType === 'image-to-video'

  useEffect(() => {
    if (!needsSourceImage) return
    let cancelled = false
    fetch(`/api/forgestudio/assets?propertyId=${propertyId}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return
        setSourceAssets((data.assets ?? []).filter((asset: SourceAsset) =>
          asset.asset_type === 'image' &&
          asset.approval_status === 'approved' &&
          ['approved', 'selected', 'in_use'].includes(asset.curation_status) &&
          ['owned', 'licensed', 'generated'].includes(asset.rights_status)
        ))
      })
      .catch(() => setSourceAssets([]))
    return () => {
      cancelled = true
    }
  }, [needsSourceImage, propertyId])

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    const poll = async () => {
      const response = await fetch(`/api/forgestudio/media-jobs?propertyId=${propertyId}`)
      const data = await response.json()
      if (!response.ok || cancelled) return
      const job = (data.jobs ?? []).find((candidate: { id: string }) => candidate.id === jobId)
      if (!job) return
      if (job.lifecycle_status === 'succeeded' && job.output?.publicUrl) {
        setGeneratedUrl(job.output.publicUrl)
        setGenerating(false)
        setJobId(null)
        onGenerated()
      } else if (['failed', 'cancelled'].includes(job.lifecycle_status)) {
        setError(job.error_message || `Generation ${job.lifecycle_status}`)
        setGenerating(false)
        setJobId(null)
      }
    }
    poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [jobId, onGenerated, propertyId])

  const handleGenerate = async () => {
    if (!prompt) {
      setError('Please enter a prompt')
      return
    }

    if (needsSourceImage && !sourceAssetId) {
      setError('Please select an approved, rights-cleared source image')
      return
    }

    setGenerating(true)
    setError(null)
    setGeneratedUrl(null)

    try {
      const promptWithDirection = [
        prompt,
        `Visual direction: ${style}.`,
        negativePrompt ? `Avoid: ${negativePrompt}.` : '',
        'Do not invent property features, finishes, views, people, pricing, or availability.',
      ].filter(Boolean).join(' ')
      const res = await fetch('/api/forgestudio/media-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          modality: isVideoGeneration ? 'video' : 'image',
          prompt: promptWithDirection,
          tier: isVideoGeneration
            ? quality === 'high' ? 'social' : 'preview'
            : needsSourceImage ? 'iterative' : quality === 'high' ? 'final' : 'draft',
          sourceAssetId: needsSourceImage ? sourceAssetId : undefined,
          aspectRatio,
          name: saveName || `ForgeStudio ${isVideoGeneration ? 'video' : 'image'}`,
          altText: prompt.slice(0, 1000),
          maxCostUsd: isVideoGeneration ? 5 : 0.25,
          ...(isVideoGeneration
            ? { durationSeconds: videoDuration, generateAudio: includeAudio }
            : {}),
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Generation failed')
      }

      setJobId(data.job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                AI Asset Generator
              </h2>
              <p className="text-sm text-slate-500">Governed by Vercel AI Gateway model policy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Generation Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Generation Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {GENERATION_TYPES.map((type) => {
                const Icon = type.icon
                return (
                  <button
                    key={type.id}
                    onClick={() => !type.disabled && setGenerationType(type.id)}
                    disabled={type.disabled}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                      type.disabled
                        ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 opacity-60 cursor-not-allowed'
                        : generationType === type.id
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${type.disabled ? 'text-slate-300' : generationType === type.id ? 'text-amber-600' : 'text-slate-400'}`} />
                    <div>
                      <div className={`font-medium text-sm ${type.disabled ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                        {type.label}
                      </div>
                      <div className={`text-xs ${type.disabled ? 'text-slate-400' : 'text-slate-500'}`}>{type.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Rights-cleared source image (for image-to-* types) */}
          {needsSourceImage && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Approved source image <span className="text-red-500">*</span>
              </label>
              <select
                value={sourceAssetId}
                onChange={(e) => setSourceAssetId(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                <option value="">Select an approved asset</option>
                {sourceAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
              </select>
              {sourceAssetId && (
                <div className="mt-2 rounded-lg overflow-hidden w-32 h-32">
                  <img
                    src={
                      sourceAssets.find((asset) => asset.id === sourceAssetId)?.thumbnail_url ||
                      sourceAssets.find((asset) => asset.id === sourceAssetId)?.file_url
                    }
                    alt="Selected approved source"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Prompt <span className="text-red-500">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
              placeholder="Describe what you want to generate..."
            />
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Negative Prompt (Optional)
            </label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="What to avoid in the generation..."
            />
          </div>

          {/* Video Duration (only for video generation) */}
          {isVideoGeneration && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                Video Duration
                <span className="ml-2 text-xs text-slate-500">
                  (estimated from the selected Gateway tier)
                </span>
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[4, 8].map((duration) => (
                  <button
                    key={duration}
                    onClick={() => setVideoDuration(duration as 4 | 8)}
                    className={`py-3 rounded-lg border-2 transition-all ${
                      videoDuration === duration
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className={`font-semibold ${videoDuration === duration ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {duration}s
                    </div>
                    <div className="text-xs text-slate-500">
                      up to ${(duration * (quality === 'high' ? (includeAudio ? 0.15 : 0.1) : (includeAudio ? 0.05 : 0.03))).toFixed(2)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Audio Generation Toggle (only for video generation) */}
          {isVideoGeneration && (
            <div>
              <label className="flex items-center justify-between p-4 rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-slate-300 transition-all cursor-pointer">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    Include Audio Generation
                  </div>
                  <div className="text-sm text-slate-500">
                    Generate synchronized sound effects, dialogue, and music (Veo 3)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={(e) => setIncludeAudio(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
              </label>
            </div>
          )}

          {/* Style & Options Row */}
          <div>
            {/* Style */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Style
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                {STYLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Aspect Ratio */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                {ASPECT_RATIOS.map((ar) => (
                  <option key={ar.id} value={ar.id}>{ar.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Quality */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Quality
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setQuality('standard')}
                className={`flex-1 py-2 rounded-lg border-2 transition-all ${
                  quality === 'standard'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                Standard
              </button>
              <button
                onClick={() => setQuality('high')}
                className={`flex-1 py-2 rounded-lg border-2 transition-all ${
                  quality === 'high'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                High Quality
              </button>
            </div>
          </div>

          {/* Save Options */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Save As (Optional)
              </label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="Asset name"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          {jobId && (
            <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generation is running as a durable job. You may close this window and return later.
            </div>
          )}

          {/* Generated Result */}
          {generatedUrl && (
            <div className="p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-3">
                <Check className="w-5 h-5" />
                <span className="font-medium">Asset generated and saved!</span>
              </div>
              <div className="rounded-xl overflow-hidden">
                {generationType.includes('video') ? (
                  <video src={generatedUrl} controls className="w-full" />
                ) : (
                  <img src={generatedUrl} alt="Generated" className="w-full" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {generatedUrl ? 'Done' : 'Cancel'}
          </button>
          {!generatedUrl && (
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/25"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

