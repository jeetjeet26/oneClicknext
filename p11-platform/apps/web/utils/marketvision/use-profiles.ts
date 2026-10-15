'use client'
import { useEffect, useState } from 'react'
import type { CompetitorProfiles } from './profiles'
export function useCompetitorProfiles(propertyId: string | undefined) {
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{key: string; data: CompetitorProfiles | null; error: string | null} | null>(null)
  const key = `${propertyId}:${reload}`
  useEffect(() => {
    if (!propertyId) return
    const controller = new AbortController()
    void fetch(`/api/marketvision/profiles?${new URLSearchParams({propertyId})}`, {signal: controller.signal, cache: 'no-store'})
      .then(async response => {const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Competitor profiles could not be loaded.'); return data as CompetitorProfiles})
      .then(data => {if (!controller.signal.aborted) setResult({key, data, error: null})})
      .catch(error => {if (!controller.signal.aborted) setResult({key, data: null, error: error instanceof Error ? error.message : 'Competitor profiles could not be loaded.'})})
    return () => controller.abort()
  }, [propertyId, key])
  const current = result?.key === key ? result : null
  return {data: current?.data ?? null, error: current?.error ?? null, loading: Boolean(propertyId) && !current, refresh: () => setReload(v => v + 1)}
}
