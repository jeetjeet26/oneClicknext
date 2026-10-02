import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { BrandImportPanel } from '@/components/brandforge/BrandImportPanel'

export default async function ImportBrandPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) notFound()
  const { data: property } = await client.from('properties').select('id,name').eq('id', propertyId).single()
  if (!property) notFound()
  return <main className="min-h-screen bg-slate-950 p-6 text-white sm:p-10"><div className="mx-auto max-w-4xl space-y-6">
    <Link href={`/dashboard/brandforge/${propertyId}`} className="text-sm text-indigo-300">Back to brand</Link>
    <div><h1 className="text-3xl font-semibold">Import an existing brand</h1><p className="mt-2 text-slate-400">Review supplied materials for {property.name}. Your current brand stays in place until you approve this import.</p></div>
    <BrandImportPanel propertyId={propertyId} />
  </div></main>
}
