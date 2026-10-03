'use client'

import { useState, useEffect, useCallback } from 'react'
import {CompetitorUnitsPanel} from './CompetitorUnitsPanel'
import {CompetitorExtractionPanel} from './CompetitorExtractionPanel'
import {CompetitorListingPanel} from './CompetitorListingPanel'
import {CompetitorSourcePanel} from './CompetitorSourcePanel'
import {
  X,
  Building2,
  MapPin,
  Phone,
  ExternalLink,
  Home,
  Edit2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

interface CompetitorUnit {
  id: string
  unitType: string
  bedrooms: number
  bathrooms: number | null
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  availableCount: number | null
  moveInSpecials: string | null
  lastUpdatedAt: string
}

interface Competitor {
  version: number
  id: string
  propertyId?: string
  name: string
  address: string | null
  websiteUrl: string | null
  phone: string | null
  unitsCount: number | null
  yearBuilt: number | null
  propertyType: string
  amenities: string[]
  photos: string[]
  ilsListings?: Record<string, string>
  notes: string | null
  isActive: boolean
  lastScrapedAt: string | null
  units?: CompetitorUnit[]
}

interface CompetitorDetailDrawerProps {
  competitor: Competitor | null
  onClose: () => void
  onEdit: (competitor: Competitor) => void
}

interface RefreshStatus {
  loading: boolean
  message: string | null
  type: 'success' | 'error' | 'info' | null
}

export function CompetitorDetailDrawer({ 
  competitor, 
  onClose,
  onEdit
}: CompetitorDetailDrawerProps) {
  const scopeId=competitor?.id,scopeProperty=competitor?.propertyId,sourceUnits=competitor?.units
  const [units, setUnits] = useState<CompetitorUnit[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    loading: false,
    message: null,
    type: null
  })
  
  const [sourceGeneration,setSourceGeneration]=useState(0)
  const [openExtraction,setOpenExtraction]=useState<{competitorId:string;id:string}|null>(null)
  const [listingGeneration,setListingGeneration]=useState(0)

  const fetchUnits = useCallback(async () => {
    if (!scopeId || !scopeProperty) return

    setLoading(true)
    try {
      const res = await fetch(`/api/marketvision/units?propertyId=${scopeProperty}&competitorId=${scopeId}`)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error||'Unit values could not be loaded.')
      setUnits(data.units || [])
    } catch (err) {
      setRefreshStatus({loading:false,type:'error',message:err instanceof Error?err.message:'Unit values could not be loaded.'})
    } finally {
      setLoading(false)
    }
  },[scopeId,scopeProperty])

  useEffect(() => {
    if (scopeId) {
      if (sourceUnits) {
        setUnits(sourceUnits)
      } else {
        fetchUnits()
      }
      // Reset state when competitor changes
      setRefreshStatus({ loading: false, message: null, type: null })


    }
  }, [scopeId,sourceUnits,fetchUnits])

  if (!competitor) return null

  const knownPrices = units.flatMap(u=>u.rentMin===null?[]:[u.rentMin])
  const avgRent = knownPrices.length ? Math.round(knownPrices.reduce((a,b)=>a+b,0)/knownPrices.length) : null
  const totalAvailable = units.length && units.every(u=>u.availableCount!==null) ? units.reduce((sum,u)=>sum+(u.availableCount??0),0) : null

  return (
    <div role="dialog" aria-label="Competitor details" className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Building2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-lg">
              {competitor.name}
            </h2>
            {competitor.address && (
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                <MapPin className="w-3.5 h-3.5" />
                {competitor.address}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="Edit competitor details"
            onClick={() => onEdit(competitor)}
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Edit2 className="w-5 h-5" />
          </button>
          <button
            aria-label="Close competitor details"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 dark:bg-gray-700/30">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {avgRent!==null ? `$${avgRent.toLocaleString()}` : 'Unknown'}
            </p>
            <p className="text-xs text-gray-500">Avg Rent</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {units.length}
            </p>
            <p className="text-xs text-gray-500">Unit Types</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {totalAvailable??'Unknown'}
            </p>
            <p className="text-xs text-gray-500">Available</p>
          </div>
        </div>

        {/* Property Info */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Property Details
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {competitor.unitsCount && (
              <div>
                <p className="text-gray-500">Total Units</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {competitor.unitsCount}
                </p>
              </div>
            )}
            {competitor.yearBuilt && (
              <div>
                <p className="text-gray-500">Year Built</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {competitor.yearBuilt}
                </p>
              </div>
            )}
            <div>
              <p className="text-gray-500">Property Type</p>
              <p className="font-medium text-gray-900 dark:text-white capitalize">
                {competitor.propertyType}
              </p>
            </div>
            {competitor.lastScrapedAt && (
              <div>
                <p className="text-gray-500">Last Updated</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {new Date(competitor.lastScrapedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {/* Contact Links */}
          <div className="flex items-center gap-3 mt-4">
            {competitor.websiteUrl && (
              <a
                href={competitor.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Website
              </a>
            )}
            {competitor.phone && (
              <a
                href={`tel:${competitor.phone}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call
              </a>
            )}
          </div>
        </div>

        {/* Amenities */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              Amenities
            </h3>
            {competitor.amenities.length > 0 && (
              <span className="text-xs text-gray-500">
                {competitor.amenities.length} amenities
              </span>
            )}
          </div>
          {competitor.amenities.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {competitor.amenities.map((amenity, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full"
                >
                  {amenity}
                </span>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-400">No amenities recorded</p>
              <button
                aria-label="Edit competitor details"
            onClick={() => onEdit(competitor)}
                className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Add amenities →
              </button>
            </div>
          )}
        </div>

        {refreshStatus.message && <p role="alert" className="p-4 text-sm text-red-700">{refreshStatus.message}</p>}
        {competitor.propertyId && <div className="p-4"><CompetitorListingPanel key={`${competitor.propertyId}:${competitor.id}`} propertyId={competitor.propertyId} competitorId={competitor.id} onChanged={()=>{setSourceGeneration(v=>v+1);setListingGeneration(v=>v+1)}} /></div>}

        {competitor.propertyId && <div className="p-4"><CompetitorSourcePanel key={`${competitor.id}:${listingGeneration}`} propertyId={competitor.propertyId} competitorId={competitor.id} onExtractionReady={id=>setOpenExtraction({competitorId:competitor.id,id})} /></div>}
        {competitor.propertyId && <div className="p-4"><CompetitorExtractionPanel key={competitor.id} openRequestId={openExtraction?.competitorId===competitor.id?openExtraction.id:undefined} propertyId={competitor.propertyId} competitorId={competitor.id} onApplied={()=>{setSourceGeneration(v=>v+1);void fetchUnits()}} /></div>}

        {/* Unit Pricing */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Unit Types
            </h3>
            <button
              onClick={fetchUnits}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
            </div>
          ) : units.length === 0 ? (
            <div className="py-8 text-center">
              <Home className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No unit data available</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...units]
                .sort((a, b) => a.bedrooms - b.bedrooms)
                .map((unit) => (
                  <div
                    key={unit.id}
                    className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {unit.unitType}
                        </span>
                        {unit.availableCount !== null && unit.availableCount > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                            {unit.availableCount} available
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        {unit.rentMin !== null ? (
                          <p className="font-semibold text-gray-900 dark:text-white">
                            ${unit.rentMin.toLocaleString()}
                            {unit.rentMax !== null && unit.rentMax !== unit.rentMin && (
                              <span className="text-gray-500 font-normal">
                                {' '}- ${unit.rentMax.toLocaleString()}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-gray-400">No pricing</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        {unit.bedrooms} bed • {unit.bathrooms===null?'Bathrooms unknown':`${unit.bathrooms} bath`}
                      </span>
                      {unit.sqftMin && (
                        <span>
                          {unit.sqftMin.toLocaleString()}
                          {unit.sqftMax && unit.sqftMax !== unit.sqftMin && (
                            <> - {unit.sqftMax.toLocaleString()}</>
                          )} sq ft
                        </span>
                      )}
                      {unit.rentMin && unit.sqftMin && (
                        <span className="text-indigo-600 dark:text-indigo-400">
                          ${(unit.rentMin / unit.sqftMin).toFixed(2)}/sq ft
                        </span>
                      )}
                    </div>

                    {unit.moveInSpecials && (
                      <div className="mt-2 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300">
                        🎁 {unit.moveInSpecials}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {competitor.propertyId && <div className="px-6 py-4"><CompetitorUnitsPanel key={`${competitor.id}:${sourceGeneration}`} propertyId={competitor.propertyId} competitorId={competitor.id} onChanged={()=>{void fetchUnits()}} /></div>}
        {/* Notes */}
        {competitor.notes && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Notes
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {competitor.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

