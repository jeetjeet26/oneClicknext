'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { intakeSchema, SOURCE_KINDS, SETUP_PRODUCTS, type SetupIntake, type SourcePlan } from '@/utils/property-setup/intake'

export function propertyWorkflow(path: string, propertyId: string) {
  const url = new URL(path, 'https://local.invalid')
  url.searchParams.set('propertyId', propertyId)
  return `${url.pathname}${url.search}${url.hash}`
}
function sourceWorkflow(kind: SourcePlan['kind']) {
  if (kind === 'pms' || kind === 'csv') return ['/dashboard/floor-plans', 'Review inventory import']
  if (kind === 'document' || kind === 'brand') return ['/dashboard/community?section=files', 'Upload and review originals']
  if (kind === 'manual') return ['/dashboard/community?section=facts', 'Review property facts']
  return ['/dashboard/community?section=knowledge', 'Authorize or capture source']
}

/** The source plan stays visible beside the authoritative review workflows. */
export function SetupHandoff({ propertyId }: { propertyId: string }) {
  const [intake, setIntake] = useState<SetupIntake | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/properties/${propertyId}/setup`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Setup source references are unavailable. Reload to try again.'); return response.json() })
      .then(value => { const parsed = intakeSchema.safeParse(value.snapshot?.profile?.intake); if (!controller.signal.aborted && parsed.success) setIntake(parsed.data) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [propertyId])
  if (error) return <p role="status" className="text-sm">{error}</p>
  if (!intake) return null
  return <section aria-label="Saved setup handoff" className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <h2 className="text-lg font-semibold">Your setup plan</h2>
    <p>{intake.products.map(key => SETUP_PRODUCTS[key]).join(' · ') || 'Products have not been selected yet.'}</p>
    <p className="text-sm">Owner: {intake.setupOwner || 'Not assigned'} · Launch target: {intake.launchTarget || 'Not set'} · Review coordinator: {intake.reviewer || 'Not assigned'}</p>
    {(intake.successMetric || intake.successTarget) && <p>Success measure: {[intake.successMetric, intake.successTarget].filter(Boolean).join(' · ')}</p>}
    <p className="text-sm">Use these references when importing. Review sources, extracted facts, inventory, rights and effective dates in the linked workflows. Saving this plan does not approve their contents.</p>
    <ul className="space-y-3">{intake.sources.map(source => { const [href, label] = sourceWorkflow(source.kind); return <li key={source.id} className="space-y-1 rounded-lg border p-3 text-sm">
      <p className="font-medium">{source.label || SOURCE_KINDS[source.kind]} · Referenced; review required</p>
      {source.reference && <p className="break-all">{source.reference}</p>}
      <p>{[source.provider, source.externalId, source.owner && `Owner: ${source.owner}`].filter(Boolean).join(' · ')}</p>
      <p>Observed: {source.observedAt || 'Unknown'} · Review by: {source.reviewAfter || 'Not set'} · Intended visibility: {source.visibility}</p>
      {source.notes && <p className="whitespace-pre-wrap">{source.notes}</p>}
      <Link className="inline-block py-2 text-indigo-700 underline dark:text-indigo-300" href={propertyWorkflow(href, propertyId)}>{label}</Link>
    </li> })}</ul>
    <nav aria-label="Setup review workflows" className="flex flex-wrap gap-4 text-sm text-indigo-700 underline dark:text-indigo-300">
      <Link href={`/dashboard/properties/${propertyId}/edit`}>Edit setup and source references</Link>
      <Link href={propertyWorkflow('/dashboard/community?section=facts', propertyId)}>Review fees, policies and property facts</Link>
      <Link href={propertyWorkflow('/dashboard/community?section=files', propertyId)}>Review files and asset rights</Link>
      {intake.products.some(product => ['website', 'creative'].includes(product)) && <Link href={`/dashboard/brandforge/${propertyId}`}>Review or create the property brand</Link>}
      <Link href={propertyWorkflow('/dashboard/floor-plans', propertyId)}>Review inventory and offering dates</Link>
    </nav>
  </section>
}
