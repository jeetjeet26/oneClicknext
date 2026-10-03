'use client';
import {AuditRecommendationWork} from '@/components/propertyaudit/AuditRecommendationWork';
import { useAuditDecisions } from '@/utils/propertyaudit/use-audit-decisions';
import { AuditDecisionRecovery, AuditDecisionHistory } from '@/components/propertyaudit/AuditDecisionHistory';
import { AuditQueryManager } from '@/components/propertyaudit/AuditQueryManager';
import { AuditRunInventory, AuditRunRequest, AuditReviewInventory, AuditServiceHistory } from '@/components/propertyaudit/AuditWorkspaceControls';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { ReliabilityPanel } from '@/components/operations/ReliabilityPanel';
import { AiOverviewCard, AlertBanner, CompetitorInsights, InsightsPanel, ModelComparisonCard, PositioningMatrix, QueryFilters, QueryTable, QueryTypeRings, ReportBuilder, RunDetails, RunStatusIndicator, ScoreRing, TrendChart, useGeoAlerts, useGeoInsights, type QueryRow } from '@/components/propertyaudit';
import { type Surface } from '@/utils/propertyaudit/types';
import { Eye, FileText, Globe, Minus, Play, Plus, RefreshCw, Search, Sparkles, TrendingDown, TrendingUp, } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
interface GeoScoreSummary {
    propertyId: string;
    overallScore: number;
    visibilityPct: number;
    brandedRecognitionPct: number | null;
    discoveryMentionPct: number | null;
    citationQuality: number | null;
    ownedCitationPct: number | null;
    genericCityMentionPct: number | null;
    scoreBucket: 'excellent' | 'good' | 'fair' | 'poor';
    surfaces: Partial<Record<Surface, SurfaceScore | null>>;
    surfaceSummaries: Array<{
        surface: Surface;
        label: string;
        score: number | null;
        visibilityPct: number | null;
        brandedRecognitionPct: number | null;
        discoveryMentionPct: number | null;
        citationQuality: number | null;
        ownedCitationPct: number | null;
        measured: boolean;
    }>;
    breakdown: {
        position: number;
        link: number;
        sov: number;
        accuracy: number;
    };
    lastRunAt: string | null;
    trend: {
        direction: 'up' | 'down' | 'stable';
        changePercent: number;
        metric?: 'discoveryMentionPct' | 'citationQuality';
    } | null;
}
interface SurfaceScore {
    overallScore: number;
    visibilityPct: number;
    brandedRecognitionPct?: number | null;
    discoveryMentionPct?: number | null;
    citationQuality?: number | null;
    ownedCitationPct?: number | null;
    avgLlmRank: number | null;
    avgLinkRank: number | null;
    avgSov: number | null;
    runId: string;
    runAt: string;
}
interface GeoRun {
    id: string;
    batchId: string | null;
    surface: Surface;
    status: 'queued' | 'running' | 'completed' | 'failed';
    queryCount: number;
    progressPct: number;
    currentQueryIndex: number;
    statusLabel: string;
    statusDetail: string;
    isPossiblyStalled: boolean;
    errorMessage: string | null;
    startedAt: string;
    usesWebSearch?: boolean;
    score: {
        overallScore: number;
        visibilityPct: number;
    } | null;
    diff: {
        scoreChange: number;
        direction: 'up' | 'down' | 'stable';
    } | null;
}
type TrendPoint = {
    date: string;
    score: number;
    visibility: number;
};
const TREND_WINDOW_MONTHS = 3;
function isWithinTrendWindow(startedAt: string, months = TREND_WINDOW_MONTHS) {
    const runTime = Date.parse(startedAt);
    if (Number.isNaN(runTime))
        return false;
    // Include the full calendar month at the boundary (May 1 for a 3-month
    // window when current date is in August).
    const cutoff = new Date();
    cutoff.setUTCDate(1);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    return runTime >= cutoff.getTime();
}
function average(values: number[]) {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function buildBatchTrendData(runs: GeoRun[]): TrendPoint[] {
    const batches = new Map<string, {
        startedAt: string;
        scores: number[];
        visibility: number[];
    }>();
    runs
        .filter(run => isWithinTrendWindow(run.startedAt))
        .forEach(run => {
        const batchKey = run.batchId || run.id;
        const entry = batches.get(batchKey) || {
            startedAt: run.startedAt,
            scores: [],
            visibility: [],
        };
        if (Date.parse(run.startedAt) < Date.parse(entry.startedAt)) {
            entry.startedAt = run.startedAt;
        }
        if (run.status === 'completed' && run.score) {
            entry.scores.push(run.score.overallScore);
            entry.visibility.push(run.score.visibilityPct);
        }
        batches.set(batchKey, entry);
    });
    return Array.from(batches.values())
        .filter(batch => batch.scores.length > 0)
        .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
        .map(batch => ({
        date: batch.startedAt,
        score: average(batch.scores),
        visibility: average(batch.visibility),
    }));
}
export default function PropertyAuditPage() {
    const { currentProperty, loading, hasLoadedProperties } = usePropertyContext();
    if (loading)
        return <p role="status" className="p-6 text-sm text-slate-500">Loading property records…</p>;
    if (!hasLoadedProperties)
        return <p role="alert" className="p-6 text-sm text-amber-700">Your property records are unavailable. Reload the page to try again.</p>;
    return <PropertyAuditWorkspace key={currentProperty.id}/>;
}
function PropertyAuditWorkspace() {
    const { currentProperty } = usePropertyContext();
    const [score, setScore] = useState<GeoScoreSummary | null>(null);
    const [queries, setQueries] = useState<QueryRow[]>([]);
    const [visibleQueries, setVisibleQueries] = useState<QueryRow[]>([]);
    const [runs, setRuns] = useState<GeoRun[]>([]);
    const [competitors, setCompetitors] = useState<Array<{
        name: string;
        domain: string;
        mentionCount: number;
        avgRank: number;
    }>>([]);
    const [aiOverviewSummary, setAiOverviewSummary] = useState<{
        totalTracked: number;
        visibleCount: number;
        visibilityPct: number;
        byType: Array<{
            type: string;
            visiblePct: number;
        }>;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [readError, setReadError] = useState<string | null>(null);
    const [readScope, setReadScope] = useState('');
    const [coverage, setCoverage] = useState<Array<{surface:string;retainedAnswers:number;capturedExecutions:number|null}>>([]);
    const pendingRead = useRef<AbortController | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'queries' | 'recommendations' | 'insights' | 'history'>('overview');
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [showReportBuilder, setShowReportBuilder] = useState(false);
    const [reportFormat, setReportFormat] = useState<'html' | 'queries_csv' | 'findings_csv'>('html');
    const [showRunAuditModal, setShowRunAuditModal] = useState(false);
    const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
    const isRunning = false, isGeneratingQueries = false, runAuditError = null;
    const audit = useAuditDecisions(currentProperty?.id || '', () => { void fetchData(); });
    // Generate alerts and insights
    const alerts = useGeoAlerts(score, runs, competitors);
    const visibleAlerts = alerts.filter(alert => !dismissedAlertIds.includes(alert.id));
    const insights = useGeoInsights(score, queries, runs);
    useEffect(() => {
        if (currentProperty?.id) {
            // Clear existing data immediately when property changes
            setScore(null);
            setQueries([]);
            setRuns([]);
            setCompetitors([]);
            setAiOverviewSummary(null);
            fetchData();
        }
        return () => pendingRead.current?.abort();
    }, [currentProperty?.id]);
    const fetchData = async () => {
        if (!currentProperty?.id)
            return;
        pendingRead.current?.abort();
        const request = new AbortController(); pendingRead.current = request;
        setLoading(true); setReadError(null);
        try {
            await Promise.all([
                fetchScore(request.signal),
                fetchQueries(request.signal),
                fetchRuns(request.signal),
                fetchCompetitors(request.signal),
                fetchAiOverviews(request.signal)
            ]);
        }
        catch (error) {
            if (!request.signal.aborted) setReadError(error instanceof Error ? error.message : 'Unable to read audit results');
        }
        finally {
            if (!request.signal.aborted) setLoading(false);
        }
    };
    const fetchScore = async (signal: AbortSignal) => {
        const res = await fetch(`/api/propertyaudit/score?propertyId=${currentProperty?.id}`, {
            cache: 'no-store', signal,
            headers: {
                'Cache-Control': 'no-cache',
            }
        });
        const data = await res.json();
        if (signal.aborted) return;
        console.log('[PropertyAudit] Fetched score for property:', currentProperty?.id, data);
        if (res.ok) {
            setScore(data.score || null);
            setReadScope(data.scope || ''); setCoverage(data.coverage || []);
        }
        else {
            setScore(null);
            throw new Error('Unable to load saved audit scores');
        }
    };
    const fetchQueries = async (signal: AbortSignal) => {
        const res = await fetch(`/api/propertyaudit/queries?propertyId=${currentProperty?.id}`, {
            cache: 'no-store', signal
        });
        const data = await res.json();
        if (signal.aborted) return;
        if (!res.ok) throw new Error('Unable to load audit questions');
        if (res.ok) {
            setQueries(data.queries || []);
        }
    };
    const fetchRuns = async (signal: AbortSignal) => {
        const through = new Date();
        const since = new Date(Date.UTC(through.getUTCFullYear(), through.getUTCMonth() - 3, 1));
        const loaded: GeoRun[] = [];
        let offset: number | null = 0;
        while (offset !== null) {
            const params = new URLSearchParams({propertyId:currentProperty!.id, limit:'200', offset:String(offset), since:since.toISOString(), through:through.toISOString()});
            const res = await fetch(`/api/propertyaudit/runs?${params}`, {cache:'no-store', signal});
            if (!res.ok) throw new Error('Unable to load the complete run window');
            const data: {runs:GeoRun[];nextOffset:number | null} = await res.json();
            loaded.push(...data.runs);
            if (data.nextOffset !== null && data.nextOffset <= offset) throw new Error('Invalid run history page');
            offset = data.nextOffset;
        }
        if (!signal.aborted) setRuns(loaded);
    };
    const fetchCompetitors = async (signal: AbortSignal) => {
        const res = await fetch(`/api/propertyaudit/insights?propertyId=${currentProperty?.id}&surface=both`, {cache:'no-store', signal});
        const data = await res.json();
        if (signal.aborted) return;
        if (!res.ok) throw new Error('Unable to load audit insights');
        if (res.ok) {
            setCompetitors(data.competitors || []);
        }
    };
    const fetchAiOverviews = async (signal: AbortSignal) => {
        const res = await fetch(`/api/propertyaudit/ai-overviews?propertyId=${currentProperty?.id}`, {cache:'no-store', signal});
        const data = await res.json();
        if (signal.aborted) return;
        if (!res.ok) throw new Error('Unable to load search overview results');
        if (res.ok && data.data) {
            // Build summary from raw data
            const overviews = data.data as Array<{
                query_id: string;
                visible: boolean;
                source_url?: string;
            }>;
            const total = overviews.length;
            const visible = overviews.filter(o => o.visible).length;
            // Group by query type (we'll need to match with queries)
            const typeVisibility = new Map<string, {
                total: number;
                visible: number;
            }>();
            overviews.forEach(overview => {
                const query = queries.find(q => q.id === overview.query_id);
                if (query) {
                    const type = query.type;
                    const entry = typeVisibility.get(type) || { total: 0, visible: 0 };
                    entry.total += 1;
                    if (overview.visible)
                        entry.visible += 1;
                    typeVisibility.set(type, entry);
                }
            });
            setAiOverviewSummary({
                totalTracked: total,
                visibleCount: visible,
                visibilityPct: total > 0 ? Math.round((visible / total) * 100) : 0,
                byType: Array.from(typeVisibility.entries()).map(([type, entry]) => ({
                    type,
                    visiblePct: entry.total > 0 ? Math.round((entry.visible / entry.total) * 100) : 0
                }))
            });
        }
    };
    const generateQueryPanel = () => setActiveTab('queries');
    const getScoreColor = (bucket: string) => {
        switch (bucket) {
            case 'excellent': return 'text-green-600';
            case 'good': return 'text-blue-600';
            case 'fair': return 'text-yellow-600';
            case 'poor': return 'text-red-600';
            default: return 'text-gray-600';
        }
    };
    const TrendIcon = ({ direction }: {
        direction: 'up' | 'down' | 'stable';
    }) => {
        if (direction === 'up')
            return <TrendingUp className="w-4 h-4 text-green-500"/>;
        if (direction === 'down')
            return <TrendingDown className="w-4 h-4 text-red-500"/>;
        return <Minus className="w-4 h-4 text-gray-400"/>;
    };
    // Build trend data by audit batch so same-day surfaces do not render as history.
    const trendData = buildBatchTrendData(runs);
    const latestCompletedRun = runs.find(r => r.status === 'completed') || null;
    const latestCompletedBatchId = latestCompletedRun?.batchId || null;
    if (!currentProperty?.id) {
        return (<div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Search className="w-12 h-12 text-gray-300 mx-auto mb-4"/>
          <p className="text-gray-500">Select a property to view GEO insights</p>
        </div>
      </div>);
    }
    return (<div className="space-y-6">
      {readError && <div role="alert" className="rounded-lg border border-amber-400 p-3 text-sm">{readError}. Previously loaded sections may be out of date. <button onClick={() => void fetchData()} className="underline">Reload audit results</button></div>}
      {readScope && <details className="text-xs text-gray-500"><summary>Measurement coverage</summary><p className="mt-2">{readScope}</p><p>Comparisons are withheld when captured questions, models or property context differ.</p>{coverage.map((item,index) => <p key={index}>{item.surface}: {item.retainedAnswers} retained answers / {item.capturedExecutions ?? 'unknown'} captured executions</p>)}</details>}
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Search className="w-7 h-7 text-indigo-500"/>
            <span>PropertyAudit</span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Generative Engine Optimization (GEO) - Track AI visibility
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setReportFormat('html'); setShowReportBuilder(true); }} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <FileText className="w-4 h-4"/>
            Reports & exports
          </button>
          <button onClick={() => setShowRunAuditModal(true)} disabled={audit.busy || !!audit.pending || !audit.canManage || !audit.context?.queryCount} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <Play className={`w-4 h-4 ${isRunning ? 'animate-pulse' : ''}`}/>
            {isRunning ? 'Running...' : 'Run Audit'}
          </button>
        </div>
      </div>

      <AuditDecisionRecovery controller={audit}/>
      <ReliabilityPanel key={currentProperty.id} propertyId={currentProperty.id} area="geo"/>

      {/* Run Status Indicator */}
      {currentProperty?.id && (<RunStatusIndicator propertyId={currentProperty.id} onRunCompleted={fetchData}/>)}

      {runAuditError && (<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {runAuditError}
        </div>)}

      {/* Alert Banners */}
      {visibleAlerts.length > 0 && (<AlertBanner alerts={visibleAlerts} onDismiss={(id) => setDismissedAlertIds(prev => [...prev, id])}/>)}

      {/* Score Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Branded recognition</span>
            {score?.trend?.metric === 'citationQuality' ? null : score?.trend && <TrendIcon direction={score.trend.direction}/>}
          </div>
          {loading ? (<div className="h-12 bg-gray-200 rounded animate-pulse"/>) : score?.brandedRecognitionPct != null ? (<div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {Math.round(score.brandedRecognitionPct)}%
              </span>
            </div>) : (<p className="text-gray-400 text-sm">No data yet</p>)}
          <p className="mt-2 text-xs text-gray-500">Named-prompt presence after collapsing repeats</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Discovery mention</span>
            {score?.trend?.metric === 'discoveryMentionPct' && <TrendIcon direction={score.trend.direction}/>}
          </div>
          {loading ? (<div className="h-12 bg-gray-200 rounded animate-pulse"/>) : score?.discoveryMentionPct != null ? (<div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">
                  {Math.round(score.discoveryMentionPct)}%
                </span>
                {score.trend && score.trend.metric === 'discoveryMentionPct' && score.trend.changePercent !== 0 && (<span className={`text-xs ${score.trend.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                    {score.trend.direction === 'up' ? '+' : ''}{score.trend.changePercent.toFixed(1)} pts
                  </span>)}
              </div>
            </div>) : (<p className="text-gray-400 text-sm">No data yet</p>)}
          <p className="mt-2 text-xs text-gray-500">Category and local prompts, excluding generic city-wide queries</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Citation quality</span>
            <Eye className="w-4 h-4 text-gray-400"/>
          </div>
          {loading ? (<div className="h-12 bg-gray-200 rounded animate-pulse"/>) : score ? (<div className="flex items-center gap-3">
              <ScoreRing score={score.citationQuality ?? score.overallScore} size={60}/>
              <div>
                <div className={`text-3xl font-bold ${getScoreColor(score.scoreBucket)}`}>
                  {Math.round(score.citationQuality ?? score.overallScore)}
                </div>
                <p className="text-xs text-gray-500">Not a visibility score</p>
              </div>
            </div>) : (<p className="text-gray-400 text-sm">No data yet</p>)}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">Owned citations</span>
          </div>
          {loading ? (<div className="h-12 bg-gray-200 rounded animate-pulse"/>) : score?.ownedCitationPct != null ? (<span className="text-3xl font-bold text-gray-900 dark:text-white">
              {Math.round(score.ownedCitationPct)}%
            </span>) : (<p className="text-gray-400 text-sm">No data yet</p>)}
          <p className="mt-2 text-xs text-gray-500">Queries with a brand-domain citation</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {(score?.surfaceSummaries || []).map((surface) => (<div key={surface.surface} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">{surface.label}</span>
              {surface.surface === 'chatgpt' || surface.surface === 'perplexity' ? (<Sparkles className="w-4 h-4 text-green-500"/>) : (<Globe className="w-4 h-4 text-purple-500"/>)}
            </div>
            {loading ? (<div className="h-12 bg-gray-200 rounded animate-pulse"/>) : surface.measured ? (<div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-gray-900 dark:text-white">
                    {surface.discoveryMentionPct != null ? `${Math.round(surface.discoveryMentionPct)}%` : '—'}
                  </span>
                  <span className="text-sm text-gray-500">
                    branded {surface.brandedRecognitionPct != null ? `${Math.round(surface.brandedRecognitionPct)}%` : '—'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Citation quality {surface.citationQuality != null ? Math.round(surface.citationQuality) : '—'}
                </p>
              </div>) : (<p className="text-gray-400 text-sm">Not measured</p>)}
          </div>))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6 overflow-x-auto">
          {(['overview', 'queries', 'recommendations', 'insights', 'history'] as const).map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} className={`py-3 px-1 font-medium text-sm border-b-2 transition-colors capitalize ${activeTab === tab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab === 'queries' ? `Queries (${queries.length})` : tab}
            </button>))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === 'overview' && (<div className="space-y-6">
            {queries.length === 0 ? (<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-4"/>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No Query Panel Yet
                </h3>
                <p className="text-gray-500 mb-4">
                  Review questions from your property data before activating future audit measurements.
                </p>
                <button onClick={() => generateQueryPanel()} disabled={isGeneratingQueries} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {isGeneratingQueries ? (<RefreshCw className="w-4 h-4 animate-spin"/>) : (<Plus className="w-4 h-4"/>)}
                  {isGeneratingQueries ? 'Generating...' : 'Prepare audit questions'}
                </button>
              </div>) : (<>
                {/* Insights Panel */}
                {insights.length > 0 && (<InsightsPanel insights={insights} onViewFullAnalysis={() => setActiveTab('recommendations')}/>)}

                {/* Model Comparison + Query Type Rings + AI Overview */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {/* Model Comparison */}
                  {(() => {
                    const measured = (score?.surfaceSummaries || []).filter(surface => surface.measured);
                    const primarySurface = measured[0];
                    const secondarySurface = measured[1];
                    return (<ModelComparisonCard primary={primarySurface ? score?.surfaces[primarySurface.surface] || null : null} primaryLabel={primarySurface?.label || 'Primary Surface'} secondary={secondarySurface ? score?.surfaces[secondarySurface.surface] || null : null} secondaryLabel={secondarySurface?.label || 'Secondary Surface'} onViewDetails={() => setActiveTab('insights')}/>);
                })()}

                  {/* Query Type Performance */}
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Performance by Query Type
                    </h3>
                    <QueryTypeRings queries={queries}/>
                  </div>

                  {/* AI Overview Visibility */}
                  <AiOverviewCard summary={aiOverviewSummary} isLoading={loading}/>
                </div>

                {/* Trend Chart */}
                {trendData.length > 1 && (<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Score Trend
                    </h3>
                    <p className="mb-3 text-xs text-gray-500">Completed, unarchived, non-synthetic runs since the start of the UTC month three months ago. Questions and models may differ; this chart alone does not establish improvement.</p><TrendChart points={trendData} height={200}/>
                  </div>)}

                {/* Score Breakdown */}
                {score?.breakdown && (<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                      Score Breakdown
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Position
                            <span className="text-gray-400 ml-1">(45% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.position)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${score.breakdown.position}%` }}/>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Link Rank
                            <span className="text-gray-400 ml-1">(25% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.link)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${score.breakdown.link}%` }}/>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Share of Voice
                            <span className="text-gray-400 ml-1">(20% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.sov)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${score.breakdown.sov}%` }}/>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">
                            Accuracy
                            <span className="text-gray-400 ml-1">(10% weight)</span>
                          </span>
                          <span className="text-sm font-medium">{Math.round(score.breakdown.accuracy)}/100</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${score.breakdown.accuracy}%` }}/>
                        </div>
                      </div>
                    </div>
                  </div>)}
              </>)}
          </div>)}

        {/* Queries and measured performance */}
        {activeTab === 'queries' && <div className="space-y-6"><AuditQueryManager controller={audit}/><section className="space-y-3"><h3 className="font-semibold">Recent performance for unchanged active questions</h3><p className="text-sm text-gray-500">Measurements from the two latest completed, unarchived provider runs. Earlier wording is available in the captured run evidence.</p><QueryFilters queries={queries} onFilteredChange={setVisibleQueries}/><QueryTable key={currentProperty?.id} queries={visibleQueries} onExport={() => { setReportFormat('queries_csv'); setShowReportBuilder(true); }}/></section></div>}
        {activeTab === 'recommendations' && <div className="space-y-6"><AuditRecommendationWork key={currentProperty.id+audit.actor} controller={audit}/><button className="rounded border px-3 py-2 text-sm" onClick={() => { setReportFormat('findings_csv'); setShowReportBuilder(true); }}>Export findings CSV</button><AuditReviewInventory controller={audit} kind="findings"/><AuditReviewInventory controller={audit} kind="recommendations"/></div>}

        {/* Insights Tab */}
        {activeTab === 'insights' && currentProperty?.id && (<div className="space-y-6">
            <PositioningMatrix queries={queries} competitors={competitors}/>
            <CompetitorInsights propertyId={currentProperty.id}/>
          </div>)}

        {activeTab === 'history' && <div className="space-y-6"><AuditRunInventory controller={audit} onOpenRun={setSelectedRunId}/><AuditDecisionHistory controller={audit}/><AuditServiceHistory controller={audit}/></div>}
      </div>

      {/* Modals/Drawers */}
      <RunDetails key={selectedRunId} controller={audit} onOpenRun={setSelectedRunId} runId={selectedRunId} isOpen={selectedRunId !== null} onClose={() => setSelectedRunId(null)}/>

      <ReportBuilder initialFormat={reportFormat} isOpen={showReportBuilder} onClose={() => setShowReportBuilder(false)} propertyId={currentProperty?.id || ''} propertyName={currentProperty?.name || 'Property'} runId={latestCompletedRun?.id || null} batchId={latestCompletedBatchId} runSummary={latestCompletedRun ? {
            surface: latestCompletedRun.surface,
            startedAt: latestCompletedRun.startedAt,
        } : null}/>

      {showRunAuditModal && <AuditRunRequest controller={audit} onClose={() => setShowRunAuditModal(false)}/>}
    </div>);
}
