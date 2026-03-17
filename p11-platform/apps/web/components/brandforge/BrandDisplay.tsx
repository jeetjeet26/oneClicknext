'use client'

import { Sparkles, Eye, Download, Palette, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface BrandDisplayProps {
  propertyId: string
}

export function BrandDisplay({ propertyId }: BrandDisplayProps) {
  const [brandAsset, setBrandAsset] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBrandAsset()
  }, [propertyId])

  async function fetchBrandAsset() {
    try {
      const res = await fetch(`/api/brandforge/status?propertyId=${propertyId}`)
      const data = await res.json()
      
      if (data.exists) {
        setBrandAsset(data.brandAsset)
      } else {
        setBrandAsset(null)
      }
    } catch (err) {
      console.error('Failed to fetch brand asset:', err)
      setBrandAsset(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100 p-6 animate-pulse">
        <div className="h-6 bg-purple-200 rounded w-1/3 mb-4"></div>
        <div className="h-20 bg-purple-100 rounded"></div>
      </div>
    )
  }

  if (!brandAsset) {
    return null // Don't show if no brand asset exists
  }

  const colors = [
    brandAsset.colors?.primary?.hex,
    brandAsset.colors?.secondary?.hex,
    ...(brandAsset.colors?.accents?.map((a: any) => a.hex) || [])
  ].filter(Boolean)

  return (
    <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          Brand Identity
        </h3>
        <Link
          href={`/dashboard/brandforge/${propertyId}`}
          className="text-sm text-purple-600 hover:text-purple-700 font-medium"
        >
          View Full Brand →
        </Link>
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
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 text-center">
          <Palette className="w-5 h-5 text-purple-600 mx-auto mb-2" />
          <p className="text-xs font-medium text-slate-500">Brand Voice</p>
          <p className="text-sm font-semibold text-slate-900 capitalize">
            {brandAsset.brandName || 'Generated'}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 text-center">
          <Type className="w-5 h-5 text-purple-600 mx-auto mb-2" />
          <p className="text-xs font-medium text-slate-500">Progress</p>
          <p className="text-sm font-semibold text-slate-900">
            {brandAsset.progress}%
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 text-center">
          <Sparkles className="w-5 h-5 text-purple-600 mx-auto mb-2" />
          <p className="text-xs font-medium text-slate-500">Sections</p>
          <p className="text-sm font-semibold text-slate-900">
            {brandAsset.approvedSections}/12
          </p>
        </div>
      </div>

      {brandAsset.statusMessage && (
        <p className="mt-4 text-sm text-slate-600">{brandAsset.statusMessage}</p>
      )}
      {brandAsset.nextRecommendedAction && (
        <p className="mt-1 text-xs text-slate-500">{brandAsset.nextRecommendedAction}</p>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Link
          href={`/dashboard/brandforge/${propertyId}`}
          className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-center text-sm font-medium flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4" />
          View Brand Book
        </Link>
        {brandAsset.pdfUrl && (
          <a
            href={brandAsset.pdfUrl}
            download
            className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 text-sm font-medium flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </a>
        )}
      </div>
    </div>
  )
}

