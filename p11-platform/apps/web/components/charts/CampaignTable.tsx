'use client'

import { formatConversions, campaignIdentity } from '@/utils/analytics/marketing-fact'

import { useState, useMemo } from 'react'
import { 
  ChevronUp, 
  ChevronDown, 
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Filter,
  Search,
  X
} from 'lucide-react'
import { getMarketingChannelLabel, normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

type Campaign = {
  campaign_id: string
  source_account_id?: string | null
  campaign_key?: string
  campaign_name: string
  channel: string
  impressions: number
  clicks: number
  spend: number | null
  conversions: number
  ctr: number | null
  cpc: number | null
  cpa: number | null
  first_date: string
  last_date: string
}

type SortConfig = {
  key: keyof Campaign
  direction: 'asc' | 'desc'
}

type CampaignTableProps = {
  campaigns: Campaign[]
  channels: string[]
  loading?: boolean
  onSelectCampaign?: (campaign: Campaign) => void
}

const channelColors: Record<string, { bg: string; text: string; border: string }> = {
  meta_ads: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  google_ads: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  tiktok_ads: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  linkedin_ads: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
}

function formatNumber(value: number, decimals: number = 0): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toFixed(decimals)
}

function formatCurrency(value: number | null): string {
  if(value===null)return "Not available"
  return `$${formatNumber(value, 2)}`
}

function formatPercent(value: number | null): string {
  if(value===null)return "Not available"
  return `${value.toFixed(2)}%`
}

// Performance indicator based on CPA (lower is better)
function getPerformanceIndicator(cpa: number | null, avgCpa: number | null) {
  if (cpa===null||avgCpa===null||avgCpa===0) return null
  const diff = ((cpa - avgCpa) / avgCpa) * 100
  
  if (diff <= -20) return { icon: TrendingUp, color: 'text-emerald-500', label: 'Excellent' }
  if (diff <= -5) return { icon: TrendingUp, color: 'text-green-500', label: 'Good' }
  if (diff <= 5) return { icon: Minus, color: 'text-slate-400', label: 'Average' }
  if (diff <= 20) return { icon: TrendingDown, color: 'text-amber-500', label: 'Below avg' }
  return { icon: TrendingDown, color: 'text-red-500', label: 'Poor' }
}

function SortIcon({ columnKey, sortConfig }: { columnKey: keyof Campaign; sortConfig: { key: keyof Campaign; direction: 'asc' | 'desc' } }) {
    if (sortConfig.key !== columnKey) {
      return <ChevronUp className="opacity-0 group-hover:opacity-30" size={14} />
    }
    return sortConfig.direction === 'desc'
      ? <ChevronDown size={14} className="text-indigo-600" />
      : <ChevronUp size={14} className="text-indigo-600" />
  }

