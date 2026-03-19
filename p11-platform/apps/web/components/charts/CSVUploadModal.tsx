'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Loader2, 
  Check,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Calendar,
  DollarSign,
  MousePointerClick,
  Target,
  FolderOpen,
  Trash2,
  CheckCircle2,
  XCircle,
  Database,
  BarChart3
} from 'lucide-react'
import type { MarketingPlatform } from '@/utils/csv/marketing-csv-parser'

type CSVUploadModalProps = {
  isOpen: boolean
  onClose: () => void
  propertyId: string
  propertyName?: string
  onSuccess?: () => void
}

type FilePreview = {
  totalRows: number
  dateRange: { start: string; end: string } | null
  reportType: string
  isExtended: boolean
  totals: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
  }
}

type FileWithContent = {
  file: File
  content: string
  status: 'pending' | 'parsing' | 'ready' | 'importing' | 'success' | 'error'
  error?: string
  preview?: FilePreview
}

type Step = 'platform' | 'upload' | 'preview' | 'importing' | 'success'

const PLATFORM_OPTIONS: { value: MarketingPlatform; label: string; icon: string; description: string }[] = [
  { 
    value: 'google_ads', 
    label: 'Google Ads', 
    icon: '🔵',
    description: 'CSV exports from Google Ads dashboard' 
  },
  { 
    value: 'meta_ads', 
    label: 'Meta Ads', 
    icon: '🔷',
    description: 'CSV exports from Meta Business Suite' 
  },
]

// Report type labels for display
const REPORT_TYPE_LABELS: Record<string, string> = {
  'time_series': 'Time Series (Daily)',
  'campaign_summary': 'Campaign Summary',
  'keywords': 'Search Keywords',
  'search_terms': 'Search Terms',
  'demographics': 'Demographics',
  'devices': 'Devices',
  'locations': 'Locations',
  'day_hour': 'Day & Hour',
  'auction_insights': 'Auction Insights',
  'networks': 'Networks',
  'unknown': 'Unknown'
}

