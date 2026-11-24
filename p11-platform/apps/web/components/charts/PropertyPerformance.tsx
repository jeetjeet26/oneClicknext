'use client';
import { MarketingDataReview } from '@/components/charts/MarketingDataReview';
import { SavedBiReports } from '@/components/charts/SavedBiReports';
import { type BiReport, type BiCampaign, trendForCampaign } from '@/utils/analytics/report-data';
import { CampaignMetricGrid } from './CampaignMetricGrid';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { DateRangePicker, NaturalLanguageQuery, CampaignTable, CampaignDetailDrawer, ScheduleReportModal, GoalTracker, AnomalyAlert, CSVUploadModal, type DateRange } from '@/components/charts';
import { RefreshCw, AlertCircle, ArrowLeftRight, Calendar, CalendarClock, ChevronDown, ChevronUp, Table, Upload, Download, Eye, } from 'lucide-react';
import { LAST_30_COMPLETED_DAYS } from './DateRangePicker';
import { format } from 'date-fns';
import { getMarketingChannelLabel } from '@/utils/analytics/channel-identity';
type AnalyticsData = BiReport & {
    sourceHash: string;
    actorId: string;
};
type Campaign = BiCampaign;
function PropertyBI() {
    const { currentProperty } = usePropertyContext();
    const [dateRange, setDateRange] = useState<DateRange>(LAST_30_COMPLETED_DAYS);
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [compareEnabled, setCompareEnabled] = useState(true); // Enable comparison by default
    const [showCampaigns, setShowCampaigns] = useState(true);
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
    useEffect(() => { let disposed = false; queueMicrotask(() => { if (!disposed) void fetchData(); }); return () => { disposed = true; request.current?.abort(); }; }, [fetchData]);
    // Close import menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setShowImportMenu(false);
        if (showImportMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showImportMenu]);
    const priorDays = data?.comparison?.timeSeries.length ?? 0;
    const comparablePeriods = !!data?.comparison && data.coverage.observedDays === data.coverage.requestedDays
        && priorDays === data.coverage.requestedDays;
    const hasData = data && (data.timeSeries.length > 0 || data.channels.length > 0);
    return (<div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setData(null); setSelectedCampaign(null); setCompareEnabled(!compareEnabled); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${compareEnabled
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`} aria-pressed={compareEnabled} title={compareEnabled ? 'Disable period comparison' : 'Enable period comparison'}>
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


      {/* Comparison Period Info */}
      {compareEnabled && data?.comparison?.previousPeriod && (<div className="bg-indigo-50/50 border border-indigo-100 rounded-lg px-4 py-2 flex items-center gap-2 text-sm">
          <Calendar size={16} className="text-indigo-500"/>
          <span className="text-indigo-700">
            Previous period {data.comparison.previousPeriod.start} to {data.comparison.previousPeriod.end}
            {' · '}{priorDays} of {data.coverage.requestedDays} days with data
            {!comparablePeriods && ' · Period changes require coverage of every day in both periods'}
          </span>
        </div>)}

      {/* Error State */}
      {error && (<div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20}/>
          <div>
            <p className="text-red-800 font-medium">Campaign performance unavailable</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
            <button type="button" className="mt-2 text-sm underline" onClick={fetchData} disabled={loading}>Retry report</button>
          </div>
        </div>)}

      {loading && <p role="status" className="rounded-xl border border-border p-5 text-sm text-muted-foreground">Loading campaign metrics…</p>}
      {hasData && <CampaignMetricGrid report={data} showPrevious={channel !== 'all' && compareEnabled} showChange={comparablePeriods}/>}

      {/* Campaign Drill-Down Section */}
      {hasData && (<div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button type="button" aria-expanded={showCampaigns} onClick={() => setShowCampaigns(!showCampaigns)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Table size={20} className="text-indigo-600"/>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-slate-900">Campaign Breakdown</h3>
                <p className="text-sm text-slate-500">
                  {campaignsData?.totals.campaigns ?? '—'} campaigns
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

      {data && <section aria-label="Report coverage" className="rounded-xl border border-border bg-card p-4 text-sm"><p>{data.coverage.records} stored records across {data.coverage.observedDays} of {data.coverage.requestedDays} selected dates.</p><p>Missing dates are unknown, not zero. This is coverage of stored records, not proof every provider delivered complete data.</p>{data.coverage.unknownAccountRecords > 0 && <p role="status">{data.coverage.unknownAccountRecords} records still need source-account review.</p>}{!data.coverage.currencyKnown && <p role="status">Some records have unconfirmed currency. Dollar totals and cost-based rates are unavailable.</p>}<details className="mt-2"><summary>Metric definitions and source accounts</summary><p className="mt-2">Conversions are provider-attributed actions. They can be fractional, can overlap across platforms, and do not establish unique people or signed leases. CTR is clicks divided by impressions; CPC is spend divided by clicks; cost per reported conversion is spend divided by conversions. Rates with a zero denominator and changes from a zero baseline are unavailable. Dollar values are USD where confirmed. Dates follow each source account’s reporting calendar.</p><div className="mt-2 max-h-64 overflow-auto">{data.coverage.sources.map(x => <p key={JSON.stringify([x.channel, x.account])}>{getMarketingChannelLabel(x.channel)} · {x.account || 'Unattributed account'} · {x.records} records · {x.firstDate} to {x.lastDate}</p>)}</div></details></section>}

      {/* Retained marketing change review */}
      <AnomalyAlert key={`alerts:${currentProperty.id}`} propertyId={currentProperty.id} report={data}/>

      {/* Goal Tracking */}
      {currentProperty?.id && (<GoalTracker key={`goals:${currentProperty.id}`} propertyId={currentProperty.id} reportRange={data?.dateRange} coverageComplete={!!data && data.coverage.observedDays === data.coverage.requestedDays} filtered={channel !== 'all' || account !== 'all'} currentMetrics={{
                spend: data?.totals.spend,
                impressions: data?.totals.impressions,
                clicks: data?.totals.clicks,
                conversions: data?.totals.conversions,
                ctr: data?.totals.ctr,
                cpa: data?.totals.cpa,
            }}/>)}

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
export function PropertyPerformance() {
    const { currentProperty, loading, hasLoadedProperties } = usePropertyContext();
    if (loading)
        return <p role="status">Loading property…</p>;
    if (!hasLoadedProperties)
        return <p role="alert">Your property records are unavailable. Reload the page to try again.</p>;
    return <PropertyBI key={currentProperty.id}/>;
}
