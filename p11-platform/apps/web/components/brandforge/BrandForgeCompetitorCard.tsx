'use client'

import {
  Building2,
  MapPin,
  ExternalLink,
  Phone,
  Sparkles,
  Users,
  Home,
  Calendar,
  Tag
} from 'lucide-react'

export interface BrandForgeCompetitor {
  evidenceStatus?: 'current' | 'stale' | 'unverified'
  analyzedAt?: string | null
  id: string
  name: string
  address: string | null
  websiteUrl: string | null
  phone: string | null
  propertyType: string
  unitsCount: number | null
  yearBuilt: number | null
  amenities: string[]
  photos: string[]
  lastScrapedAt: string | null
  brandVoice: string
  personality: string
  positioning: string
  targetAudience: string
  usps: string[]
  highlightedAmenities: string[]
  activeSpecials: string[]
  lifestyleFocus: string[]
}

interface BrandForgeCompetitorCardProps {
  competitor: BrandForgeCompetitor
}

const getVoiceColor = (voice: string) => {
  const voiceLower = voice.toLowerCase()
  if (voiceLower.includes('modern') || voiceLower.includes('innovative')) {
    return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' }
  }
  if (voiceLower.includes('professional') || voiceLower.includes('corporate')) {
    return { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' }
  }
  if (voiceLower.includes('artistic') || voiceLower.includes('creative')) {
    return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' }
  }
  if (voiceLower.includes('luxury') || voiceLower.includes('premium')) {
    return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' }
  }
  if (voiceLower.includes('warm') || voiceLower.includes('friendly')) {
    return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' }
  }
  return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' }
}

export function BrandForgeCompetitorCard({ competitor }: BrandForgeCompetitorCardProps) {
  const voiceColors = getVoiceColor(competitor.brandVoice)
  const hasIntel = competitor.brandVoice !== 'Not analyzed'

  return (
    <div className="border border-slate-200 rounded-xl bg-white hover:border-indigo-300 hover:shadow-md transition-all duration-200 overflow-hidden">
      {competitor.evidenceStatus && <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-600">{competitor.evidenceStatus === 'current' ? 'Current evidence at snapshot' : competitor.evidenceStatus === 'stale' ? 'Older evidence — review before use' : 'Evidence needs verification'}{competitor.analyzedAt ? ` · Analyzed ${new Date(competitor.analyzedAt).toLocaleDateString()}` : ''}</div>}
      {/* Header */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 text-lg mb-1 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600 flex-shrink-0" />
              <span className="truncate">{competitor.name}</span>
            </h3>
            {competitor.address && (
              <p className="text-sm text-slate-600 flex items-center gap-1.5 mt-1">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{competitor.address}</span>
              </p>
            )}
          </div>
        </div>

        {/* Action Links */}
        <div className="flex items-center gap-2 mt-3">
          {competitor.websiteUrl && (
            <a
              href={competitor.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Visit Website
            </a>
          )}
          {competitor.phone && (
            <a
              href={`tel:${competitor.phone}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
              {competitor.phone}
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* Quick Stats */}
        <div className="flex flex-wrap gap-3 text-sm">
          {competitor.unitsCount && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <Home className="w-4 h-4" />
              <span>{competitor.unitsCount} units</span>
            </div>
          )}
          {competitor.yearBuilt && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <Calendar className="w-4 h-4" />
              <span>Built {competitor.yearBuilt}</span>
            </div>
          )}
        </div>

        {/* Brand Voice Badge */}
        {hasIntel && (
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full border ${voiceColors.bg} ${voiceColors.text} ${voiceColors.border}`}>
              <Sparkles className="w-3.5 h-3.5" />
              {competitor.brandVoice}
            </span>
            {competitor.personality && competitor.personality !== 'Not analyzed' && (
              <span className="px-3 py-1.5 text-sm text-slate-700 bg-slate-100 rounded-full">
                {competitor.personality}
              </span>
            )}
          </div>
        )}

        {/* Target Audience */}
        {competitor.targetAudience && competitor.targetAudience !== 'Not analyzed' && (
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Target Audience</span>
            </div>
            <p className="text-sm text-slate-700">{competitor.targetAudience}</p>
          </div>
        )}

        {/* Positioning Statement */}
        {competitor.positioning && competitor.positioning !== 'Not analyzed' && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
            <p className="text-sm text-indigo-800 italic leading-relaxed">
              &ldquo;{competitor.positioning}&rdquo;
            </p>
          </div>
        )}

        {/* Active Specials */}
        {competitor.activeSpecials && competitor.activeSpecials.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Tag className="w-4 h-4 text-amber-600" />
              <h5 className="text-xs font-medium text-slate-700 uppercase tracking-wide">Active Specials</h5>
            </div>
            <div className="space-y-1.5">
              {competitor.activeSpecials.slice(0, 2).map((special, idx) => (
                <div key={idx} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  🏷️ {special}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Amenities */}
        {(competitor.highlightedAmenities.length > 0 || competitor.amenities.length > 0) && (
          <div>
            <h5 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Key Amenities
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {(competitor.highlightedAmenities.length > 0 
                ? competitor.highlightedAmenities 
                : competitor.amenities
              ).slice(0, 6).map((amenity, idx) => (
                <span key={idx} className="px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded">
                  {amenity}
                </span>
              ))}
              {(competitor.highlightedAmenities.length > 6 || competitor.amenities.length > 6) && (
                <span className="px-2 py-1 text-xs text-slate-500 bg-slate-50 rounded">
                  +{Math.max(competitor.highlightedAmenities.length, competitor.amenities.length) - 6} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Lifestyle Focus Tags */}
        {competitor.lifestyleFocus && competitor.lifestyleFocus.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Lifestyle Focus
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {competitor.lifestyleFocus.map((focus, idx) => (
                <span key={idx} className="px-2 py-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded">
                  {focus}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {competitor.lastScrapedAt && (
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            Last analyzed: {new Date(competitor.lastScrapedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>
      )}
    </div>
  )
}





















