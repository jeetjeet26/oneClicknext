'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {sendMarketDecision} from '@/utils/marketvision/decision-client'
import { 
  Building2, 
  ExternalLink, 
  Phone, 
  MapPin, 
  MoreVertical,
  Edit2,
  Eye,
  Plus,
  Search,
  RefreshCw
} from 'lucide-react'

interface CompetitorUnit {
  id: string
  unitType: string
  bedrooms: number
  rentMin: number | null
  rentMax: number | null
  availableCount: number
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
  photos?: string[]
  ilsListings?: Record<string, string>
  notes?: string | null
  isActive: boolean
  lastScrapedAt: string | null
  units?: CompetitorUnit[]
}

interface CompetitorListProps {
  propertyId: string | undefined
  onAddClick: () => void
  onEditClick: (competitor: Competitor) => void
  onViewClick: (competitor: Competitor) => void
  onRefresh?: () => void
}

export function CompetitorList({ 
  propertyId, 
  onAddClick, 
  onEditClick, 
  onViewClick
}: CompetitorListProps) {
  const readGeneration=useRef(0)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [error,setError]=useState<string|null>(null)
  const [decision,setDecision]=useState<Competitor|null>(null)
  const [reason,setReason]=useState('')
  const [saving,setSaving]=useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const fetchCompetitors = useCallback(async () => {
    if (!propertyId) return

    const generation=++readGeneration.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        propertyId,
        includeUnits: 'true',
        activeOnly: (!showInactive).toString()
      })

      const res = await fetch(`/api/marketvision/competitors?${params}`)
      const data = await res.json()
      if(generation!==readGeneration.current)return
      if (!res.ok) throw new Error(data.error || 'Competitors could not be loaded.')
      setCompetitors(data.competitors || [])
    } catch (err) {
      if(generation!==readGeneration.current)return
      setError(err instanceof Error ? err.message : 'Competitors could not be loaded.')
      setCompetitors([])
    } finally {
      if(generation===readGeneration.current)setLoading(false)
    }
  },[propertyId,showInactive])
  const cancelRead=useCallback(()=>{readGeneration.current++},[])
  useEffect(()=>{void fetchCompetitors();return cancelRead},[fetchCompetitors,cancelRead])

  const handleToggleActive = async () => {
    if(!decision || !propertyId)return
    setSaving(true);setError(null)
    try{await sendMarketDecision('/api/marketvision/competitors','PUT',{propertyId,competitorId:decision.id,expectedVersion:decision.version,action:decision.isActive?'archive':'restore',reason});setDecision(null);setReason('');await fetchCompetitors()}
    catch(e){setError(e instanceof Error?e.message:'This decision could not be confirmed.')}
    finally{setSaving(false)}
  }

  const filteredCompetitors = competitors.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.address?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Calculate average rent for a competitor
  const getAvgRent = (units?: CompetitorUnit[]) => {
    if (!units || units.length === 0) return null
    const rents = units.filter(u => u.rentMin).map(u => u.rentMin!)
    if (rents.length === 0) return null
    return Math.round(rents.reduce((a, b) => a + b, 0) / rents.length)
  }

  if (!propertyId) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">Select a property to view competitors</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-500" />
            Competitors
            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
              {competitors.length}
            </span>
          </h2>
          <button
            onClick={onAddClick}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Competitor
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search competitors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              disabled={saving} checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Show inactive
          </label>
          <button
            disabled={saving} aria-label="Reload competitors"
            onClick={fetchCompetitors}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="p-4 text-red-700">{error} <button onClick={()=>{setDecision(null);void fetchCompetitors()}} className="underline">Reload competitors</button></p>}
      {decision && <section aria-label="Review competitor status" className="p-4 border-y space-y-3"><p>{decision.isActive?'Archive':'Restore'} {decision.name}? Saved units and history will be retained.</p><label className="block text-sm">Reason for status change<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={2000} className="block border rounded p-2 w-full" /></label><button disabled={saving||reason.trim().length<3} onClick={handleToggleActive} className="border rounded px-3 py-2 disabled:opacity-50">{saving?'Saving…':decision.isActive?'Archive competitor':'Restore competitor'}</button> <button disabled={saving} onClick={()=>setDecision(null)}>Cancel</button></section>}
      {/* Competitor List */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-4" />
            <p className="text-gray-500">Loading competitors...</p>
          </div>
        ) : filteredCompetitors.length === 0 ? (
          <div className="p-8 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">
              {searchQuery ? 'No competitors match your search' : 'No competitors added yet'}
            </p>
            {!searchQuery && (
              <button
                onClick={onAddClick}
                className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
              >
                Add your first competitor
              </button>
            )}
          </div>
        ) : (
          filteredCompetitors.map((competitor) => (
            <div
              key={competitor.id}
              className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                !competitor.isActive ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewClick(competitor)}>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 dark:text-white truncate">
                      {competitor.name}
                    </h3>
                    {!competitor.isActive && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  
                  {competitor.address && (
                    <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {competitor.address}
                    </p>
                  )}

                  {/* Quick Stats */}
                  <div className="flex items-center gap-4 mt-3">
                    {competitor.units && competitor.units.length > 0 && (
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {competitor.units.length} unit types
                      </span>
                    )}
                    {getAvgRent(competitor.units) && (
                      <span className="text-sm font-medium text-green-600 dark:text-green-400">
                        Avg: ${getAvgRent(competitor.units)?.toLocaleString()}
                      </span>
                    )}
                    {competitor.amenities.length > 0 && (
                      <span className="text-sm text-gray-500">
                        {competitor.amenities.slice(0, 3).join(', ')}
                        {competitor.amenities.length > 3 && ` +${competitor.amenities.length - 3}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  {competitor.websiteUrl && (
                    <a
                      href={competitor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  {competitor.phone && (
                    <a
                      href={`tel:${competitor.phone}`}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                  
                  {/* More Menu */}
                  <div className="relative">
                    <button
                      disabled={saving} aria-label={`Actions for ${competitor.name}`}
                      onClick={() => setMenuOpen(menuOpen === competitor.id ? null : competitor.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    
                    {menuOpen === competitor.id && (
                      <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-10">
                        <button
                          onClick={() => {
                            onViewClick(competitor)
                            setMenuOpen(null)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                        >
                          <Eye className="w-4 h-4" />
                          View Details
                        </button>
                        <button
                          onClick={() => {
                            onEditClick(competitor)
                            setMenuOpen(null)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setDecision(competitor);setReason('')
                            setMenuOpen(null)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                        >
                          {competitor.isActive ? 'Archive' : 'Restore'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

