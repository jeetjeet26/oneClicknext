'use client'

import { Sparkles, Eye, Download, Palette, Plus, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PropertyBrandInsightsCard } from '@/components/brandforge/PropertyBrandInsightsCard'

interface BrandIdentitySectionProps {
  propertyId: string
  propertyName: string
}

export function BrandIdentitySection({ propertyId, propertyName }: BrandIdentitySectionProps) {
  const router = useRouter()
  const [brandAsset, setBrandAsset] = useState<any>(null)
  const [hasDocuments, setHasDocuments] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBrandData()
  }, [propertyId])

  async function fetchBrandData() {
    try {
      // Check for formal brand book
      const brandRes = await fetch(`/api/brandforge/status?propertyId=${propertyId}`)
      const brandData = await brandRes.json()
      
      if (brandData.exists) {
        setBrandAsset(brandData.brandAsset)
      }

      // Check for existing documents (for insights extraction)
      const docsRes = await fetch(`/api/documents?propertyId=${propertyId}`)
      const docsData = await docsRes.json()
      
      if (docsData.documents && docsData.documents.length > 0) {
        setHasDocuments(true)
      }
    } catch (err) {
      console.error('Failed to fetch brand data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-20 bg-gray-100 rounded"></div>
      </div>
    )
  }

  // If formal brand book exists, show that
  if (brandAsset) {
    return <FormalBrandBookCard brandAsset={brandAsset} propertyId={propertyId} />
  }

  // If documents exist, show AI-extracted insights (MarketVision style)
  if (hasDocuments) {
    return <PropertyBrandInsightsCard propertyId={propertyId} propertyName={propertyName} />
  }

  // No brand data at all
  return null
}

// Formal brand book card (when generated via BrandForge)
function FormalBrandBookCard({ brandAsset, propertyId }: any) {

  const colors = [
    brandAsset.colors?.primary?.hex,
    brandAsset.colors?.secondary?.hex,
    ...(brandAsset.colors?.accents?.map((a: any) => a.hex) || [])
  ].filter(Boolean)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            Brand Book
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Generated via BrandForge AI
          </p>
        </div>
      </div>

      {/* Color Palette */}
      {colors.length > 0 && (
        <div className="flex gap-2 mb-4">
          {colors.slice(0, 5).map((color, idx) => (
            <div
              key={idx}
              className="w-12 h-12 rounded-lg border-2 border-white shadow-sm"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {/* Brand Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <Palette className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
          <p className="text-xs font-medium text-gray-500">Brand Name</p>
          <p className="text-sm font-semibold text-gray-900">
            {brandAsset.brandName || 'Generated'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <FileText className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
          <p className="text-xs font-medium text-gray-500">Progress</p>
          <p className="text-sm font-semibold text-gray-900">
            {brandAsset.progress}%
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <Sparkles className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
          <p className="text-xs font-medium text-gray-500">Sections</p>
          <p className="text-sm font-semibold text-gray-900">
            {brandAsset.approvedSections}/12
          </p>
        </div>
      </div>

      {brandAsset.statusMessage && (
        <p className="mb-4 text-sm text-gray-500">{brandAsset.statusMessage}</p>
      )}
      {brandAsset.nextRecommendedAction && (
        <p className="mb-4 text-xs text-gray-500">{brandAsset.nextRecommendedAction}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="text-xs text-gray-500">
          {brandAsset.isComplete ? 'Complete' : 'In Progress'}
        </div>
        
        <div className="flex gap-2">
          <Link
            href={`/dashboard/brandforge/${propertyId}`}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
          >
            <Eye className="w-3.5 h-3.5" />
            View Details
          </Link>
          {brandAsset.pdfUrl && (
            <a
              href={brandAsset.pdfUrl}
              download
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </a>
          )}
        </div>
      </div>
    </div>
  )
}


