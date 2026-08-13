'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { PersistedSiteForgeBrief } from '@/utils/siteforge/briefs/repository'
import type { PersistedSiteForgeDirectionSet } from '@/utils/siteforge/directions/repository'

export function selectedDirectionHash(
  directionSet: PersistedSiteForgeDirectionSet
): string | null {
  return (
    directionSet.directions.find(
      direction => direction.id === directionSet.selectedDirectionId
    )?.contentHash || null
  )
}

export function SiteForgeCreativeDirections({
  websiteId,
  onChanged,
}: {
  websiteId: string
  onChanged?: () => void
}) {
  const [approvedBrief, setApprovedBrief] =
    useState<PersistedSiteForgeBrief | null>(null)
  const [sets, setSets] = useState<PersistedSiteForgeDirectionSet[]>([])
  const [selectionNotes, setSelectionNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [briefResponse, directionResponse] = await Promise.all([
      fetch(`/api/siteforge/briefs?websiteId=${encodeURIComponent(websiteId)}`, {
        cache: 'no-store',
      }),
      fetch(
        `/api/siteforge/directions?websiteId=${encodeURIComponent(websiteId)}`,
        { cache: 'no-store' }
      ),
    ])
    const [briefBody, directionBody] = await Promise.all([
      briefResponse.json().catch(() => ({})),
      directionResponse.json().catch(() => ({})),
    ])
    if (!briefResponse.ok) {
      throw new Error(briefBody.error || 'Failed to load approved brief')
    }
    if (!directionResponse.ok) {
      throw new Error(
        directionBody.error || 'Failed to load creative directions'
      )
    }
    const briefs = (briefBody.briefs || []) as PersistedSiteForgeBrief[]
    setApprovedBrief(briefs.find(brief => brief.status === 'approved') || null)
    setSets(directionBody.directionSets || [])
  }, [websiteId])

  useEffect(() => {
    void load().catch(cause =>
      setError(
        cause instanceof Error ? cause.message : 'Failed to load directions'
      )
    )
  }, [load])

  async function createDirections() {
    if (!approvedBrief) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefVersionId: approvedBrief.id,
          propertyId: approvedBrief.propertyId,
          expectedSetVersion: sets[0]?.version || 0,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to create creative directions')
      }
      setMessage('Created three deterministic, source-pinned directions.')
      await load()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to create directions'
      )
    } finally {
      setBusy(false)
    }
  }

  async function select(directionId: string) {
    const current = sets[0]
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/directions/${current.id}/selection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: current.propertyId,
            selectedDirectionId: directionId,
            expectedContentHash: current.contentHash,
            selectionNotes,
          }),
        }
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to select creative direction')
      }
      setMessage('Selected direction confirmed with its exact set and content hashes.')
      await load()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to save selection'
      )
    } finally {
      setBusy(false)
    }
  }

  const current = sets[0]
  const selected = current?.directions.find(
    direction => direction.id === current.selectedDirectionId
  )
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Creative directions</h2>
          <p className="text-sm text-gray-500">
            Compare materially distinct options generated from the exact approved brief and BrandForge identity.
          </p>
        </div>
        <Button onClick={() => void createDirections()} disabled={busy || !approvedBrief}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {current ? 'Create new set' : 'Create directions'}
        </Button>
      </div>
      {!approvedBrief ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Approve a current, contradiction-free brief before creating directions.
        </p>
      ) : null}
      {current ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">Set v{current.version}</Badge>
            <Badge variant="secondary">{current.status}</Badge>
            <span className="font-mono text-xs text-gray-500">
              {current.contentHash.slice(0, 12)}…
            </span>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {current.directions.map(direction => {
              const isSelected = direction.id === current.selectedDirectionId
              return (
                <Card key={direction.id} className={isSelected ? 'ring-2 ring-indigo-500' : ''}>
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-2">
                      {direction.name}
                      {isSelected ? <Badge variant="default"><Check className="mr-1 h-3 w-3" />Selected</Badge> : null}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex gap-1" aria-label={`${direction.name} palette`}>
                      {direction.previewManifest.paletteSwatches.map(color => (
                        <span key={color} className="h-8 flex-1 rounded border" style={{ backgroundColor: color }} title={color} />
                      ))}
                    </div>
                    <p>{direction.direction.rationale}</p>
                    <Detail label="Typography" value={`${direction.direction.typography.headingFamily} / ${direction.direction.typography.bodyFamily}`} />
                    <Detail label="Hero" value={direction.direction.hero.composition} />
                    <Detail label="Layout" value={direction.direction.layout.system} />
                    <Detail label="Imagery" value={direction.direction.imagery.style} />
                    <Detail label="CTA" value={`${direction.direction.cta.label} · ${direction.direction.cta.placement}`} />
                    <Detail label="Voice" value={direction.direction.voice.traits.join(', ')} />
                    <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
                      {direction.direction.tradeoffs.map(tradeoff => <li key={tradeoff}>{tradeoff}</li>)}
                    </ul>
                    <p className="font-mono text-[11px] text-gray-400">
                      {direction.contentHash.slice(0, 16)}…
                    </p>
                    <Button className="w-full" variant={isSelected ? 'outline' : 'default'} disabled={busy || current.status === 'approved'} onClick={() => void select(direction.id!)}>
                      {isSelected ? 'Selected for execution' : 'Use this direction'}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {current.status !== 'approved' && current.status !== 'denied' ? (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <Textarea value={selectionNotes} onChange={event => setSelectionNotes(event.target.value)} placeholder="Optional tradeoff notes" />
                {selected ? (
                  <p className="text-xs font-mono text-gray-500">Selected hash: {selectedDirectionHash(current)}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span><p className="mt-0.5 text-xs">{value}</p></div>
}
