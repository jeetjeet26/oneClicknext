'use client'
import {Instagram,Facebook,Linkedin,Twitter} from '@/components/ui/BrandIcons'

import { useState, useEffect } from 'react'
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  FileText,
  Loader2,
  Wand2,
  ChevronDown,
  Copy,
  Check,
  RefreshCw,
  Hash,
  ArrowRight
} from 'lucide-react'

interface Template {
  id: string
  name: string
  description: string
  content_type: string
  platform: string[]
  variables: Array<{
    name: string
    type: string
    required?: boolean
    options?: string[]
  }>
}

interface GeneratedContent {
  caption: string
  hashtags: string[]
  callToAction: string
  variations: string[]
}

interface ContentGeneratorProps {
  propertyId: string
  onContentGenerated?: (draft: unknown) => void
}

const CONTENT_TYPES = [
  { id: 'social_post', label: 'Social Post', icon: FileText },
  { id: 'ad_copy', label: 'Ad Copy', icon: Sparkles },
  { id: 'email', label: 'Email', icon: FileText },
  { id: 'video_script', label: 'Video Script', icon: Video },
]

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: 'text-pink-500' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: 'text-blue-600' },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: 'text-blue-700' },
  { id: 'twitter', label: 'Twitter/X', icon: Twitter, color: 'text-slate-700' },
]

const MEDIA_STYLES = [
  { id: 'natural', label: 'Natural/Realistic' },
  { id: 'luxury', label: 'Luxury/Premium' },
  { id: 'modern', label: 'Modern/Minimalist' },
  { id: 'vibrant', label: 'Vibrant/Colorful' },
  { id: 'cozy', label: 'Cozy/Warm' },
]

