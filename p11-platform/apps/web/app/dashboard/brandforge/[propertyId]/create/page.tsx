'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { BrandForgeWizard } from '@/components/brandforge/BrandForgeWizard'

export default function BrandForgeCreatePage({ 
  params 
}: { 
  params: Promise<{ propertyId: string }> 
}) {
  const { propertyId } = use(params)
  const router = useRouter()
  const [property, setProperty] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProperty()
  }, [propertyId])

  async function fetchProperty() {
    try {
      const res = await fetch(`/api/properties/${propertyId}`)
      const data = await res.json()
      setProperty(data.property)
    } catch (err) {
      console.error('Failed to fetch property:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleComplete() {
    router.prefetch(`/dashboard/brandforge/${propertyId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (!property) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Property Not Found</h1>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/dashboard/community')}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Property
          </button>
          
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Generate Brand Book
          </h1>
          <p className="text-slate-600">
            For {property.name}
          </p>
        </div>

        {/* BrandForge Wizard */}
        <BrandForgeWizard
          propertyId={propertyId}
          propertyAddress={property.address || {}}
          propertyType={property.property_type || 'multifamily'}
          onComplete={handleComplete}
        />
      </div>
    </div>
  )
}






