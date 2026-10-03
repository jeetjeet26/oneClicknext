'use client'

import { Globe, Loader2 } from 'lucide-react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { SiteForgeCodexBrief } from '@/components/siteforge/SiteForgeCodexBrief'
import {SiteForgeDeliveryRecords}from '@/components/siteforge/SiteForgeDeliveryRecords'
import ExistingConsoleWebsites from '@/components/siteforge/ExistingConsoleWebsites'

export default function SiteForgePage() {
  const { currentProperty, loading, hasLoadedProperties } = usePropertyContext()

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <Globe className="h-7 w-7 text-indigo-500" aria-hidden="true" />SiteForge
        </h1>
        <p className="mt-1 text-gray-700 dark:text-gray-300">Website delivery and maintenance with Codex</p>
      </header>
      {loading ? (
        <p role="status" className="flex items-center gap-2 py-8 text-gray-600 dark:text-gray-300"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading your property…</p>
      ) : !hasLoadedProperties ? (
        <div role="alert" className="rounded-xl border border-gray-200 bg-white p-6 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <p>Your property records are unavailable. Reload the page, or check property setup before preparing a brief.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">Reload properties</button>
        </div>
      ) : currentProperty ? (
        <>
          <SiteForgeCodexBrief key={`brief-${currentProperty.id}`} property={currentProperty} />
          <SiteForgeDeliveryRecords key={`delivery-${currentProperty.id}`} propertyId={currentProperty.id}/>
          <ExistingConsoleWebsites key={`records-${currentProperty.id}`} property={currentProperty} />
        </>
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">Select a property to prepare a website brief and view its earlier console projects.</p>
      )}
    </div>
  )
}
