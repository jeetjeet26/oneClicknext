"use client"
import Link from 'next/link'
import { useState } from 'react'
import { ExistingBrandImportWizard } from './ExistingBrandImportWizard'
export function BrandImportPanel({ propertyId }: { propertyId: string }) {
  const [approved, setApproved] = useState(false)
  if (approved) return <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
    <h2 className="text-xl font-semibold">Existing brand approved</h2>
    <p className="mt-2 text-slate-300">Your reviewed brand and source decisions are saved. Publish it to assistant knowledge when you are ready.</p>
    <div className="mt-5 flex flex-wrap gap-4"><Link className="rounded-lg bg-indigo-600 px-4 py-2" href={`/dashboard/brandforge/${propertyId}`}>View brand book</Link><Link className="rounded-lg border border-slate-600 px-4 py-2" href={`/dashboard/brandforge/${propertyId}/create`}>Export or publish brand</Link></div>
  </section>
  return <ExistingBrandImportWizard key={propertyId} propertyId={propertyId} onComplete={() => setApproved(true)} />
}
