'use client'

import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react'
import {
  parseSeedKeywordCsv,
  type ParseSeedKeywordCsvResult,
  type PropertyAuditSeedKeyword,
} from '@/utils/propertyaudit/seed-keywords'

interface SeedKeywordUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onGenerate: (seedKeywords: PropertyAuditSeedKeyword[]) => Promise<void>
  isGenerating?: boolean
  propertyName?: string
}

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number') return '-'
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
}

export function SeedKeywordUploadModal({
  isOpen,
  onClose,
  onGenerate,
  isGenerating = false,
  propertyName,
}: SeedKeywordUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [parseResult, setParseResult] = useState<ParseSeedKeywordCsvResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const reset = () => {
    setFileName('')
    setParseResult(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const parseFile = async (file: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file.')
      return
    }

    setError(null)
    setFileName(file.name)

    try {
      const content = await file.text()
      const parsed = parseSeedKeywordCsv(content, { limit: 50 })
      setParseResult(parsed)
      if (parsed.seeds.length === 0) {
        setError(parsed.warnings[0] || 'No seed keywords were found in this CSV.')
      }
    } catch (readError) {
      console.error('Failed to parse keyword seed CSV:', readError)
      setError('Failed to read the CSV file.')
      setParseResult(null)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await parseFile(file)
  }

  const handleGenerate = async () => {
    if (!parseResult?.seeds.length) return
    await onGenerate(parseResult.seeds)
    handleClose()
  }

  const previewSeeds = parseResult?.seeds.slice(0, 10) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="flex max-h-[calc(100vh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:max-h-[calc(100vh-2rem)]">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <FileSpreadsheet className="h-5 w-5 text-indigo-500" />
              Generate With Keyword Seeds
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a SEMrush or Google Ads keyword CSV to seed discovery queries
              {propertyName ? ` for ${propertyName}` : ''}.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close keyword seed upload"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div
            className={`rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-center dark:border-gray-700 dark:bg-gray-900/40 ${
              parseResult?.seeds.length ? 'p-3' : 'p-6'
            }`}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              const file = event.dataTransfer.files?.[0]
              if (!file) return
              void parseFile(file)
            }}
          >
            <Upload className={`${parseResult?.seeds.length ? 'mb-1 h-5 w-5' : 'mb-3 h-8 w-8'} mx-auto text-gray-400`} />
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Drop a keyword CSV here, or choose a file
            </p>
            {!parseResult?.seeds.length && (
              <p className="mt-1 text-xs text-gray-500">
                Looks for columns like Keyword, Search keyword, Search term, Impr., Interactions, Cost, and Conversions.
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`${parseResult?.seeds.length ? 'mt-2' : 'mt-4'} rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700`}
            >
              Choose CSV
            </button>
          </div>

          {fileName && (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              <FileSpreadsheet className="h-4 w-4 text-gray-400" />
              {fileName}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parseResult && parseResult.seeds.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Found {parseResult.seeds.length} seed keywords from {parseResult.totalRows} rows.
                  </span>
                </div>
                <span className="text-xs">
                  {parseResult.duplicateRows} duplicates, {parseResult.skippedRows} skipped
                </span>
              </div>

              <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Keyword</th>
                      <th className="px-3 py-2">Impr.</th>
                      <th className="px-3 py-2">Interactions</th>
                      <th className="px-3 py-2">Conv.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {previewSeeds.map(seed => (
                      <tr key={seed.keyword}>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{seed.keyword}</td>
                        <td className="px-3 py-2 text-gray-500">{formatMetric(seed.metrics.impressions ?? seed.metrics.searchVolume)}</td>
                        <td className="px-3 py-2 text-gray-500">{formatMetric(seed.metrics.interactions)}</td>
                        <td className="px-3 py-2 text-gray-500">{formatMetric(seed.metrics.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parseResult.warnings.length > 0 && (
                <div className="max-h-24 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                  {parseResult.warnings.slice(0, 3).map(warning => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!parseResult?.seeds.length || isGenerating}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Generate Seeded Panel'}
          </button>
        </div>
      </div>
    </div>
  )
}