export function CampaignTable({ 
  campaigns, 
  channels,
  loading = false,
  onSelectCampaign 
}: CampaignTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'spend', direction: 'desc' })
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const [pagination,setPagination]=useState<{campaigns:Campaign[]|null;context:string;page:number}>({campaigns:null,context:'',page:0})
  const pageContext=JSON.stringify([searchTerm,selectedChannel,sortConfig])
  const page=pagination.campaigns===campaigns&&pagination.context===pageContext?pagination.page:0
  const setPage=(next:number)=>setPagination({campaigns,context:pageContext,page:next})

  // Calculate average CPA for performance comparison
  const avgCpa = useMemo(() => {
    if(campaigns.some(c=>c.spend===null))return null
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend!, 0)
    const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0)
    return totalConversions > 0 ? totalSpend / totalConversions : null
  }, [campaigns])

  // Filter and sort campaigns
  const filteredCampaigns = useMemo(() => {
    let result = [...campaigns]

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(c => 
        c.campaign_name.toLowerCase().includes(term) ||
        c.campaign_id.toLowerCase().includes(term)
      )
    }

    // Apply channel filter
    if (selectedChannel) {
      result = result.filter(c => c.channel === selectedChannel)
    }

    // Apply sort
    result.sort((a, b) => {
      const aVal = a[sortConfig.key]
      const bVal = b[sortConfig.key]
      
      if(aVal===null||aVal===undefined)return bVal===null||bVal===undefined?0:1
      if(bVal===null||bVal===undefined)return -1
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      
      return sortConfig.direction === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

    return result
  }, [campaigns, searchTerm, selectedChannel, sortConfig])

  const handleSort = (key: keyof Campaign) => {
    setPage(0)
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }))
  }



  const clearFilters = () => {
    setPage(0)
    setSearchTerm('')
    setSelectedChannel('')
  }

  const hasActiveFilters = searchTerm || selectedChannel

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <div className="h-6 bg-slate-200 rounded w-48 animate-pulse"></div>
        </div>
        <div className="animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-slate-100">
              <div className="h-4 bg-slate-100 rounded flex-1"></div>
              <div className="h-4 bg-slate-100 rounded w-20"></div>
              <div className="h-4 bg-slate-100 rounded w-20"></div>
              <div className="h-4 bg-slate-100 rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Campaign Performance</h3>
            <p className="text-sm text-slate-500 mt-1">
              {filteredCampaigns.length} of {campaigns.length} campaigns
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={searchTerm}
                onChange={(e) => {setPage(0);setSearchTerm(e.target.value)}}
                className="pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-48"
              />
            </div>

            {/* Filter Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${
                hasActiveFilters || showFilters
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter size={16} />
              <span className="hidden sm:inline">Filters</span>
              {hasActiveFilters && (
                <span className="bg-indigo-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {(searchTerm ? 1 : 0) + (selectedChannel ? 1 : 0)}
                </span>
              )}
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                title="Clear filters"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {setPage(0);setSelectedChannel('')}}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  !selectedChannel
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All Channels
              </button>
              {channels.map(ch => (
                <button
                  key={ch}
                  onClick={() => {setPage(0);setSelectedChannel(ch)}}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                    selectedChannel === ch
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {getMarketingChannelLabel(ch)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3">
                <button
                  onClick={() => handleSort('campaign_name')}
                  className="group flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700"
                >
                  Campaign
                  <SortIcon sortConfig={sortConfig} columnKey="campaign_name" />
                </button>
              </th>
              <th className="text-left px-4 py-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Channel
                </span>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('spend')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  Spend
                  <SortIcon sortConfig={sortConfig} columnKey="spend" />
                </button>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('impressions')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  Impressions
                  <SortIcon sortConfig={sortConfig} columnKey="impressions" />
                </button>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('clicks')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  Clicks
                  <SortIcon sortConfig={sortConfig} columnKey="clicks" />
                </button>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('ctr')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  CTR
                  <SortIcon sortConfig={sortConfig} columnKey="ctr" />
                </button>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('conversions')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  Conv.
                  <SortIcon sortConfig={sortConfig} columnKey="conversions" />
                </button>
              </th>
              <th className="text-right px-4 py-3">
                <button
                  onClick={() => handleSort('cpa')}
                  className="group flex items-center justify-end gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ml-auto"
                >
                  CPA
                  <SortIcon sortConfig={sortConfig} columnKey="cpa" />
                </button>
              </th>
              <th className="text-center px-4 py-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Perf.
                </span>
              </th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCampaigns.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <p className="text-slate-500">No campaigns found</p>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredCampaigns.slice(page*25,(page+1)*25).map((campaign) => {
                const performance = getPerformanceIndicator(campaign.cpa, avgCpa)
                const normalizedChannel = normalizeMarketingChannelId(campaign.channel)
                const channelStyle = channelColors[normalizedChannel] || channelColors.unknown
                
                return (
                  <tr 
                    key={campaign.campaign_key || campaignIdentity(campaign.channel, campaign.source_account_id ?? null, campaign.campaign_id)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => onSelectCampaign?.(campaign)}
                  >
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-medium text-slate-900 truncate max-w-[200px]" title={campaign.campaign_name}>
                          {campaign.campaign_name}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]" title={campaign.campaign_id}>
                          {campaign.campaign_id} · {campaign.source_account_id ? `Account ${campaign.source_account_id}` : 'Account needs review'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${channelStyle.bg} ${channelStyle.text} ${channelStyle.border}`}>
                        {getMarketingChannelLabel(normalizedChannel)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-semibold text-slate-900">{formatCurrency(campaign.spend)}</span>
                    </td>
                    <td className="px-4 py-4 text-right text-slate-600">
                      {formatNumber(campaign.impressions)}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-600">
                      {formatNumber(campaign.clicks)}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-600">
                      {formatPercent(campaign.ctr)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className={campaign.conversions > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                        {formatConversions(campaign.conversions)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className={campaign.cpa !== null ? 'font-medium text-slate-900' : 'text-slate-400'}>
                        {campaign.cpa !== null ? formatCurrency(campaign.cpa) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {performance && campaign.conversions > 0 ? (
                        <div className="flex items-center justify-center" title={performance.label}>
                          <performance.icon size={16} className={performance.color} />
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <ExternalLink size={16} className="text-slate-300 hover:text-indigo-500 transition-colors" />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with summary */}
      {filteredCampaigns.length > 0 && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span>
              <strong className="text-slate-900">
                {formatCurrency(filteredCampaigns.some(c=>c.spend===null)?null:filteredCampaigns.reduce((sum,c)=>sum+c.spend!,0))}
              </strong> total spend
            </span>
            <span className="text-slate-300">|</span>
            <span>
              <strong className="text-slate-900">
                {formatNumber(filteredCampaigns.reduce((sum, c) => sum + c.clicks, 0))}
              </strong> clicks
            </span>
            <span className="text-slate-300">|</span>
            <span>
              <strong className="text-slate-900">
                {formatConversions(filteredCampaigns.reduce((sum, c) => sum + c.conversions, 0))}
              </strong> conversions
            </span>
            <span className="text-slate-300">|</span>
            <span>
              <strong className="text-slate-900">
                {formatCurrency(avgCpa)}
              </strong> avg CPA
            </span>
          </div>
        </div>
      )}
      {filteredCampaigns.length>25&&<div className="flex items-center justify-between gap-3 border-t p-3"><button disabled={page===0} onClick={()=>setPage(page-1)}>Previous campaigns</button><span>Campaign page {page+1} of {Math.ceil(filteredCampaigns.length/25)}</span><button disabled={(page+1)*25>=filteredCampaigns.length} onClick={()=>setPage(page+1)}>Next campaigns</button></div>}
    </div>
  )
}

