'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { 
  Building2, 
  Plus, 
  MapPin, 
  Users, 
  FileText, 
  MoreVertical,
  Pencil,
  Trash2,
  AlertCircle
} from 'lucide-react'

type Property = {
  id: string
  name: string
  address: {
    street?: string
    city?: string
    state?: string
    zip?: string
  }
  settings: {
    city?: string
    timezone?: string
  }
  created_at: string
  stats: {
    leads: number
    documents: number
  }
}


export default function PropertiesPage() {
  const router = useRouter()
  const { setProperty, refreshProperties } = usePropertyContext()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchProperties = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/properties')
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch properties')
      }
      
      setProperties(data.properties || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load properties')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProperties()
  }, [fetchProperties])

  const openCreateModal = () => {
    // Navigate to the new comprehensive onboarding wizard
    router.push('/dashboard/properties/new')
  }

  const openEditProperty = (property: Property) => {
    // Navigate to the comprehensive edit wizard
    router.push(`/dashboard/properties/${property.id}/edit`)
    setMenuOpen(null)
  }

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/properties?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Delete failed')
      }

      setDeleteConfirm(null)
      await Promise.all([fetchProperties(), refreshProperties()])
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const selectProperty = (property: Property) => {
    setProperty(property.id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="text-indigo-500" size={28} />
            Properties
          </h1>
          <p className="text-slate-500 mt-1">
            Manage your apartment communities and their settings
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm"
        >
          <Plus size={18} />
          Add Property
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="text-red-800 font-medium">Error loading properties</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Properties Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
              <div className="h-6 bg-slate-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-slate-200 rounded w-1/2 mb-6"></div>
              <div className="flex gap-4">
                <div className="h-10 bg-slate-200 rounded flex-1"></div>
                <div className="h-10 bg-slate-200 rounded flex-1"></div>
              </div>
            </div>
          ))}
        </div>
      ) : properties.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="h-16 w-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No properties yet</h3>
          <p className="text-slate-500 mb-6 max-w-sm mx-auto">
            Add your first property to start managing leads, documents, and marketing data.
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus size={18} />
            Add Your First Property
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map(property => (
            <div
              key={property.id}
              className="bg-white rounded-xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all group"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div 
                    className="flex-1 cursor-pointer"
                    onClick={() => selectProperty(property)}
                  >
                    <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {property.name}
                    </h3>
                    {(property.address?.city || property.settings?.city) && (
                      <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin size={14} />
                        {property.address?.city 
                          ? `${property.address.city}, ${property.address.state || ''}`
                          : property.settings?.city
                        }
                      </p>
                    )}
                  </div>
                  
                  {/* Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === property.id ? null : property.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    >
                      <MoreVertical size={18} />
                    </button>
                    
                    {menuOpen === property.id && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setMenuOpen(null)}
                        />
                        <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20">
                          <button
                            onClick={() => openEditProperty(property)}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeleteConfirm(property.id)
                              setMenuOpen(null)
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users size={16} className="text-slate-400" />
                    <span>{property.stats.leads} leads</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <FileText size={16} className="text-slate-400" />
                    <span>{property.stats.documents} docs</span>
                  </div>
                </div>
              </div>

              {/* Delete Confirmation */}
              {deleteConfirm === property.id && (
                <div className="px-6 pb-6">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-800 mb-3">
                      Delete this property and all its data?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(property.id)}
                        className="flex-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="flex-1 px-3 py-1.5 bg-white text-slate-700 text-sm rounded border border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

