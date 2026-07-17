'use client'

import { useEffect, useState } from 'react'
import { X, Plus, Edit2 } from 'lucide-react'

type QueryType = 'branded' | 'category' | 'comparison' | 'local' | 'faq' | 'voice_search'

type QueryFormValue = {
  text: string
  type: QueryType
  weight: number
  geo?: string
}

type EditableQuery = {
  text: string
  type: QueryType
  weight: number
  geo?: string | null
}

interface CreateQueryModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (query: QueryFormValue) => Promise<void>
  defaultGeo?: string
  propertyName?: string
  initialQuery?: EditableQuery | null
}

export function CreateQueryModal({
  isOpen,
  onClose,
  onSubmit,
  defaultGeo,
  propertyName,
  initialQuery = null
}: CreateQueryModalProps) {
  const [text, setText] = useState('')
  const [type, setType] = useState<QueryType>('branded')
  const [weight, setWeight] = useState(1.0)
  const [geo, setGeo] = useState(defaultGeo || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEditing = Boolean(initialQuery)

  useEffect(() => {
    if (!isOpen) return

    setText(initialQuery?.text ?? '')
    setType(initialQuery?.type ?? 'branded')
    setWeight(initialQuery?.weight ?? 1.0)
    setGeo(initialQuery?.geo ?? defaultGeo ?? '')
  }, [defaultGeo, initialQuery, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return

    setIsSubmitting(true)
    try {
      await onSubmit({
        text: text.trim(),
        type,
        weight,
        geo: geo.trim() || undefined
      })
      if (!isEditing) {
        setText('')
        setType('branded')
        setWeight(1.0)
        setGeo(defaultGeo || '')
      }
      onClose()
    } catch (error) {
      console.error('Error saving query:', error)
      alert('Failed to save query. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const queryTemplates = [
    { text: `What is ${propertyName}?`, type: 'branded' as const },
    { text: `Best apartments in ${geo?.split(',')[0] || 'city'}`, type: 'category' as const },
    { text: `${propertyName} vs [competitor]`, type: 'comparison' as const },
    { text: `Apartments near ${geo?.split(',')[0] || 'location'}`, type: 'local' as const },
    { text: `How much is rent in ${geo?.split(',')[0] || 'city'}?`, type: 'faq' as const },
    { text: `How do I apply to ${propertyName}?`, type: 'voice_search' as const },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            {isEditing ? (
              <Edit2 className="w-5 h-5 text-indigo-500" />
            ) : (
              <Plus className="w-5 h-5 text-indigo-500" />
            )}
            {isEditing ? 'Edit Query' : 'Add Custom Query'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Query Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Query Text
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter your query..."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={3}
              required
            />
          </div>

          {/* Templates */}
          {propertyName && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                Quick Templates
              </label>
              <div className="flex flex-wrap gap-1.5">
                {queryTemplates.map((template, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setText(template.text)
                      setType(template.type)
                    }}
                    className="rounded-md bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    {template.type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Query Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="branded">Branded - Direct brand queries</option>
              <option value="category">Category - General searches in your niche</option>
              <option value="comparison">Comparison - Brand vs competitors</option>
              <option value="local">Local - Geographic searches</option>
              <option value="faq">FAQ - Question-based queries</option>
              <option value="voice_search">Voice Search - Conversational queries</option>
            </select>
          </div>

          {/* Weight Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Query Weight: <span className="font-semibold text-indigo-600">{weight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Low priority (0.5)</span>
              <span>High priority (2.0)</span>
            </div>
          </div>

          {/* Geographic Context */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Geographic Context (optional)
            </label>
            <input
              type="text"
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              placeholder="e.g., San Francisco, CA"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!text.trim() || isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {isEditing ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                <>
                  {isEditing ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {isEditing ? 'Save Query' : 'Add Query'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