export function CSVUploadModal({ 
  isOpen, 
  onClose, 
  propertyId,
  propertyName,
  onSuccess 
}: CSVUploadModalProps) {
  const [step, setStep] = useState<Step>('platform')
  const [platform, setPlatform] = useState<MarketingPlatform>('google_ads')
  const [files, setFiles] = useState<FileWithContent[]>([])
  const [campaignName, setCampaignName] = useState('')
  const [loading, setLoading] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [totalImported, setTotalImported] = useState(0)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('platform')
      setPlatform('google_ads')
      setFiles([])
      setCampaignName('')
      setLoading(false)
      setImportProgress({ current: 0, total: 0 })
      setError(null)
      setWarnings([])
      setTotalImported(0)
    }
  }, [isOpen])

  // Generate default campaign name when files are added
  useEffect(() => {
    if (files.length > 0 && !campaignName) {
      const defaultName = `${propertyName || 'Campaign'} - ${platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'} Import`
      setCampaignName(defaultName.substring(0, 100))
    }
  }, [files, propertyName, platform, campaignName])

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  const handleFilesSelect = useCallback(async (selectedFiles: FileList | File[]) => {
    const csvFiles = Array.from(selectedFiles).filter(f => 
      f.name.toLowerCase().endsWith('.csv')
    )
    
    if (csvFiles.length === 0) {
      setError('No CSV files found')
      return
    }

    setError(null)
    setLoading(true)

    try {
      const newFiles: FileWithContent[] = await Promise.all(
        csvFiles.map(async (file) => {
          const content = await readFileContent(file)
          return {
            file,
            content,
            status: 'pending' as const
          }
        })
      )
      
      setFiles(prev => [...prev, ...newFiles])
    } catch (err) {
      setError('Failed to read some files')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const items = e.dataTransfer.items
    const fileList: File[] = []
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) fileList.push(file)
      }
    }
    
    if (fileList.length > 0) {
      handleFilesSelect(fileList)
    }
  }, [handleFilesSelect])

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelect(e.target.files)
    }
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handlePreview = async () => {
    if (files.length === 0 || !campaignName.trim()) {
      setError('Please add files and provide a campaign name')
      return
    }

    setLoading(true)
    setError(null)
    setWarnings([])

    const updatedFiles = [...files]
    const allWarnings: string[] = []

    for (let i = 0; i < updatedFiles.length; i++) {
      const fileData = updatedFiles[i]
      updatedFiles[i] = { ...fileData, status: 'parsing' }
      setFiles([...updatedFiles])

      try {
        const response = await fetch('/api/analytics/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvContent: fileData.content,
            filename: fileData.file.name,
            campaignName: campaignName.trim(),
            propertyId,
            platform,
            preview: true,
          }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          updatedFiles[i] = { 
            ...fileData, 
            status: 'error',
            error: data.errors?.[0] || data.message || 'Failed to parse'
          }
          if (data.warnings) allWarnings.push(...data.warnings)
        } else {
          updatedFiles[i] = { 
            ...fileData, 
            status: 'ready',
            preview: data.preview
          }
          if (data.warnings) allWarnings.push(...data.warnings)
        }
      } catch (err) {
        updatedFiles[i] = { 
          ...fileData, 
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to parse'
        }
      }

      setFiles([...updatedFiles])
    }

    setWarnings(allWarnings)
    setLoading(false)

    // Check if we have any valid files
    const validFiles = updatedFiles.filter(f => f.status === 'ready')
    if (validFiles.length > 0) {
      setStep('preview')
    } else {
      setError('No valid files found to import')
    }
  }

  const handleImport = async () => {
    const validFiles = files.filter(f => f.status === 'ready')
    if (validFiles.length === 0) return

    setStep('importing')
    setImportProgress({ current: 0, total: validFiles.length })
    setError(null)

    const updatedFiles = [...files]
    let totalRows = 0

    for (let i = 0; i < files.length; i++) {
      const fileData = files[i]
      if (fileData.status !== 'ready') continue

      const validIndex = validFiles.findIndex(f => f.file.name === fileData.file.name)
      setImportProgress({ current: validIndex + 1, total: validFiles.length })

      updatedFiles[i] = { ...fileData, status: 'importing' }
      setFiles([...updatedFiles])

      try {
        const response = await fetch('/api/analytics/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvContent: fileData.content,
            filename: fileData.file.name,
            campaignName: campaignName.trim(),
            propertyId,
            platform,
            preview: false,
          }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          updatedFiles[i] = { 
            ...fileData, 
            status: 'error',
            error: data.errors?.[0] || data.message || 'Failed to import'
          }
        } else {
          updatedFiles[i] = { ...fileData, status: 'success' }
          totalRows += data.imported?.rowCount || 0
        }
      } catch (err) {
        updatedFiles[i] = { 
          ...fileData, 
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to import'
        }
      }

      setFiles([...updatedFiles])
    }

    setTotalImported(totalRows)
    setStep('success')
    onSuccess?.()
  }

  const formatCurrency = (val: number) => 
    `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatNumber = (val: number) => val.toLocaleString('en-US')

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      })
    } catch {
      return dateStr
    }
  }

  // Calculate aggregate totals for preview
  const aggregateTotals = files
    .filter(f => f.status === 'ready' && f.preview)
    .reduce(
      (acc, f) => ({
        rows: acc.rows + (f.preview?.totalRows || 0),
        spend: acc.spend + (f.preview?.totals.spend || 0),
        clicks: acc.clicks + (f.preview?.totals.clicks || 0),
        conversions: acc.conversions + (f.preview?.totals.conversions || 0),
        timeSeries: acc.timeSeries + (f.preview?.isExtended === false ? 1 : 0),
        extended: acc.extended + (f.preview?.isExtended === true ? 1 : 0),
      }),
      { rows: 0, spend: 0, clicks: 0, conversions: 0, timeSeries: 0, extended: 0 }
    )

  const validFileCount = files.filter(f => f.status === 'ready').length
  const errorFileCount = files.filter(f => f.status === 'error').length

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Upload size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Import Marketing Data
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {propertyName || 'Upload CSV exports from your ad platforms'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2 text-sm">
            {['platform', 'upload', 'preview', 'success'].map((s, idx) => (
              <div key={s} className="flex items-center">
                {idx > 0 && <ChevronRight size={14} className="text-slate-300 mx-1" />}
                <span className={`px-2 py-1 rounded ${
                  step === s || (step === 'importing' && s === 'preview')
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 font-medium' 
                    : 'text-slate-400'
                }`}>
                  {s === 'platform' && '1. Platform'}
                  {s === 'upload' && '2. Upload'}
                  {s === 'preview' && '3. Review'}
                  {s === 'success' && '4. Done'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Warnings Display */}
          {warnings.length > 0 && step !== 'success' && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Warnings</p>
                  <ul className="text-sm text-amber-600 dark:text-amber-500 mt-1 space-y-0.5">
                    {warnings.slice(0, 3).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                    {warnings.length > 3 && (
                      <li>• ...and {warnings.length - 3} more</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Step: Platform Selection */}
          {step === 'platform' && (
            <div className="space-y-4">
              <p className="text-slate-600 dark:text-slate-300">
                Select the platform your CSVs were exported from:
              </p>
              <div className="grid grid-cols-2 gap-4">
                {PLATFORM_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPlatform(opt.value)}
                    className={`p-4 border-2 rounded-xl text-left transition-all ${
                      platform === opt.value
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{opt.icon}</span>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{opt.label}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{opt.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: File Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              {/* Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed rounded-xl p-8 text-center transition-colors border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  accept=".csv"
                  multiple
                  // @ts-expect-error webkitdirectory is not in the types but works in browsers
                  webkitdirectory=""
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                
                <div className="flex flex-col items-center gap-3">
                  <div className="flex gap-3">
                    <div className="h-12 w-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center">
                      <Upload size={24} className="text-slate-400" />
                    </div>
                    <div className="h-12 w-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center">
                      <FolderOpen size={24} className="text-slate-400" />
                    </div>
                  </div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">
                    Drop CSV files or a folder here
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors"
                    >
                      Select Files
                    </button>
                    <button
                      onClick={() => folderInputRef.current?.click()}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                      Select Folder
                    </button>
                  </div>
                </div>
              </div>

              {/* File List */}
              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {files.length} file{files.length !== 1 ? 's' : ''} selected
                    </p>
                    <button
                      onClick={() => setFiles([])}
                      className="text-sm text-red-500 hover:text-red-700 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                    {files.map((fileData, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileSpreadsheet size={16} className="text-emerald-500 flex-shrink-0" />
                          <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                            {fileData.file.name}
                          </span>
                          <span className="text-xs text-slate-400">
                            ({(fileData.file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <button
                          onClick={() => removeFile(idx)}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Campaign Name Input */}
              {files.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Campaign Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g., Aurora - Google Ads - November 2025"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    This name will be used to identify all imported data
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Aggregate Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                    <DollarSign size={14} />
                    <span className="text-xs font-medium">Total Spend</span>
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {formatCurrency(aggregateTotals.spend)}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                    <MousePointerClick size={14} />
                    <span className="text-xs font-medium">Clicks</span>
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {formatNumber(aggregateTotals.clicks)}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                    <Target size={14} />
                    <span className="text-xs font-medium">Conversions</span>
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {formatNumber(aggregateTotals.conversions)}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                    <Database size={14} />
                    <span className="text-xs font-medium">Total Records</span>
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {formatNumber(aggregateTotals.rows)}
                  </p>
                </div>
              </div>

              {/* Report Type Summary */}
              {(aggregateTotals.timeSeries > 0 || aggregateTotals.extended > 0) && (
                <div className="flex gap-3 text-sm">
                  {aggregateTotals.timeSeries > 0 && (
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg">
                      <Calendar size={14} />
                      {aggregateTotals.timeSeries} time series
                    </span>
                  )}
                  {aggregateTotals.extended > 0 && (
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg">
                      <BarChart3 size={14} />
                      {aggregateTotals.extended} dimension reports
                    </span>
                  )}
                </div>
              )}

              {/* File Status List */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-900/50 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Files to Import ({validFileCount} ready{errorFileCount > 0 ? `, ${errorFileCount} errors` : ''})
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                  {files.map((fileData, idx) => (
                    <div 
                      key={idx}
                      className={`px-4 py-3 flex items-center justify-between ${
                        fileData.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' :
                        fileData.status === 'ready' ? 'bg-emerald-50 dark:bg-emerald-900/10' :
                        ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {fileData.status === 'ready' && <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />}
                        {fileData.status === 'error' && <XCircle size={16} className="text-red-500 flex-shrink-0" />}
                        {fileData.status === 'parsing' && <Loader2 size={16} className="text-indigo-500 animate-spin flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                            {fileData.file.name}
                          </p>
                          {fileData.status === 'ready' && fileData.preview && (
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                fileData.preview.isExtended 
                                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                  : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                              }`}>
                                {REPORT_TYPE_LABELS[fileData.preview.reportType] || fileData.preview.reportType}
                              </span>
                              <span>{fileData.preview.totalRows} rows</span>
                              {fileData.preview.totals.spend > 0 && (
                                <span>• {formatCurrency(fileData.preview.totals.spend)}</span>
                              )}
                              {fileData.preview.dateRange && (
                                <span>• {formatDate(fileData.preview.dateRange.start)} - {formatDate(fileData.preview.dateRange.end)}</span>
                              )}
                            </p>
                          )}
                          {fileData.status === 'error' && fileData.error && (
                            <p className="text-xs text-red-500 dark:text-red-400">{fileData.error}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Info Notice */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  <strong>All report types supported:</strong> Time series data goes to the main performance table. 
                  Keywords, demographics, devices, and other reports are stored with their date range for analysis.
                </p>
              </div>
            </div>
          )}

          {/* Step: Importing */}
          {step === 'importing' && (
            <div className="text-center py-8">
              <Loader2 size={48} className="text-indigo-500 animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Importing...
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Processing file {importProgress.current} of {importProgress.total}
              </p>
              <div className="w-full max-w-xs mx-auto bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="h-16 w-16 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Import Complete!
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Successfully imported {formatNumber(totalImported)} records from {files.filter(f => f.status === 'success').length} file{files.filter(f => f.status === 'success').length !== 1 ? 's' : ''}.
              </p>
              {files.some(f => f.status === 'error') && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {files.filter(f => f.status === 'error').length} file(s) had errors and were skipped.
                </p>
              )}
              <p className="text-sm text-slate-500 mt-4">
                The data is now available in your MultiChannel BI dashboard.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
          <div>
            {step !== 'platform' && step !== 'success' && step !== 'importing' && (
              <button
                onClick={() => {
                  if (step === 'upload') setStep('platform')
                  if (step === 'preview') setStep('upload')
                }}
                disabled={loading}
                className="flex items-center gap-1 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              {step === 'success' ? 'Close' : 'Cancel'}
            </button>

            {step === 'platform' && (
              <button
                onClick={() => setStep('upload')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Continue
                <ChevronRight size={16} />
              </button>
            )}

            {step === 'upload' && (
              <button
                onClick={handlePreview}
                disabled={files.length === 0 || !campaignName.trim() || loading}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Parsing {files.length} files...
                  </>
                ) : (
                  <>
                    Preview Data
                    <ChevronRight size={16} />
                  </>
                )}
              </button>
            )}

            {step === 'preview' && (
              <button
                onClick={handleImport}
                disabled={validFileCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check size={16} />
                Import {validFileCount} File{validFileCount !== 1 ? 's' : ''} ({formatNumber(aggregateTotals.rows)} records)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
