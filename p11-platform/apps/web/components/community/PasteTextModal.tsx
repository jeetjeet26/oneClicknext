'use client'

import { useState } from 'react'
import { X, FileText, Loader2, Check, AlertCircle } from 'lucide-react'

type Props = {
  propertyId: string
  onClose: () => void
  onSuccess: () => void
}

export function PasteTextModal({ propertyId, onClose, onSuccess }: Props) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'input' | 'processing' | 'success'>('input')

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('Please paste some content first')
      return
    }

    if (content.trim().length < 50) {
      setError('Content is too short. Please paste at least 50 characters.')
      return
    }

    setIsProcessing(true)
    setError(null)
    setStep('processing')

    try {
      const response = await fetch('/api/documents/paste-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          content: content.trim(),
          title: title.trim() || 'Pasted Text Content'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process text')
      }

      setResult(data)
      setStep('success')
      
      // Auto-close after 2 seconds
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 2000)

    } catch (err: any) {
      setError(err.message || 'Failed to process text')
      setStep('input')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Paste Text Content</h3>
              <p className="text-sm text-slate-500">
                {step === 'input' && 'Add text directly to your knowledge base'}
                {step === 'processing' && 'Processing and embedding content...'}
                {step === 'success' && 'Content added successfully!'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Pet Policy Details, Amenities Overview, etc."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Text Content
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste any text content about your property here...

Examples:
- Pet policy details
- Amenity descriptions
- Community guidelines
- FAQ answers
- Pricing details
- Special offers

The content will be automatically chunked, embedded, and added to your AI knowledge base."
                  className="w-full h-80 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none text-sm"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-slate-500">
                    {content.length} characters
                  </p>
                  {content.length > 0 && content.length < 50 && (
                    <p className="text-xs text-amber-600">
                      Need at least 50 characters
                    </p>
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">💡 Tips:</h4>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>• Paste any text content about your property</li>
                  <li>• Content will be automatically chunked for optimal AI retrieval</li>
                  <li>• Your chatbot will be able to answer questions about this content</li>
                  <li>• Works great for policies, FAQs, amenity details, and more</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-indigo-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Processing Content...</h3>
              <p className="text-sm text-slate-600 text-center">
                Chunking text, generating embeddings, and adding to knowledge base
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-16 w-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4">
                <Check className="h-8 w-8 text-indigo-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Content Added!</h3>
              {result && (
                <div className="text-sm text-slate-600 space-y-1 text-center">
                  <p>{result.chunks} chunks created from {result.characters.toLocaleString()} characters</p>
                  <p className="text-xs text-indigo-600">
                    Title: {result.title}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'input' && (
          <div className="p-6 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
              disabled={isProcessing}
            >
              Cancel
            </button>

            <button
              onClick={handleSubmit}
              disabled={isProcessing || content.trim().length < 50}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Add to Knowledge Base
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
