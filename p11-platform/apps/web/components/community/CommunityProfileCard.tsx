'use client'

import { useRouter } from 'next/navigation'
import { 
  Building2, 
  MapPin, 
  Globe, 
  Calendar, 
  Home, 
  Edit2
} from 'lucide-react'
import { getPropertyTypeLabel } from '@/utils/property-types'

type Property = {
  id: string
  name: string
  address: {
    street?: string
    city?: string
    state?: string
    zip?: string
  } | null
  property_type?: string | null
  website_url?: string | null
  unit_count?: number | null
  year_built?: number | null
  amenities?: string[]
  brand_voice?: string | null
  target_audience?: string | null
}

// Profile type for backward compatibility with existing components
type CommunityProfile = {
  id: string
  property_id: string
  legal_name: string | null
  community_type: string | null
  website_url: string | null
  unit_count: number | null
  year_built: number | null
  amenities: string[]
  pet_policy: Record<string, unknown>
  parking_info: Record<string, unknown>
  special_features: string[]
  brand_voice: string | null
  target_audience: string | null
  office_hours: Record<string, unknown>
  social_media: Record<string, unknown>
  intake_completed_at: string | null
}

type Props = {
  profile?: CommunityProfile | null
  property: Property
  onUpdate?: (profile: CommunityProfile | Property) => void
}

export function CommunityProfileCard({ profile, property }: Props) {
  const router = useRouter()
  
  // Use property data directly, fall back to profile for backward compatibility
  const propertyType = property.property_type || profile?.community_type || ''
  const websiteUrl = property.website_url || profile?.website_url || ''
  const unitCount = property.unit_count || profile?.unit_count || null
  const yearBuilt = property.year_built || profile?.year_built || null
  const amenities = property.amenities || profile?.amenities || []
  const brandVoice = property.brand_voice || profile?.brand_voice || ''

  const formatAddress = (address: Property['address']) => {
    if (!address) return 'No address'
    const parts = [address.street, address.city, address.state, address.zip].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : 'No address'
  }

  const handleEditClick = () => {
    router.push(`/dashboard/properties/${property.id}/edit`)
  }

  const displayPropertyType = getPropertyTypeLabel(propertyType)

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-white/10 rounded-xl flex items-center justify-center">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">{property.name}</h2>
              <p className="text-slate-300 text-sm flex items-center gap-1.5 mt-0.5">
                <MapPin className="h-3.5 w-3.5" />
                {formatAddress(property.address)}
              </p>
            </div>
          </div>
          <button
            onClick={handleEditClick}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Edit2 className="h-4 w-4" />
            Edit Profile
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <InfoItem
            icon={<Building2 className="h-4 w-4" />}
            label="Property Type"
            value={displayPropertyType}
          />
          <InfoItem
            icon={<Home className="h-4 w-4" />}
            label="Units"
            value={unitCount?.toString() || 'Not specified'}
          />
          <InfoItem
            icon={<Calendar className="h-4 w-4" />}
            label="Year Built"
            value={yearBuilt?.toString() || 'Not specified'}
          />
          <InfoItem
            icon={<Globe className="h-4 w-4" />}
            label="Website"
            value={websiteUrl || 'Not configured'}
            isLink={!!websiteUrl}
          />
          
          {/* Amenities */}
          {amenities && amenities.length > 0 && (
            <div className="md:col-span-2 lg:col-span-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Amenities</p>
              <div className="flex flex-wrap gap-2">
                {amenities.map((amenity, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm"
                  >
                    {amenity}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Brand Voice */}
          {brandVoice && (
            <div className="md:col-span-2 lg:col-span-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Brand Voice</p>
              <p className="text-sm text-slate-700">{brandVoice}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Alias for new naming convention
export const PropertyProfileCard = CommunityProfileCard

function InfoItem({ 
  icon, 
  label, 
  value, 
  isLink = false 
}: { 
  icon: React.ReactNode
  label: string
  value: string
  isLink?: boolean 
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
        {isLink && value !== 'Not configured' ? (
          <a
            href={value.startsWith('http') ? value : `https://${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:text-indigo-700 truncate block max-w-[200px]"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm text-slate-900">{value}</p>
        )}
      </div>
    </div>
  )
}
