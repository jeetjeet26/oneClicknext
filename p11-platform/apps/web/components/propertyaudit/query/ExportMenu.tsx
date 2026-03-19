'use client'

import { useState } from 'react'
import { Download, FileText, FileCode, Loader2 } from 'lucide-react'

interface ExportMenuProps {
  runId: string | null
  onExportCSV?: () => void
}

export function ExportMenu({ runId, onExportCSV }: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState<'pdf' | 'markdown' | null>(null)

  const handleExportMarkdown = async () => {
    if (!runId) return

    setIsExporting('markdown')
    try {
      const res = await fetch(`/api/propertyaudit/export?runId=${runId}&format=markdown`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `geo_visibility_report_${runId}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Markdown export failed:', error)
      alert('Failed to export markdown. Please try again.')
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportPDF = async () => {
    if (!runId) return

    setIsExporting('pdf')
    try {
      const res = await fetch(`/api/propertyaudit/export?runId=${runId}&format=pdf`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      
      // Open in new window for printing to PDF
      const printWindow = window.open(url)
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          setTimeout(() => {
            printWindow.print()
          }, 500)
        })
      }
      
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('PDF export failed:', error)
      alert('Failed to export PDF. Please try again.')
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {onExportCSV && (
        <button
          onClick={onExportCSV}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>
      )}

      <button
        onClick={handleExportMarkdown}
        disabled={!runId || isExporting === 'markdown'}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {isExporting === 'markdown' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileCode className="w-4 h-4" />
        )}
        Markdown
      </button>

      <button
        onClick={handleExportPDF}
        disabled={!runId || isExporting === 'pdf'}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {isExporting === 'pdf' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileText className="w-4 h-4" />
        )}
        PDF/Print
      </button>
    </div>
  )
}









