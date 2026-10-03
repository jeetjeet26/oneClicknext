'use client'
import {Instagram,Facebook,Linkedin} from '@/components/ui/BrandIcons'

import { useState, useEffect } from 'react'
import { FileText, Sparkles, Video, Mail, Loader2 } from 'lucide-react'

interface Template {
  id: string
  name: string
  description: string
  content_type: string
  platform: string[]
  prompt_template: string
  variables: Array<{ name: string; type: string; required?: boolean; options?: string[] }>
  sample_output: string | null
}

interface TemplateSelectorProps {
  propertyId: string
  contentType?: string
  onSelect: (template: Template) => void
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  social_post: Instagram,
  ad_copy: Sparkles,
  email: Mail,
  video_script: Video,
  blog_post: FileText,
}

const TYPE_COLORS: Record<string, string> = {
  social_post: 'text-pink-500 bg-pink-50 dark:bg-pink-500/10',
  ad_copy: 'text-violet-500 bg-violet-50 dark:bg-violet-500/10',
  email: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10',
  video_script: 'text-red-500 bg-red-50 dark:bg-red-500/10',
  blog_post: 'text-green-500 bg-green-50 dark:bg-green-500/10',
}

export function TemplateSelector({ propertyId, contentType, onSelect }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState(contentType || 'all')

  useEffect(() => {
    async function fetchTemplates() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ propertyId })
        if (selectedType !== 'all') {
          params.append('contentType', selectedType)
        }
        
        const res = await fetch(`/api/forgestudio/templates?${params}`)
        const data = await res.json()
        setTemplates(data.templates || [])
      } catch (err) {
        console.error('Error loading templates:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchTemplates()
  }, [propertyId, selectedType])

  const contentTypes = ['all', 'social_post', 'ad_copy', 'email', 'video_script']

  return (
    <div className="space-y-4">
      {/* Type Filters */}
      <div className="flex flex-wrap gap-2">
        {contentTypes.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selectedType === type
                ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {type === 'all' ? 'All' : type.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
        </div>
      )}

      {/* Templates Grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((template) => {
            const Icon = TYPE_ICONS[template.content_type] || FileText
            const colorClass = TYPE_COLORS[template.content_type] || 'text-slate-500 bg-slate-50'
            
            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className="flex items-start gap-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-500 transition-all text-left"
              >
                <div className={`p-2 rounded-lg ${colorClass}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-900 dark:text-white">{template.name}</h4>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">{template.description}</p>
                  {template.platform.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {template.platform.map((p) => (
                        <span key={p} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 text-xs rounded">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && templates.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          No templates found
        </div>
      )}
    </div>
  )
}

