'use client'

import { 
  FileText, ArrowRight, ArrowLeft, Upload, File, X, 
  CheckCircle2, AlertCircle, Loader2, FileType, Image, Sparkles
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useAddProperty, UploadedDocument } from '../AddPropertyProvider'
import { BrandForgeWizard } from '@/components/brandforge/BrandForgeWizard'

const SUGGESTED_DOCUMENTS = [
  { name: 'Property Brochure', description: 'Floor plans, photos, and features', type: 'brochure' },
  { name: 'Pet Policy', description: 'Pet rules, fees, and restrictions', type: 'pet_policy' },
  { name: 'Pricing/Rent Roll', description: 'Current pricing and availability', type: 'pricing' },
  { name: 'Community Guidelines', description: 'Resident handbook and rules', type: 'guidelines' },
  { name: 'FAQ Document', description: 'Common questions and answers', type: 'faq' },
  { name: 'Move-In Checklist', description: 'Requirements for new residents', type: 'checklist' },
]

const ALLOWED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
]

const FILE_EXTENSIONS = ['.pdf', '.txt', '.md']

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getFileIcon(type: string) {
  if (type.includes('pdf')) return <FileType className="w-5 h-5 text-red-400" />
  if (type.includes('image')) return <Image className="w-5 h-5 text-blue-400" />
  return <File className="w-5 h-5 text-slate-400" />
}

interface DocumentCardProps {
  doc: UploadedDocument
  onRemove: () => void
}

