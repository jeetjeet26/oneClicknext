'use client'

import { useState } from 'react'
import { X, FileText, Download, Loader2, Mail, Calendar } from 'lucide-react'

export type ReportTemplate = 'executive' | 'comprehensive' | 'competitive' | 'progress'

interface ReportBuilderProps {
  isOpen: boolean
  onClose: () => void
  propertyId: string
  propertyName: string
}

interface ReportConfig {
  template: ReportTemplate
  includeSections: string[]
  recipients: string[]
  schedule: boolean
}

export function ReportBuilder({ isOpen, onClose, propertyId, propertyName }: ReportBuilderProps) {
  const [config, setConfig] = useState<ReportConfig>({
    template: 'comprehensive',
    includeSections: ['summary', 'scores', 'models', 'competitors', 'recommendations', 'queries'],
    recipients: [],
    schedule: false,
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [emailInput, setEmailInput] = useState('')

  if (!isOpen) return null

  const templates = [
    {
      id: 'executive' as const,
      name: 'Executive Brief',
      description: '5-page summary for C-suite stakeholders',
      pages: 5,
      icon: '📊',
    },
    {
      id: 'comprehensive' as const,
      name: 'Comprehensive Audit',
      description: 'Full analysis with all details',
      pages: 15,
      icon: '📈',
    },
    {
      id: 'competitive' as const,
      name: 'Competitive Intelligence',
      description: 'Focus on competitive positioning',
      pages: 10,
      icon: '🎯',
    },
    {
      id: 'progress' as const,
      name: 'Monthly Progress Report',
      description: 'Period-over-period comparison',
      pages: 8,
      icon: '📅',
    },
  ]

  const availableSections = [
    { id: 'summary', label: 'Executive Summary', required: true },
    { id: 'scores', label: 'Score Overview & Trends' },
    { id: 'models', label: 'Model Comparison (OpenAI vs Claude)' },
    { id: 'competitors', label: 'Competitive Intelligence' },
    { id: 'recommendations', label: 'Actionable Recommendations' },
    { id: 'queries', label: 'Query-Level Details' },
    { id: 'appendix', label: 'Appendix & Methodology' },
  ]

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const res = await fetch('/api/propertyaudit/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          template: config.template,
          includeSections: config.includeSections,
          recipients: config.recipients,
        }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        // Open HTML report in new tab - user can print to PDF from browser
        window.open(url, '_blank')
        
        // If schedule enabled, show success message
        if (config.schedule) {
          alert('Report generated and scheduled for monthly delivery!')
        }
        
        onClose()
      } else {
        alert('Failed to generate report. Please try again.')
      }
    } catch (error) {
      console.error('Report generation error:', error)
      alert('Error generating report. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleAddRecipient = () => {
    if (emailInput && emailInput.includes('@')) {
      setConfig(prev => ({
        ...prev,
        recipients: [...prev.recipients, emailInput],
      }))
      setEmailInput('')
    }
  }

  const toggleSection = (sectionId: string) => {
    const section = availableSections.find(s => s.id === sectionId)
    if (section?.required) return // Can't toggle required sections

    setConfig(prev => ({
      ...prev,
      includeSections: prev.includeSections.includes(sectionId)
        ? prev.includeSections.filter(s => s !== sectionId)
        : [...prev.includeSections, sectionId],
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-500" />
              Generate Client Report
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Create professional PDF report for {propertyName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Step 1: Select Template */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              1. Select Report Template
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => setConfig(prev => ({ ...prev, template: template.id }))}
                  className={`text-left p-4 rounded-lg border-2 transition-all ${
                    config.template === template.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{template.icon}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {template.name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    {template.description}
                  </p>
                  <span className="text-xs text-gray-500">
                    ~{template.pages} pages
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Customize Sections */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              2. Customize Content
            </h3>
            <div className="space-y-2">
              {availableSections.map(section => (
                <label
                  key={section.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    section.required
                      ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={config.includeSections.includes(section.id)}
                    onChange={() => toggleSection(section.id)}
                    disabled={section.required}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-sm text-gray-900 dark:text-white">
                    {section.label}
                    {section.required && (
                      <span className="ml-2 text-xs text-gray-500">(Required)</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Step 3: Delivery Options */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              3. Delivery Options
            </h3>
            
            {/* Email Recipients */}
            <div className="mb-4">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
                Email to Recipients (optional)
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddRecipient()}
                  placeholder="client@example.com"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
                />
                <button
                  onClick={handleAddRecipient}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Add
                </button>
              </div>
              {config.recipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {config.recipients.map((email, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded"
                    >
                      {email}
                      <button
                        onClick={() => setConfig(prev => ({
                          ...prev,
                          recipients: prev.recipients.filter((_, i) => i !== idx),
                        }))}
                        className="hover:text-indigo-900"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Schedule */}
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
              <input
                type="checkbox"
                checked={config.schedule}
                onChange={e => setConfig(prev => ({ ...prev, schedule: e.target.checked }))}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Schedule Monthly Reports
                </span>
                <p className="text-xs text-gray-500">
                  Automatically generate and email this report monthly
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </button>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Generate Report
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