export function ContentGenerator({ propertyId, onContentGenerated }: ContentGeneratorProps) {
  const [contentType, setContentType] = useState('social_post')
  const [platform, setPlatform] = useState<string>('instagram')
  const [topic, setTopic] = useState('')
  const [details, setDetails] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({})
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  
  // Media generation
  const [generateMedia, setGenerateMedia] = useState(false)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [mediaPrompt, setMediaPrompt] = useState('')
  const [mediaStyle, setMediaStyle] = useState('natural')
  
  // Generation state
  const [generating, setGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null)
  const [generatedMediaUrl, setGeneratedMediaUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  // Load templates
  useEffect(() => {
    async function fetchTemplates() {
      setLoadingTemplates(true)
      try {
        const res = await fetch(`/api/forgestudio/templates?propertyId=${propertyId}&contentType=${contentType}`)
        const data = await res.json()
        setTemplates(data.templates || [])
      } catch (err) {
        console.error('Error loading templates:', err)
      } finally {
        setLoadingTemplates(false)
      }
    }
    fetchTemplates()
  }, [propertyId, contentType])

  const handleGenerate = async () => {
    if (!topic && !selectedTemplate) {
      setError('Please enter a topic or select a template')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/forgestudio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          contentType,
          platform,
          templateId: selectedTemplate?.id,
          variables: selectedTemplate ? templateVariables : { topic, details },
          generateMedia,
          mediaType: generateMedia ? mediaType : undefined,
          mediaPrompt: generateMedia ? mediaPrompt : undefined,
          mediaStyle: generateMedia ? mediaStyle : undefined,
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Generation failed')
      }

      setGeneratedContent(data.content)
      if (data.draft?.media_urls?.[0]) {
        setGeneratedMediaUrl(data.draft.media_urls[0])
      }
      
      if (onContentGenerated) {
        onContentGenerated(data.draft)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRegenerate = () => {
    setGeneratedContent(null)
    setGeneratedMediaUrl(null)
    handleGenerate()
  }

  return (
    <div className="space-y-6">
      {/* Content Type Selection */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          What would you like to create?
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CONTENT_TYPES.map((type) => {
            const Icon = type.icon
            return (
              <button
                key={type.id}
                onClick={() => {
                  setContentType(type.id)
                  setSelectedTemplate(null)
                  setTemplateVariables({})
                }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  contentType === type.id
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-sm font-medium">{type.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Platform & Template Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Platform Selection */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Target Platform
          </h3>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon
              return (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                    platform === p.id
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${p.color}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {p.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Template Selection */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Use Template (Optional)
          </h3>
          <div className="relative">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="w-full flex items-center justify-between px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-slate-300"
            >
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {selectedTemplate?.name || 'Select a template...'}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
            </button>
            
            {showTemplates && (
              <div className="absolute z-10 mt-2 w-full bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600 shadow-lg max-h-60 overflow-y-auto">
                <button
                  onClick={() => {
                    setSelectedTemplate(null)
                    setTemplateVariables({})
                    setShowTemplates(false)
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  No template (free-form)
                </button>
                {loadingTemplates ? (
                  <div className="px-4 py-3 text-sm text-slate-500">Loading...</div>
                ) : templates.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-500">No templates available</div>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTemplate(t)
                        setTemplateVariables({})
                        setShowTemplates(false)
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.description}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Topic/Variables Input */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        {selectedTemplate ? (
          // Template Variables
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Fill in the template variables
            </h3>
            {selectedTemplate.variables.map((v) => (
              <div key={v.name}>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {v.name.replace(/_/g, ' ')}
                  {v.required && <span className="text-red-500">*</span>}
                </label>
                {v.type === 'select' && v.options ? (
                  <select
                    value={templateVariables[v.name] || ''}
                    onChange={(e) => setTemplateVariables({ ...templateVariables, [v.name]: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  >
                    <option value="">Select...</option>
                    {v.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={templateVariables[v.name] || ''}
                    onChange={(e) => setTemplateVariables({ ...templateVariables, [v.name]: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    placeholder={`Enter ${v.name.replace(/_/g, ' ')}`}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          // Free-form input
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Topic or Theme <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g., Summer pool party, Move-in special, Pet-friendly living"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Additional Details (Optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                placeholder="Add any specific details, promotions, or context..."
              />
            </div>
          </div>
        )}
      </div>

      {/* Media Generation Toggle */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 rounded-xl border border-amber-200 dark:border-amber-500/20 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">
                AI Media Generation
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Powered by Google Gemini AI
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={generateMedia}
              onChange={(e) => setGenerateMedia(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 dark:peer-focus:ring-amber-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-amber-500 peer-checked:to-orange-600"></div>
          </label>
        </div>

        {generateMedia && (
          <div className="space-y-4 pt-4 border-t border-amber-200 dark:border-amber-500/20">
            {/* Media Type */}
            <div className="flex gap-3">
              <button
                onClick={() => setMediaType('image')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 transition-all ${
                  mediaType === 'image'
                    ? 'border-amber-500 bg-amber-100 dark:bg-amber-500/20'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <ImageIcon className="w-5 h-5" />
                <span className="font-medium">Image</span>
              </button>
              <button
                onClick={() => setMediaType('video')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 transition-all ${
                  mediaType === 'video'
                    ? 'border-amber-500 bg-amber-100 dark:bg-amber-500/20'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <Video className="w-5 h-5" />
                <span className="font-medium">Video</span>
              </button>
            </div>

            {/* Media Prompt */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Describe your {mediaType}
              </label>
              <textarea
                value={mediaPrompt}
                onChange={(e) => setMediaPrompt(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                placeholder={`e.g., Modern apartment pool area with people enjoying summer vibes, golden hour lighting`}
              />
            </div>

            {/* Style Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Visual Style
              </label>
              <div className="flex flex-wrap gap-2">
                {MEDIA_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setMediaStyle(s.id)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      mediaStyle === s.id
                        ? 'bg-amber-500 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={generating || (!topic && !selectedTemplate)}
        className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Generating {generateMedia ? `content & ${mediaType}` : 'content'}...
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            Generate Content
          </>
        )}
      </button>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Generated Content Preview */}
      {generatedContent && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" />
                Generated Content
              </h3>
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-500/10 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Generated Media */}
            {generatedMediaUrl && (
              <div className="relative rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700">
                {mediaType === 'video' ? (
                  <video
                    src={generatedMediaUrl}
                    controls
                    className="w-full aspect-video object-cover"
                  />
                ) : (
                  <img
                    src={generatedMediaUrl}
                    alt="Generated content"
                    className="w-full aspect-square object-cover"
                  />
                )}
                <div className="absolute top-3 right-3 px-2 py-1 bg-black/50 text-white text-xs rounded-lg">
                  AI Generated
                </div>
              </div>
            )}

            {/* Caption */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Caption
                </label>
                <button
                  onClick={() => handleCopy(generatedContent.caption, 'caption')}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-violet-600"
                >
                  {copied === 'caption' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'caption' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-700 rounded-lg text-slate-900 dark:text-white whitespace-pre-wrap">
                {generatedContent.caption}
              </div>
            </div>

            {/* Hashtags */}
            {generatedContent.hashtags.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Hash className="w-4 h-4" />
                    Hashtags
                  </label>
                  <button
                    onClick={() => handleCopy(generatedContent.hashtags.map(h => `#${h}`).join(' '), 'hashtags')}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-violet-600"
                  >
                    {copied === 'hashtags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'hashtags' ? 'Copied!' : 'Copy all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {generatedContent.hashtags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-3 py-1 bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 rounded-full text-sm"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            {generatedContent.callToAction && (
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1 mb-2">
                  <ArrowRight className="w-4 h-4" />
                  Call to Action
                </label>
                <div className="p-3 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-500/10 dark:to-purple-500/10 border border-violet-200 dark:border-violet-500/20 rounded-lg text-violet-700 dark:text-violet-300 font-medium">
                  {generatedContent.callToAction}
                </div>
              </div>
            )}

            {/* Variations */}
            {generatedContent.variations.length > 0 && (
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                  Alternative Variations
                </label>
                <div className="space-y-2">
                  {generatedContent.variations.map((variation, i) => (
                    <div
                      key={i}
                      className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-300 flex justify-between items-start gap-2"
                    >
                      <span>{variation}</span>
                      <button
                        onClick={() => handleCopy(variation, `variation-${i}`)}
                        className="flex-shrink-0 text-slate-400 hover:text-violet-600"
                      >
                        {copied === `variation-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