function DocumentCard({ doc, onRemove }: DocumentCardProps) {
  return (
    <div className={`
      flex items-center gap-3 p-3 rounded-xl border transition-all
      ${doc.status === 'completed' 
        ? 'bg-emerald-500/5 border-emerald-500/20' 
        : doc.status === 'error'
          ? 'bg-red-500/5 border-red-500/20'
          : doc.status === 'uploading'
            ? 'bg-amber-500/5 border-amber-500/20'
            : 'bg-slate-800/50 border-slate-700'
      }
    `}>
      <div className="p-2 bg-slate-800 rounded-lg">
        {getFileIcon(doc.type)}
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{doc.name}</p>
        <p className="text-xs text-slate-500">
          {formatFileSize(doc.size)}
          {doc.chunks && <span className="text-emerald-400"> • {doc.chunks} chunks</span>}
          {doc.error && <span className="text-red-400"> • {doc.error}</span>}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {doc.status === 'uploading' && (
          <Loader2 size={18} className="text-amber-400 animate-spin" />
        )}
        {doc.status === 'completed' && (
          <CheckCircle2 size={18} className="text-emerald-400" />
        )}
        {doc.status === 'error' && (
          <AlertCircle size={18} className="text-red-400" />
        )}
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export function KnowledgeStep() {
  const {
    formData,
    addDocument,
    updateDocument,
    removeDocument,
    goToNextStep,
    goToPreviousStep,
    createdPropertyId,
    editMode,
  } = useAddProperty()
  const { documents } = formData
  const [isDragging, setIsDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'choose' | 'upload' | 'brandforge'>('choose')
  const [brandBookGenerated, setBrandBookGenerated] = useState(false)

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type) && !FILE_EXTENSIONS.some(ext => file.name.endsWith(ext))) {
      return `${file.name}: Unsupported file type. Please use PDF, TXT, or MD files.`
    }
    if (file.size > 10 * 1024 * 1024) {
      return `${file.name}: File too large. Maximum size is 10MB.`
    }
    return null
  }

  const targetPropertyId = editMode.isEditing ? editMode.propertyId || null : createdPropertyId

  const uploadDocumentFile = useCallback(async (docId: string, file: File, propertyId: string) => {
    updateDocument(docId, { status: 'uploading', error: undefined })

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('propertyId', propertyId)
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''))

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Upload failed')
      }

      updateDocument(docId, {
        status: 'completed',
        chunks: typeof result.chunks === 'number' ? result.chunks : undefined,
        metadata: {
          ...(typeof result.knowledgeSourceId === 'string'
            ? { knowledgeSourceId: result.knowledgeSourceId }
            : {}),
          ...(typeof result.originalFileUrl === 'string'
            ? { originalFileUrl: result.originalFileUrl }
            : {}),
        },
      })
    } catch (error) {
      updateDocument(docId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      })
    }
  }, [updateDocument])

  const handleFiles = useCallback((files: FileList | File[]) => {
    setUploadError(null)
    const fileArray = Array.from(files)
    
    for (const file of fileArray) {
      const error = validateFile(file)
      if (error) {
        setUploadError(error)
        continue
      }

      if (documents.some(d => d.name === file.name)) {
        setUploadError(`${file.name}: File already added`)
        continue
      }

      const doc: UploadedDocument = {
        id: generateId(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending',
      }

      addDocument(doc)

      if (!targetPropertyId) {
        updateDocument(doc.id, {
          status: 'error',
          error: 'Property must be created before uploading documents',
        })
        continue
      }

      void uploadDocumentFile(doc.id, file, targetPropertyId)
    }
  }, [documents, addDocument, targetPropertyId, updateDocument, uploadDocumentFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files)
    }
    e.target.value = ''
  }

  const totalSize = documents.reduce((sum, d) => sum + d.size, 0)
  const completedCount = documents.filter(d => d.status === 'completed').length

  function handleBrandComplete(brandAsset: any) {
    // Add brand book as a document
    addDocument({
      id: generateId(),
      name: `${brandAsset.brandBookData?.metadata?.brandName || 'Brand'} Book (AI Generated)`,
      size: 0,
      type: 'application/json',
      status: 'completed',
      metadata: { source: 'BrandForge', brandAssetId: brandAsset.brandAssetId }
    })
    setBrandBookGenerated(true)
    setMode('upload') // Allow additional doc uploads after brand generation
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-xl shadow-rose-500/25 mb-6">
          {mode === 'brandforge' ? <Sparkles className="w-8 h-8 text-white" /> : <FileText className="w-8 h-8 text-white" />}
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          {mode === 'brandforge' ? 'Generate Brand Book' : 'Knowledge Base'}
        </h1>
        <p className="text-slate-400 text-lg">
          {mode === 'brandforge' 
            ? 'AI-powered brand strategy and guidelines'
            : 'Upload documents to train your AI assistant'
          }
        </p>
        {documents.length > 0 && mode !== 'brandforge' && (
          <p className="text-rose-400 text-sm mt-2">
            {documents.length} document{documents.length !== 1 ? 's' : ''} added
            {completedCount > 0 && ` • ${completedCount} processed`}
          </p>
        )}
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-6 sm:p-8">
        <div className="space-y-6">
          {/* Choice: Upload or Generate Brand */}
          {mode === 'choose' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setMode('upload')}
                className="p-6 bg-slate-800/50 hover:bg-slate-800 border-2 border-slate-700 hover:border-indigo-500 rounded-xl transition-all text-left group"
              >
                <Upload className="w-10 h-10 text-slate-400 group-hover:text-indigo-400 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">Upload Documents</h3>
                <p className="text-sm text-slate-400">
                  Upload existing brand guidelines, brochures, and property documents
                </p>
              </button>
              
              <button
                onClick={() => setMode('brandforge')}
                className="p-6 bg-gradient-to-br from-indigo-900/50 to-purple-900/50 hover:from-indigo-900/70 hover:to-purple-900/70 border-2 border-indigo-500/50 hover:border-indigo-500 rounded-xl transition-all text-left group"
              >
                <Sparkles className="w-10 h-10 text-indigo-400 group-hover:text-indigo-300 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">Generate Brand Book</h3>
                <p className="text-sm text-slate-400">
                  Create comprehensive brand strategy with AI (logo, colors, guidelines)
                </p>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-400">
                  <Sparkles className="w-3 h-3" />
                  Powered by Gemini 3
                </div>
              </button>
            </div>
          )}

          {/* BrandForge Wizard */}
          {mode === 'brandforge' && createdPropertyId && (
            <>
              <BrandForgeWizard
                propertyId={createdPropertyId}
                propertyAddress={formData.community.address}
                propertyType={formData.community.type || 'multifamily'}
                onComplete={handleBrandComplete}
              />
              {!brandBookGenerated && (
                <button
                  onClick={() => setMode('choose')}
                  className="w-full px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  ← Back to options
                </button>
              )}
            </>
          )}
          
          {/* Loading state while creating property */}
          {mode === 'brandforge' && !createdPropertyId && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
              <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">
                Setting up property...
              </h3>
              <p className="text-slate-400">
                Creating property record for brand generation
              </p>
            </div>
          )}

          {/* Document Upload UI */}
          {mode === 'upload' && (
            <>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              relative border-2 border-dashed rounded-xl p-8 text-center transition-all
              ${isDragging
                ? 'border-rose-400 bg-rose-500/10'
                : 'border-slate-600 hover:border-slate-500'
              }
            `}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.doc,.docx"
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="pointer-events-none">
              <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-rose-400' : 'text-slate-500'}`} />
              <p className="text-lg font-medium text-white mb-1">
                {isDragging ? 'Drop files here' : 'Drag & drop files here'}
              </p>
              <p className="text-sm text-slate-500">
                or click to browse • PDF, TXT, MD • Max 10MB each
              </p>
            </div>
          </div>

          {uploadError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
              {uploadError}
            </div>
          )}

          {documents.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">{documents.length} files • {formatFileSize(totalSize)}</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {documents.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onRemove={() => removeDocument(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3">
              Suggested Documents
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SUGGESTED_DOCUMENTS.map(({ name, description }) => (
                <div
                  key={name}
                  className="p-3 bg-slate-800/50 rounded-lg border border-slate-700"
                >
                  <p className="text-sm font-medium text-slate-300">{name}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700">
            <p className="text-sm text-slate-400">
              <strong className="text-slate-300">Pro tip:</strong> Documents uploaded here will be used by LumaLeasing AI 
              to answer prospect questions accurately about your community.
            </p>
          </div>
          </>
          )}

          {mode !== 'choose' && (
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={goToPreviousStep}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all"
            >
              <ArrowLeft size={18} />
              Back
            </button>
            <button
              type="button"
              onClick={goToNextStep}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-rose-500 to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 hover:from-rose-600 hover:to-pink-700 transition-all duration-200"
            >
              Continue
              <ArrowRight size={18} />
            </button>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}





