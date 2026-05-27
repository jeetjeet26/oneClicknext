'use client'

import { useEffect, useState } from 'react'

type IntakeCandidate = {
  id: string
  seedName: string
  seedLocation: string | null
  enrichmentStatus: string
  competitorId: string | null
  errorMessage: string | null
}

type IntakeBatch = {
  id: string
  status: string
  errorMessage: string | null
}

type CompetitorIntakePanelProps = {
  propertyId: string
  onComplete?: () => void
}

export function CompetitorIntakePanel({ propertyId, onComplete }: CompetitorIntakePanelProps) {
  const [rawText, setRawText] = useState('')
  const [batch, setBatch] = useState<IntakeBatch | null>(null)
  const [candidates, setCandidates] = useState<IntakeCandidate[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!batch || batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/competitors/intake?propertyId=${propertyId}&batchId=${batch.id}`
        )
        const data = await response.json()
        if (!response.ok) return

        setBatch(data.batch)
        setCandidates(data.candidates || [])
        if (data.batch?.status === 'completed') {
          onComplete?.()
        }
      } catch (pollError) {
        console.error('Failed to poll competitor intake batch:', pollError)
      }
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [batch, propertyId, onComplete])

  const submitIntake = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/competitors/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, rawText }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit competitor intake')
      }

      setBatch(data.batch)
      setCandidates(data.candidates || [])
      setRawText('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit competitor intake')
    } finally {
      setIsSubmitting(false)
    }
  }

  const completedCount = candidates.filter(candidate => candidate.enrichmentStatus === 'completed').length

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Client-Provided Competitor Intake</h3>
          <p className="mt-1 text-sm text-gray-600">
            Paste client notes here. The notes are stored as search seeds only; online enrichment fills the canonical cards and vector KB.
          </p>
        </div>
        {batch && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-700">
            {batch.status}
          </span>
        )}
      </div>

      <textarea
        value={rawText}
        onChange={event => setRawText(event.target.value)}
        rows={5}
        placeholder="Paste competitor names, locations, URLs, and client notes..."
        className="mt-4 w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />

      {error && (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 p-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {candidates.length > 0
            ? `${completedCount} of ${candidates.length} competitors enriched`
            : 'Competitor knowledge will be scoped to this property.'}
        </p>
        <button
          type="button"
          onClick={submitIntake}
          disabled={isSubmitting || rawText.trim().length < 20}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Submit For Enrichment'}
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="mt-4 divide-y divide-indigo-100 rounded-lg bg-white">
          {candidates.map(candidate => (
            <div key={candidate.id} className="flex items-center justify-between gap-4 p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{candidate.seedName}</p>
                {candidate.seedLocation && (
                  <p className="text-xs text-gray-500">{candidate.seedLocation}</p>
                )}
                {candidate.errorMessage && (
                  <p className="mt-1 text-xs text-red-600">{candidate.errorMessage}</p>
                )}
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {candidate.enrichmentStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
