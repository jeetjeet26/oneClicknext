'use client';
import { MarketingDataReview } from '@/components/charts/MarketingDataReview';
import { SavedBiReports } from '@/components/charts/SavedBiReports';
import { type BiReport, type BiCampaign, metricCurrency, metricPercent, trendForCampaign } from '@/utils/analytics/report-data';
import { formatConversions } from '@/utils/analytics/marketing-fact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { MetricCard, PerformanceChart, ChannelBreakdown, DateRangePicker, NaturalLanguageQuery, CampaignTable, CampaignDetailDrawer, ScheduleReportModal, GoalTracker, AnomalyAlert, CSVUploadModal, DATE_PRESETS, type DateRange } from '@/components/charts';
import { DollarSign, MousePointerClick, Eye, Target, RefreshCw, AlertCircle, ArrowLeftRight, Calendar, CalendarClock, ChevronDown, ChevronUp, Table, Upload, Download, } from 'lucide-react';
import { format } from 'date-fns';
import { getMarketingChannelLabel, normalizeMarketingChannelId } from '@/utils/analytics/channel-identity';
type AnalyticsData = BiReport & {
    sourceHash: string;
    actorId: string;
};
type Campaign = BiCampaign;
function PropertyBI() {
    const { currentProperty } = usePropertyContext();
    const [dateRange, setDateRange] = useState<DateRange>(DATE_PRESETS[2]); // Last 30 days
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [compareEnabled, setCompareEnabled] = useState(true); // Enable comparison by default
    const [showCampaigns, setShowCampaigns] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [channel, setChannel] = useState('all'), [account, setAccount] = useState('all');
    const [accounts, setAccounts] = useState<Array<{
        channel: string;
        account: string | null;
    }>>([]);
    const request = useRef<AbortController | null>(null), sequence = useRef(0);
    const campaignsData = data ? { campaigns: data.campaigns, channels: data.channels.map(c => c.channel), totals: { campaigns: data.campaigns.length } } : null;
    const campaignsLoading = loading;
    const selectedTrends = useMemo(() => data && selectedCampaign ? trendForCampaign(data.source, selectedCampaign.campaign_key) : undefined, [data, selectedCampaign]);
    // MCP Import state
    const [showImportMenu, setShowImportMenu] = useState(false);
    const fetchData = useCallback(async () => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const current = ++sequence.current;
        setData(null);
        setSelectedCampaign(null);
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ propertyId: currentProperty.id, startDate: format(dateRange.start, 'yyyy-MM-dd'), endDate: format(dateRange.end, 'yyyy-MM-dd'), compare: String(compareEnabled) });
        if (channel !== 'all')
            params.set('channel', channel);
        if (account !== 'all')
            params.set('account', account);
        try {
            const response = await fetch('/api/analytics/reports?' + params, { signal: controller.signal }), result = await response.json();
            if (!response.ok)
                throw new Error(result.error || 'Report data could not be loaded.');
            if (result.propertyId !== currentProperty.id)
                throw new Error('The report does not match this property.');
            if (controller.signal.aborted || current !== sequence.current)
                return;
            setData(result);
            setAccounts(previous => [...new Map([...previous, ...result.coverage.sources].map((x: {
                    channel: string;
                    account: string | null;
                }) => [JSON.stringify([x.channel, x.account]), { channel: x.channel, account: x.account }])).values()]);
        }
        catch (e) {
            if (!controller.signal.aborted && current === sequence.current)
                setError(e instanceof Error ? e.message : 'Report data could not be loaded.');
        }
        finally {
            if (!controller.signal.aborted && current === sequence.current)
                setLoading(false);
        }
    }, [currentProperty.id, dateRange, compareEnabled, channel, account]);
    useEffect(() => { void fetchData(); return () => request.current?.abort(); }, [fetchData]);
    // Close import menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setShowImportMenu(false);
        if (showImportMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showImportMenu]);
    // Get period-over-period changes from actual data
    const periodChanges = data?.comparison?.changes ?? null;
    const hasData = data && (data.timeSeries.length > 0 || data.channels.length > 0);
    return (<div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">MultiChannel BI</h1>
          <p className="text-slate-500 mt-1">
            Performance analytics for {currentProperty?.name || 'your property'}
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setData(null); setSelectedCampaign(null); setCompareEnabled(!compareEnabled); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${compareEnabled
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`} title={compareEnabled ? 'Disable period comparison' : 'Enable period comparison'}>
            <ArrowLeftRight size={16}/>
            <span className="hidden sm:inline">Compare</span>
          </button>
          <DateRangePicker value={dateRange} onChange={range => { setData(null); setSelectedCampaign(null); setDateRange(range); }}/>
          {currentProperty && <MarketingDataReview key={currentProperty.id} propertyId={currentProperty.id} startDate={format(dateRange.start, 'yyyy-MM-dd')} endDate={format(dateRange.end, 'yyyy-MM-dd')}/>}

          
          {/* Import Dropdown */}
          <div className="relative">
            <button onClick={(e) => {
            e.stopPropagation();
            setShowImportMenu(!showImportMenu);
        }} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
              <Download size={16}/> <span className="hidden sm:inline">Import Data</span>
              <ChevronDown size={14}/>
            </button>
            
            {showImportMenu && (<div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50" onClick={(e) => e.stopPropagation()}>
                <Link href="/dashboard/pipelines" className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className="p-1.5 bg-emerald-100 rounded">
                    <Download size={14} className="text-emerald-600"/>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">Import connected accounts</p>
                    <p className="text-xs text-slate-500">Choose accounts and review saved progress</p>
                  </div>
                </Link>
                <button onClick={() => {
                setShowImportMenu(false);
                setShowUploadModal(true);
            }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className="p-1.5 bg-blue-100 rounded">
                    <Upload size={14} className="text-blue-600"/>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">Upload CSV</p>
                    <p className="text-xs text-slate-500">Manual file upload</p>
                  </div>
                </button>
              </div>)}
          </div>
          
          <button onClick={() => setShowScheduleModal(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700" title="Schedule automated email report">
            <CalendarClock size={16}/>
            <span className="hidden sm:inline">Schedule</span>
          </button>
          <button onClick={fetchData} disabled={loading} className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50" title="Refresh data">
            <RefreshCw size={18} className={`text-slate-600 ${loading ? 'animate-spin' : ''}`}/>
          </button>
        </div>
      </div>
      

      <div className="flex flex-wrap gap-3" aria-label="Report filters">
        <label>Channel<select aria-label="Report channel" value={channel} onChange={e => { setData(null); setSelectedCampaign(null); setChannel(e.target.value); setAccount('all'); }} className="ml-2 rounded-lg border bg-background p-2"><option value="all">All channels</option>{[...new Set(['google_ads', 'meta_ads', 'ga4', 'tiktok_ads', 'linkedin_ads', 'bing_ads', ...accounts.map(a => a.channel)])].map(c => <option key={c} value={c}>{getMarketingChannelLabel(c)}</option>)}</select></label>
        <label>Account<select aria-label="Report account" value={account === 'all' ? 'all' : JSON.stringify([channel, account === '' ? null : account])} onChange={e => {
            setData(null);
            setSelectedCampaign(null);
            if (e.target.value === 'all')
                setAccount('all');
            else {
                const [c, a] = JSON.parse(e.target.value);
                setChannel(c);
                setAccount(a ?? '');
            }
        }} className="ml-2 rounded-lg border bg-background p-2"><option value="all">All accounts</option>{accounts.filter(a => channel === 'all' || a.channel === channel).map(a => <option key={JSON.stringify([a.channel, a.account])} value={JSON.stringify([a.channel, a.account])}>{getMarketingChannelLabel(a.channel)} · {a.account || 'Unattributed historical account'}</option>)}</select></label>
      </div>
      {data && <section aria-label="Report coverage" className="rounded-xl border border-border bg-card p-4 text-sm"><p>{data.coverage.records} stored records across {data.coverage.observedDays} of {data.coverage.requestedDays} selected dates.</p><p>Missing dates are unknown, not zero. This is coverage of stored records, not proof every provider delivered complete data.</p>{data.coverage.unknownAccountRecords > 0 && <p role="status">{data.coverage.unknownAccountRecords} records still need source-account review.</p>}{!data.coverage.currencyKnown && <p role="status">Some records have unconfirmed currency. Dollar totals and cost-based rates are unavailable.</p>}<details className="mt-2"><summary>Metric definitions and source accounts</summary><p className="mt-2">Conversions are provider-attributed actions. They can be fractional, can overlap across platforms, and do not establish unique people or signed leases. CTR is clicks divided by impressions; CPC is spend divided by clicks; cost per reported conversion is spend divided by conversions. Rates with a zero denominator and changes from a zero baseline are unavailable. Dollar values are USD where confirmed. Dates follow each source account’s reporting calendar.</p><div className="mt-2 max-h-64 overflow-auto">{data.coverage.sources.map(x => <p key={JSON.stringify([x.channel, x.account])}>{getMarketingChannelLabel(x.channel)} · {x.account || 'Unattributed account'} · {x.records} records · {x.firstDate} to {x.lastDate}</p>)}</div></details></section>}


      {/* Comparison Period Info */}
      {compareEnabled && data?.comparison?.previousPeriod && (<div className="bg-indigo-50/50 border border-indigo-100 rounded-lg px-4 py-2 flex items-center gap-2 text-sm">
          <Calendar size={16} className="text-indigo-500"/>
          <span className="text-indigo-700">
            Comparing to previous period: {data.comparison.previousPeriod.start} → {data.comparison.previousPeriod.end}
          </span>
        </div>)}

      {/* Retained marketing change review */}
      <AnomalyAlert key={`alerts:${currentProperty.id}`} propertyId={currentProperty.id} report={data}/>

      {/* Error State */}
      {error && (<div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20}/>
          <div>
            <p className="text-red-800 font-medium">Error loading data</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>)}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Spend" value={data?.totals.spend ?? '—'} prefix={data?.totals.spend === null || !data ? '' : '$'} change={compareEnabled && periodChanges?.spend !== null ? periodChanges?.spend : undefined} changeLabel="vs previous period" previousValue={data?.comparison?.totals?.spend ?? undefined} showPrevious={compareEnabled && !!data?.comparison && data.coverage.previousRecords > 0} icon={<DollarSign size={20}/>} loading={loading}/>
        <MetricCard title="Impressions" value={data?.totals.impressions ?? '—'} change={compareEnabled && periodChanges?.impressions !== null ? periodChanges?.impressions : undefined} changeLabel="vs previous period" previousValue={data?.comparison?.totals?.impressions} showPrevious={compareEnabled && !!data?.comparison && data.coverage.previousRecords > 0} icon={<Eye size={20}/>} loading={loading}/>
        <MetricCard title="Clicks" value={data?.totals.clicks ?? '—'} change={compareEnabled && periodChanges?.clicks !== null ? periodChanges?.clicks : undefined} changeLabel="vs previous period" previousValue={data?.comparison?.totals?.clicks} showPrevious={compareEnabled && !!data?.comparison && data.coverage.previousRecords > 0} icon={<MousePointerClick size={20}/>} loading={loading}/>
        <MetricCard title="Conversions" value={data ? formatConversions(data.totals.conversions) : '—'} change={compareEnabled && periodChanges?.conversions !== null ? periodChanges?.conversions : undefined} changeLabel="vs previous period" previousValue={data?.comparison?.totals?.conversions} showPrevious={compareEnabled && !!data?.comparison && data.coverage.previousRecords > 0} icon={<Target size={20}/>} loading={loading}/>
      </div>

      {/* Charts Row */}
      {!error && (<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Time Series Chart */}
          <div className="lg:col-span-2">
            {hasData ? (<PerformanceChart data={data.timeSeries} lines={[
                    { key: 'spend', name: 'Spend ($)', color: '#6366f1' },
                    { key: 'clicks', name: 'Clicks', color: '#10b981' },
                ]} title="Performance Over Time" loading={loading}/>) : (<div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-6">Performance Over Time</h3>
                <div className="h-[350px] flex items-center justify-center">
                  {loading ? (<div className="animate-pulse text-slate-400">Loading chart data...</div>) : (<div className="text-center">
                      <div className="text-slate-400 mb-2">
                        <Eye size={48} className="mx-auto opacity-30"/>
                      </div>
                      <p className="text-slate-500">No performance data available</p>
                      <p className="text-sm text-slate-400 mt-1">
                        Run your data pipelines to populate this chart
                      </p>
                    </div>)}
                </div>
              </div>)}
          </div>

          {/* Channel Breakdown */}
          <div>
            {hasData && data.channels.length > 0 ? (<ChannelBreakdown data={data.channels.map(c => ({
                    ...c,
                    color: normalizeMarketingChannelId(c.channel) === 'meta_ads'
                        ? '#1877F2'
                        : normalizeMarketingChannelId(c.channel) === 'google_ads'
                            ? '#EA4335'
                            : '#6366f1'
                }))} title="Spend by Channel" metric="spend" loading={loading}/>) : (<div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-6">Spend by Channel</h3>
                <div className="h-[200px] flex items-center justify-center">
                  {loading ? (<div className="animate-pulse text-slate-400">Loading...</div>) : (<div className="text-center">
                      <p className="text-slate-500 text-sm">No channel data</p>
                    </div>)}
                </div>
              </div>)}
          </div>
        </div>)}

      {/* Additional Metrics Row */}
      {hasData && (<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CTR Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Click-Through Rate</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="text-3xl sm:text-4xl font-bold text-indigo-600">
                  {metricPercent(data.totals.ctr)}
                </p>
                <p className="text-sm text-slate-500 mt-1">Total clicks divided by total impressions</p>
              </div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500" style={{ width: `${Math.min((data.totals.ctr ?? 0) * 10, 100)}%` }}/>
              </div>
            </div>
          </div>

          {/* CPA Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Cost Per Reported Conversion</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="text-3xl sm:text-4xl font-bold text-emerald-600">
                  {metricCurrency(data.totals.cpa)}
                </p>
                <p className="text-sm text-slate-500 mt-1">Spend divided by reported conversions</p>
              </div>
              {data.channels.length > 0 && (<div className="flex-1">
                  <div className="flex gap-2">
                    {data.channels.map(channel => (<div key={channel.channel} className="flex-1 text-center">
                        <p className="text-xs text-slate-400 mb-1">
                          {getMarketingChannelLabel(channel.channel)}
                        </p>
                        <p className="text-sm font-medium text-slate-700">
                          {metricCurrency(channel.cpa)}
                        </p>
                      </div>))}
                  </div>
                </div>)}
            </div>
          </div>
        </div>)}

      {/* Goal Tracking */}
      {currentProperty?.id && (<GoalTracker key={`goals:${currentProperty.id}`} propertyId={currentProperty.id} reportRange={data?.dateRange} coverageComplete={!!data && data.coverage.observedDays === data.coverage.requestedDays} filtered={channel !== 'all' || account !== 'all'} currentMetrics={{
                spend: data?.totals.spend,
                impressions: data?.totals.impressions,
                clicks: data?.totals.clicks,
                conversions: data?.totals.conversions,
                ctr: data?.totals.ctr,
                cpa: data?.totals.cpa,
            }}/>)}

      {/* Campaign Drill-Down Section */}
      {hasData && (<div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button onClick={() => setShowCampaigns(!showCampaigns)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Table size={20} className="text-indigo-600"/>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-slate-900">Campaign Breakdown</h3>
                <p className="text-sm text-slate-500">
                  {campaignsData?.totals.campaigns ?? '—'} campaigns • Click to {showCampaigns ? 'collapse' : 'expand'}
                </p>
              </div>
            </div>
            {showCampaigns ? (<ChevronUp size={20} className="text-slate-400"/>) : (<ChevronDown size={20} className="text-slate-400"/>)}
          </button>
          
          {showCampaigns && (<div className="border-t border-slate-200">
              <CampaignTable campaigns={campaignsData?.campaigns ?? []} channels={campaignsData?.channels ?? []} loading={campaignsLoading} onSelectCampaign={(campaign) => setSelectedCampaign(data?.campaigns.find(c => c.campaign_key === campaign.campaign_key) ?? null)}/>
            </div>)}
        </div>)}

      {/* Campaign Detail Drawer */}
      {selectedCampaign && currentProperty && (<CampaignDetailDrawer campaign={selectedCampaign} propertyId={currentProperty.id} startDate={format(dateRange.start, 'yyyy-MM-dd')} endDate={format(dateRange.end, 'yyyy-MM-dd')} storedTrends={selectedTrends} onClose={() => setSelectedCampaign(null)}/>)}

      <SavedBiReports propertyId={currentProperty.id} report={data}/>

      {/* Natural Language Query */}
      <div className="mt-6">
        <NaturalLanguageQuery key={currentProperty.id} propertyId={currentProperty.id} report={data}/>
      </div>

      {/* Empty State */}
      {!loading && !error && !hasData && (<div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-12 text-center">
          <div className="max-w-md mx-auto">
            <div className="h-16 w-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Eye size={32} className="text-indigo-500"/>
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              No matching marketing records
            </h3>
            <p className="text-slate-500 mb-6">
              No stored records match these dates and filters. Try another period or review an import.
            </p>
            <div className="bg-white rounded-lg p-4 text-left text-sm border border-slate-200 mb-4">
              <p className="font-medium text-slate-700 mb-2">Quick Start:</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600">
                <li>Click the <strong>Import</strong> button above</li>
                <li>Upload a CSV export from Google Ads or Meta</li>
                <li>Review and confirm the import</li>
              </ol>
            </div>
            <button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
              <Upload size={16}/>
              Import Marketing Data
            </button>
          </div>
        </div>)}

      {/* Schedule Report Modal */}
      <ScheduleReportModal isOpen={showScheduleModal} onClose={() => setShowScheduleModal(false)} propertyId={currentProperty?.id} propertyName={currentProperty?.name}/>

      {/* CSV Upload Modal */}
      {currentProperty?.id && (<CSVUploadModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} propertyId={currentProperty.id} propertyName={currentProperty.name} onSuccess={() => {
                // Refresh data after successful import
                fetchData();
            }}/>)}
    </div>);
}
export default function MultiChannelBIPage() {
    const { currentProperty, loading, hasLoadedProperties } = usePropertyContext();
    if (loading)
        return <p role="status">Loading property…</p>;
    if (!hasLoadedProperties)
        return <p role="alert">Your property records are unavailable. Reload the page to try again.</p>;
    return <PropertyBI key={currentProperty.id}/>;
}
