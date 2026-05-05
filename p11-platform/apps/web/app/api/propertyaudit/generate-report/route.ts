/**
 * PropertyAudit Report Generation API
 * Generates print-ready PropertyAudit reports with visualizations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { buildCharts, buildPropertyReportData, buildRunReportData } from '@/utils/propertyaudit/reporting'

type ReportData = Awaited<ReturnType<typeof buildPropertyReportData>>
type ReportRecommendation = ReportData['recommendations'][number]
type RecommendationWorkstream = 'Owned Content' | 'Citation Targets' | 'Entity / Technical Fixes' | 'Competitive Plays'

type ReportingClient = {
  from: (table: string) => unknown
  rpc: (fn: string, args: Record<string, unknown>) => unknown
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, runId, batchId, template, includeSections } = body

    if (!propertyId || !template) {
      return NextResponse.json(
        { error: 'propertyId and template required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceClient()
    let reportData: Awaited<ReturnType<typeof buildPropertyReportData>> | Awaited<ReturnType<typeof buildRunReportData>>

    if (batchId) {
      const { count, error: batchError } = await serviceClient
        .from('geo_runs')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId)
        .eq('batch_id', batchId)
        .eq('status', 'completed')

      if (batchError) {
        return NextResponse.json({ error: 'Failed to validate report batch' }, { status: 500 })
      }

      if (!count) {
        return NextResponse.json(
          { error: 'Report generation requires at least one completed run in the selected batch' },
          { status: 409 }
        )
      }

      reportData = await buildPropertyReportData(
        serviceClient as unknown as ReportingClient,
        propertyId,
        { batchId }
      )
    } else if (runId) {
      const { data: run, error: runError } = await serviceClient
        .from('geo_runs')
        .select('id, property_id, status')
        .eq('id', runId)
        .single()

      if (runError || !run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      }

      if (run.property_id !== propertyId) {
        return NextResponse.json({ error: 'Run does not belong to property' }, { status: 400 })
      }

      if (run.status !== 'completed') {
        return NextResponse.json(
          {
            error: 'Report generation requires a completed run',
            currentStatus: run.status,
          },
          { status: 409 }
        )
      }

      reportData = await buildRunReportData(
        serviceClient as unknown as ReportingClient,
        runId
      )

      if (!reportData) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      }
    } else {
      const { data: latestCompletedRun } = await serviceClient
        .from('geo_runs')
        .select('id')
        .eq('property_id', propertyId)
        .eq('status', 'completed')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!latestCompletedRun?.id) {
        return NextResponse.json(
          { error: 'Report generation requires at least one completed run' },
          { status: 409 }
        )
      }

      reportData = await buildPropertyReportData(
        supabase as unknown as ReportingClient,
        propertyId
      )
    }

    const html = generateReportHTML(reportData, template, includeSections || [])

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="geo_visibility_report_${propertyId}.html"`,
        'X-PropertyAudit-Artifact-Format': 'html',
      },
    })
  } catch (error) {
    console.error('Report Generation Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

function generateReportHTML(
  data: Awaited<ReturnType<typeof buildPropertyReportData>>,
  template: string,
  sections: string[]
): string {
  const {
    property,
    runs,
    surfaceSummaries = [],
    siteAudit = {
      accessMode: 'URLOnly',
      websiteUrl: null,
      normalizedOrigin: null,
      homepageReachable: false,
      robotsTxtReachable: false,
      sitemapReachable: false,
      llmsTxtReachable: false,
      title: null,
      metaDescription: null,
      structuredDataTypes: [],
      faqStructuredData: false,
      organizationStructuredData: false,
      answerBlockSignals: 0,
      internalLinkCount: 0,
      notes: [],
    },
    queries,
    competitors,
    scores,
    recommendations,
    recommendationSummary,
    queryTypeStats,
    rankSummary = {
      brandedRecognitionPct: null,
      nonBrandedDiscoveryRank: null,
      nonBrandedVisibilityPct: null,
      comparisonAvgRank: null,
    },
    citationSummary,
    trends,
    glossary,
    insights,
    narrative,
    aiOverviewSummary
  } = data

  const latestScore = scores[0]
  const propertyName = property?.name || 'Property'
  const generatedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const charts = buildCharts({ trends, queryTypeStats, recommendationSummary, competitors })
  const templateLabel = template === 'executive'
    ? 'Executive Brief'
    : template === 'competitive'
    ? 'Competitive Intelligence'
    : template === 'progress'
    ? 'Monthly Progress'
    : 'Comprehensive Audit'
  const defaultSections = ['summary', 'scores', 'models', 'competitors', 'recommendations', 'queries', 'appendix']
  const sectionSet = new Set([...(sections.length > 0 ? sections : defaultSections), 'recommendations', 'appendix'])
  const hasSection = (id: string) => sectionSet.has(id)
  const bestSurface = [...surfaceSummaries]
    .filter(surface => typeof surface.overallScore === 'number')
    .sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0))[0]
  const weakestSurface = [...surfaceSummaries]
    .filter(surface => typeof surface.overallScore === 'number')
    .sort((a, b) => (a.overallScore || 0) - (b.overallScore || 0))[0]
  const weakestType = [...queryTypeStats]
    .sort((a, b) => a.presencePct - b.presencePct)[0]
  const topActions = recommendations.slice(0, 3)
  const groupedRecommendations = groupRecommendationsByWorkstream(recommendations)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Visibility Report - ${escapeHtml(propertyName)}</title>
  <style>
    @page {
      size: Letter;
      margin: 0.75in;
    }
    
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 20px;
    }
    
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 10in;
      text-align: center;
      page-break-after: always;
    }
    
    .logo {
      font-size: 2.5rem;
      font-weight: bold;
      color: #6366f1;
      margin-bottom: 2rem;
    }
    
    h1 {
      font-size: 2.5rem;
      color: #111827;
      margin: 1rem 0;
      font-weight: 700;
    }
    
    h2 {
      font-size: 1.75rem;
      color: #374151;
      margin: 2rem 0 1rem 0;
      border-bottom: 3px solid #6366f1;
      padding-bottom: 0.5rem;
      page-break-after: avoid;
    }
    
    h3 {
      font-size: 1.25rem;
      color: #4b5563;
      margin: 1.5rem 0 0.75rem 0;
      page-break-after: avoid;
    }
    
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    
    .metric-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
    }
    
    .metric-value {
      font-size: 2.25rem;
      font-weight: bold;
      color: #6366f1;
      line-height: 1;
    }
    
    .metric-label {
      font-size: 0.875rem;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 0.5rem;
    }
    
    .query-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      font-size: 0.875rem;
      table-layout: fixed;
    }
    
    .query-table th {
      background: #f3f4f6;
      padding: 0.75rem;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #d1d5db;
    }
    
    .query-table td {
      padding: 0.75rem;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
      word-break: break-word;
      white-space: normal;
    }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .badge-success {
      background: #d1fae5;
      color: #065f46;
    }
    
    .badge-warning {
      background: #fef3c7;
      color: #92400e;
    }
    
    .badge-error {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .recommendation-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 1.25rem;
      margin: 1rem 0;
      page-break-inside: avoid;
    }

    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }

    .chart-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 1rem;
    }

    svg {
      max-width: 100%;
      height: auto;
      display: block;
    }
    
    .footer {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 0.75rem;
    }
    
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="cover-page">
    <div class="logo">P11 PropertyAudit</div>
    <h1>GEO Visibility Report</h1>
    <div style="font-size: 1.5rem; color: #6b7280; margin: 1rem 0;">
      ${escapeHtml(propertyName)}
    </div>
    <div style="font-size: 1.125rem; color: #9ca3af;">
      Generated: ${generatedDate}
    </div>
    ${property?.address?.city ? `
      <div style="margin-top: 2rem; color: #6b7280;">
        ${escapeHtml(property.address.city)}, ${escapeHtml(property.address.state || '')}
      </div>
    ` : ''}
  </div>

  ${hasSection('summary') ? `
  <h2>Executive Snapshot</h2>
  <div class="metric-grid">
    <div class="metric-card">
      <div class="metric-value">${latestScore ? Math.round(latestScore.overall_score) : 'N/A'}</div>
      <div class="metric-label">GEO Score</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${latestScore ? Math.round(latestScore.visibility_pct) : 'N/A'}%</div>
      <div class="metric-label">Visibility</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${rankSummary.nonBrandedDiscoveryRank !== null ? rankSummary.nonBrandedDiscoveryRank.toFixed(1) : 'N/A'}</div>
      <div class="metric-label">Discovery Rank</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${queries?.length || 0}</div>
      <div class="metric-label">Queries Tracked</div>
    </div>
  </div>

  <h3>Client Readout</h3>
  <ul style="line-height: 1.8;">
    <li><strong>Where you are:</strong> Overall AI visibility score is <strong>${latestScore ? Math.round(latestScore.overall_score) : 'N/A'}/100</strong> ${getScoreBucket(latestScore?.overall_score)} with <strong>${latestScore ? Math.round(latestScore.visibility_pct) : 0}%</strong> query visibility.</li>
    <li><strong>Discovery rank:</strong> ${rankSummary.nonBrandedDiscoveryRank !== null ? `Average #${rankSummary.nonBrandedDiscoveryRank.toFixed(1)} across non-branded category, local, and comparison prompts.` : 'Not enough non-branded ranking data yet.'}</li>
    <li><strong>Branded recognition:</strong> ${rankSummary.brandedRecognitionPct !== null ? `${rankSummary.brandedRecognitionPct}% entity recognition on branded prompts. This is tracked separately from discovery rank.` : 'No branded prompt data yet.'}</li>
    <li><strong>Best surface:</strong> ${bestSurface ? `${escapeHtml(bestSurface.label)} at ${Math.round(bestSurface.overallScore || 0)}/100` : 'More run data needed'}.</li>
    <li><strong>Largest surface gap:</strong> ${weakestSurface ? `${escapeHtml(weakestSurface.label)} at ${Math.round(weakestSurface.overallScore || 0)}/100` : 'More run data needed'}.</li>
    <li><strong>Weakest prompt cluster:</strong> ${weakestType ? `${escapeHtml(weakestType.type)} at ${weakestType.presencePct}% presence` : 'More query data needed'}.</li>
    <li><strong>Competitive pressure:</strong> ${competitors.length > 0 ? `${escapeHtml(competitors[0].name)} is the top mentioned competitor (${competitors[0].mentionCount} mentions).` : 'Competitive analysis in progress.'}</li>
  </ul>

  ${topActions.length > 0 ? `
  <h3>Top 3 Next Actions</h3>
  <ol style="line-height: 1.8;">
    ${topActions.map(action => `
      <li><strong>${escapeHtml(action.title)}</strong> — ${escapeHtml(action.accessLevel || 'URLOnly')} / ${escapeHtml(action.owner || 'seo')} / ${escapeHtml(action.targetPageType || 'target page TBD')}</li>
    `).join('')}
  </ol>
  ` : ''}

  ${narrative ? `
  <h3>Executive Narrative</h3>
  <div style="color: #374151; margin-bottom: 1.5rem;">
    ${formatNarrative(narrative)}
  </div>
  ` : ''}

  <h3>Insight Highlights</h3>
  <ul style="line-height: 1.8;">
    ${insights.highlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
  </ul>

  ${insights.risks.length > 0 ? `
  <h3>Risks to Address</h3>
  <ul style="line-height: 1.8;">
    ${insights.risks.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
  </ul>
  ` : ''}

  ${insights.opportunities.length > 0 ? `
  <h3>Opportunities</h3>
  <ul style="line-height: 1.8;">
    ${insights.opportunities.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
  </ul>
  ` : ''}
  <h3>Measurement Notes</h3>
  <ul style="line-height: 1.8;">
    ${surfaceSummaries.map(summary => `<li><strong>${escapeHtml(summary.label)}:</strong> ${escapeHtml(summary.measurementNote)}</li>`).join('')}
  </ul>
  <h3>Methodology & Confidence</h3>
  <p style="color: #374151;">
    PropertyAudit uses API-first grounded proxies, natural answer capture, structured extraction, and repeated-run aggregation.
    Results should be interpreted as directional AI visibility evidence, not exact browser-surface capture.
  </p>
  <p style="color: #374151;">
    Sample size: ${data.answers.length} aggregated prompt results across ${runs.length} completed run${runs.length === 1 ? '' : 's'}.
    Citation consistency and answer drift are used to identify stable patterns versus noisy responses.
  </p>
  ` : ''}

  ${hasSection('scores') ? `
  <h2>Score Overview & Trends</h2>
  <div class="metric-grid">
    ${insights.summaryStats.map(stat => `
      <div class="metric-card">
        <div class="metric-value">${escapeHtml(stat.value)}</div>
        <div class="metric-label">${escapeHtml(stat.label)}</div>
      </div>
    `).join('')}
  </div>
  
  <h3>Historical Performance</h3>
  <p style="color: #6b7280; margin-bottom: 1rem;">
    Track your GEO Score and Query Presence rate across recent audit runs to identify trends and measure improvement.
  </p>
  <div class="chart-grid">
    <div class="chart-card">${charts.scoreTrend}</div>
    <div class="chart-card">${charts.visibilityTrend}</div>
  </div>
  <h3>Surface Coverage</h3>
  <table class="query-table">
    <thead>
      <tr>
        <th>Surface</th>
        <th>Last Run</th>
        <th>Score</th>
        <th>Visibility</th>
      </tr>
    </thead>
    <tbody>
      ${surfaceSummaries.map(summary => `
        <tr>
          <td>${escapeHtml(summary.label)}</td>
          <td>${summary.lastRunAt ? escapeHtml(new Date(summary.lastRunAt).toLocaleString()) : '—'}</td>
          <td>${summary.overallScore !== null ? summary.overallScore.toFixed(1) : '—'}</td>
          <td>${summary.visibilityPct !== null ? `${Math.round(summary.visibilityPct)}%` : '—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <table class="query-table">
    <thead>
      <tr>
        <th>Run Date</th>
        <th>Surface</th>
        <th>Score</th>
        <th>Visibility</th>
        <th>Avg Rank (all prompts)</th>
      </tr>
    </thead>
    <tbody>
      ${runs.map(run => {
        const score = run.geo_scores?.[0]
        return `
        <tr>
          <td>${formatShortDate(run.started_at)}</td>
          <td>${escapeHtml(String(run.surface || '—'))}</td>
          <td>${score ? Math.round(score.overall_score) : '—'}</td>
          <td>${score ? Math.round(score.visibility_pct) + '%' : '—'}</td>
          <td>${score?.avg_llm_rank?.toFixed(1) || '—'}</td>
        </tr>
        `
      }).join('')}
    </tbody>
  </table>
  ` : ''}

  ${hasSection('models') ? `
  <h2>AI Visibility Position</h2>
  <p style="color: #6b7280; margin-bottom: 1rem;">
    This section shows how often AI surfaces recommend or cite the property, where the brand appears, and how stable the answer/citation pattern is.
  </p>
  <table class="query-table">
    <thead>
      <tr>
        <th>Surface</th>
        <th>Latest Score</th>
        <th>Visibility</th>
        <th>Avg Rank (all prompts)</th>
        <th>Avg SOV</th>
      </tr>
    </thead>
    <tbody>
      ${runs.slice(0, 4).map(run => {
        const score = run.geo_scores?.[0]
        return `
        <tr>
          <td>${escapeHtml(String(run.surface || '—'))}</td>
          <td>${score ? Math.round(score.overall_score) : '—'}</td>
          <td>${score ? Math.round(score.visibility_pct) + '%' : '—'}</td>
          <td>${score?.avg_llm_rank?.toFixed(1) || '—'}</td>
          <td>${score?.avg_sov ? `${Math.round(score.avg_sov * 100)}%` : '—'}</td>
        </tr>
        `
      }).join('')}
    </tbody>
  </table>
  ` : ''}

  ${hasSection('queries') ? `
  <h2>Query Performance Details</h2>
  
  <h3>AI Overviews Visibility</h3>
  <p>Visible in AI Overviews for <strong>${aiOverviewSummary.visibleCount}</strong> of ${aiOverviewSummary.totalTracked} queries (${aiOverviewSummary.visibilityPct}%).</p>
  <table class="query-table">
    <thead>
      <tr>
        <th>Query Type</th>
        <th>AI Overview Visibility</th>
      </tr>
    </thead>
    <tbody>
      ${aiOverviewSummary.byType.map(entry => `
        <tr>
          <td>${escapeHtml(entry.type)}</td>
          <td>${entry.visiblePct}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h3>Query Performance by Type</h3>
  <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 1rem; margin: 1rem 0; border-radius: 4px;">
    <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
      <strong>Metric Definitions:</strong><br/>
      • <strong>Presence:</strong> % of queries where your property is mentioned in the AI response<br/>
      • <strong>Avg SOV (Share of Voice):</strong> Among cited sources, what % reference your brand<br/>
      • <strong>Note:</strong> SOV only applies to category, comparison, and local queries. Branded and FAQ queries show "N/A" for SOV.<br>
      • <strong>Rank note:</strong> branded prompts are entity-recognition checks, so they do not count toward the headline discovery-rank metric.
    </p>
  </div>
  <div class="chart-grid">
    <div class="chart-card">${charts.queryTypeBar}</div>
  </div>
  <table class="query-table">
    <thead>
      <tr>
        <th>Query Type</th>
        <th>Queries</th>
        <th>Presence</th>
        <th>Avg Rank</th>
        <th>Avg SOV</th>
      </tr>
    </thead>
    <tbody>
      ${queryTypeStats.map(stat => {
        const avgSovLabel = stat.avgSov === null ? 'N/A' : `${Math.round(stat.avgSov * 100)}%`
        return `
        <tr>
          <td>${escapeHtml(stat.type)}</td>
          <td>${stat.total}</td>
          <td>${stat.presencePct}%</td>
          <td>${stat.type === 'branded' ? 'Entity recognition' : stat.avgRank?.toFixed(1) || '—'}</td>
          <td>${avgSovLabel}</td>
        </tr>
      `
      }).join('')}
    </tbody>
  </table>
  <h3>Individual Query Results</h3>
  <p style="color: #6b7280; margin-bottom: 1rem; font-size: 0.875rem;">
    Top 20 queries showing presence (whether mentioned), rank (position in results), and SOV (citation share where applicable).
  </p>
  <table class="query-table">
    <thead>
      <tr>
        <th>Query</th>
        <th>Type</th>
        <th>Presence</th>
        <th>Rank</th>
        <th>SOV</th>
      </tr>
    </thead>
    <tbody>
      ${data.answers?.slice(0, 20).map(answer => {
        const query = answer.geo_queries
        const presenceRate = typeof answer.presence_rate === 'number'
          ? Math.round(answer.presence_rate * 100)
          : (answer.presence ? 100 : 0)
        const presenceLabel = answer.presence ? `✓ Yes (${presenceRate}%)` : `✗ No (${presenceRate}%)`
        const sovLabel = answer.sov === null ? 'N/A' : answer.sov ? `${(answer.sov * 100).toFixed(0)}%` : '—'
        return `
        <tr>
          <td>${escapeHtml(query?.text || '—')}</td>
          <td><span class="badge">${escapeHtml(query?.type || '—')}</span></td>
          <td>
            ${answer?.presence 
              ? `<span class="badge badge-success">${presenceLabel}</span>`
              : `<span class="badge badge-error">${presenceLabel}</span>`
            }
          </td>
          <td>${answer?.llm_rank ? `#${answer.llm_rank}` : '—'}</td>
          <td>${sovLabel}</td>
        </tr>
        `
      }).join('')}
    </tbody>
  </table>
  ` : ''}

  ${hasSection('recommendations') ? `
  <h2>Strategic Action Plan</h2>
  <p style="color: #6b7280; margin-bottom: 1.5rem;">
    ${recommendationSummary.total} recommendations identified. Priorities: ${recommendationSummary.high} high, ${recommendationSummary.medium} medium, ${recommendationSummary.low} low.
  </p>
  <h3>30/60-Day Action Plan</h3>
  <ul style="line-height: 1.8;">
    <li><strong>Next 30 days:</strong> Execute the highest-impact strategic workstreams below: owned demand-capture content, comparison positioning, technical schema/FAQ fixes, and citation authority.</li>
    <li><strong>Next 60 days:</strong> Re-run the same selected LLM surfaces, compare surface drift, and update the roadmap based on which prompt clusters improved.</li>
  </ul>
  <div class="chart-grid">
    <div class="chart-card">${charts.recommendationBar}</div>
  </div>
  ${Object.entries(groupedRecommendations).map(([workstream, recs]) => `
    <h3>${escapeHtml(workstream)}</h3>
    <p style="color: #6b7280; font-size: 0.875rem;">${escapeHtml(getWorkstreamDescription(workstream as RecommendationWorkstream))}</p>
    ${recs.length === 0 ? '<p style="color: #6b7280;">No recommendations in this workstream for this report.</p>' : recs.map((rec, index) => `
    <div class="recommendation-card">
      <h3 style="margin-top: 0;">${index + 1}. ${escapeHtml(rec.title)}</h3>
      <p><strong>Priority:</strong> ${escapeHtml(rec.priority)} | <strong>Impact:</strong> ${rec.impact.score}/100</p>
      <p><strong>Access Level:</strong> ${escapeHtml(rec.accessLevel || 'URLOnly')} | <strong>Owner:</strong> ${escapeHtml(rec.owner || 'seo')} | <strong>Status:</strong> ${escapeHtml(rec.status || 'todo')}</p>
      <p><strong>Evidence Mode:</strong> ${escapeHtml(rec.evidenceMode || 'URLOnly')}</p>
      ${rec.targetPageType ? `<p><strong>Target Page Type:</strong> ${escapeHtml(rec.targetPageType)}</p>` : ''}
      ${rec.targetUrl ? `<p><strong>Target URL:</strong> ${escapeHtml(rec.targetUrl)}</p>` : ''}
      <p>${escapeHtml(rec.description)}</p>
      ${rec.evidence?.length ? `
        <p><strong>Evidence:</strong></p>
        <ul>
          ${rec.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${rec.sourceQueryEvidence?.length ? `
        <p><strong>GEO Query Evidence:</strong></p>
        <ul>
          ${rec.sourceQueryEvidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${rec.missingSignals?.length ? `
        <p><strong>Missing Signals:</strong> ${escapeHtml(rec.missingSignals.join(', '))}</p>
      ` : ''}
      ${rec.implementationSteps?.length ? `
        <p><strong>Exact Implementation:</strong></p>
        <ul>
          ${rec.implementationSteps.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${rec.acceptanceCriteria?.length ? `
        <p><strong>Acceptance Criteria:</strong></p>
        <ul>
          ${rec.acceptanceCriteria.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${rec.modelBreakdown ? `
        <p><strong>Model Impact:</strong>
          ${rec.modelBreakdown.affectedModels?.length ? rec.modelBreakdown.affectedModels.map(m => m.toUpperCase()).join(', ') : '—'}
        </p>
      ` : ''}
      ${rec.surfaceBreakdown ? `
        <p><strong>Surface Breakdown:</strong> ${Object.values(rec.surfaceBreakdown).map(surface => `${escapeHtml(surface.label)} ${surface.presence ? 'present' : 'absent'}${surface.rank ? ` (#${surface.rank})` : ''}`).join(', ')}</p>
      ` : ''}
      ${rec.competitorContext ? `
        <p><strong>Competitor Context:</strong> ${escapeHtml(rec.competitorContext.competitorName)} (${escapeHtml(rec.competitorContext.competitorDomain)})</p>
      ` : ''}
      ${rec.relatedQueries?.length ? `
        <p><strong>Related Queries:</strong> ${rec.relatedQueries.map(q => escapeHtml(q.text)).join(', ')}</p>
      ` : ''}
    </div>
    `).join('')}
  `).join('')}
  ` : ''}

  ${hasSection('competitors') && competitors.length > 0 ? `
  <h2>Competitive Landscape</h2>
  <p style="color: #6b7280; margin-bottom: 1.5rem;">
    Analysis of competitor mentions in AI search results:
  </p>
  <div class="chart-grid">
    <div class="chart-card">${charts.competitorBar}</div>
  </div>
  <table class="query-table">
    <thead>
      <tr>
        <th>Rank</th>
        <th>Competitor</th>
        <th>Mentions</th>
        <th>Avg Position</th>
      </tr>
    </thead>
    <tbody>
      ${competitors.slice(0, 10).map((comp, idx) => `
      <tr>
        <td><strong>${idx + 1}</strong></td>
        <td>${escapeHtml(comp.name)}</td>
        <td>${comp.mentionCount}</td>
        <td>#${comp.avgRank?.toFixed(1) || 'N/A'}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  <h3>Citation Coverage</h3>
  <p>Brand citation share: <strong>${citationSummary.brandPct}%</strong> of ${citationSummary.total} total citations.</p>
  ${citationSummary.topDomains.length > 0 ? `
    <table class="query-table">
      <thead>
        <tr>
          <th>Top Domains</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${citationSummary.topDomains.map(domain => `
          <tr>
            <td>${escapeHtml(domain.domain)}</td>
            <td>${domain.count}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}
  ` : ''}

  <h2>Public Site Discoverability</h2>
  <p style="color: #6b7280; margin-bottom: 1rem;">
    This URL-only audit section uses public website signals. It does not require code access, but CMS or engineering access may be needed to execute some fixes.
  </p>
  <table class="query-table">
    <thead>
      <tr>
        <th>Signal</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Homepage Reachable</td><td>${siteAudit.homepageReachable ? 'Yes' : 'No'}</td></tr>
      <tr><td>robots.txt</td><td>${siteAudit.robotsTxtReachable ? 'Reachable' : 'Missing / blocked'}</td></tr>
      <tr><td>sitemap.xml</td><td>${siteAudit.sitemapReachable ? 'Reachable' : 'Missing / blocked'}</td></tr>
      <tr><td>llms.txt</td><td>${siteAudit.llmsTxtReachable ? 'Reachable' : 'Missing / blocked'}</td></tr>
      <tr><td>Structured Data Types</td><td>${siteAudit.structuredDataTypes.length > 0 ? escapeHtml(siteAudit.structuredDataTypes.join(', ')) : 'None detected'}</td></tr>
      <tr><td>FAQ Structured Data</td><td>${siteAudit.faqStructuredData ? 'Present' : 'Not detected'}</td></tr>
      <tr><td>Answer Block Signals</td><td>${siteAudit.answerBlockSignals}</td></tr>
      ${siteAudit.crawlSummary ? `
        <tr><td>Pages Audited</td><td>${siteAudit.crawlSummary.pagesAudited}/${siteAudit.crawlSummary.pagesAttempted}</td></tr>
        <tr><td>Discovery Sources</td><td>${siteAudit.crawlSummary.discoverySources.map(escapeHtml).join(', ')}</td></tr>
      ` : ''}
    </tbody>
  </table>
  ${siteAudit.pages?.length ? `
    <h3>URL Page Inventory</h3>
    <table class="query-table">
      <thead>
        <tr>
          <th>Page Type</th>
          <th>URL</th>
          <th>Words</th>
          <th>Schema</th>
          <th>Answer Signals</th>
        </tr>
      </thead>
      <tbody>
        ${siteAudit.pages.filter(page => page.reachable).slice(0, 12).map(page => `
          <tr>
            <td>${escapeHtml(page.pageType)}</td>
            <td>${escapeHtml(page.url)}</td>
            <td>${page.wordCount}</td>
            <td>${page.structuredDataTypes.length > 0 ? escapeHtml(page.structuredDataTypes.join(', ')) : 'None detected'}</td>
            <td>${page.answerBlockSignals}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}
  ${siteAudit.notes.length > 0 ? `
    <ul style="line-height: 1.8;">
      ${siteAudit.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
    </ul>
  ` : ''}

  ${hasSection('appendix') ? `
  <h2>Evidence Appendix, Glossary & Methodology</h2>
  ${glossary.map(entry => `
    <div class="recommendation-card">
      <h3 style="margin-top: 0;">${escapeHtml(entry.term)}</h3>
      <p>${escapeHtml(entry.definition)}</p>
      ${entry.formula ? `<p><strong>Formula:</strong> ${escapeHtml(entry.formula)}</p>` : ''}
      ${entry.interpretation ? `<p><strong>Interpretation:</strong> ${escapeHtml(entry.interpretation)}</p>` : ''}
    </div>
  `).join('')}
  <h2>Data Appendix</h2>
  <table class="query-table">
    <thead>
      <tr>
        <th>Metric</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Report Template</td>
        <td>${escapeHtml(templateLabel)}</td>
      </tr>
      <tr>
        <td>Completed Runs</td>
        <td>${runs.length}</td>
      </tr>
      <tr>
        <td>Total Queries</td>
        <td>${queries.length}</td>
      </tr>
      <tr>
        <td>Total Recommendations</td>
        <td>${recommendationSummary.total}</td>
      </tr>
      <tr>
        <td>Total Citations</td>
        <td>${citationSummary.total}</td>
      </tr>
      <tr>
        <td>Aggregation Policy</td>
        <td>Median across repeated runs per query</td>
      </tr>
    </tbody>
  </table>
  ` : ''}

  <div class="footer">
    <p><strong>P11 PropertyAudit</strong></p>
    <p>Generative Engine Optimization (GEO) Report</p>
    <p>Generated on ${generatedDate}</p>
    <p style="margin-top: 1rem;">
      This report contains proprietary analysis. For questions, contact your P11 team.
    </p>
  </div>

  <div class="no-print" style="position: fixed; bottom: 2rem; right: 2rem;">
    <button 
      onclick="window.print()" 
      style="background: #6366f1; color: white; padding: 1rem 2rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"
    >
      Print to PDF
    </button>
  </div>
</body>
</html>
  `.trim()
}

function getScoreBucket(score: number | undefined): string {
  if (!score) return ''
  if (score >= 75) return '(Excellent)'
  if (score >= 50) return '(Good)'
  if (score >= 25) return '(Fair)'
  return '(Needs Improvement)'
}

function getRecommendationWorkstream(rec: ReportRecommendation): RecommendationWorkstream {
  if (rec.type === 'citation_opportunity' || rec.accessLevel === 'ThirdParty') {
    return 'Citation Targets'
  }
  if (rec.accessLevel === 'CodeRequired' || /schema|robots|sitemap|llms\.txt/i.test(rec.keywords.join(' '))) {
    return 'Entity / Technical Fixes'
  }
  if (rec.type === 'content_gap' || rec.type === 'rank_improvement') {
    return 'Competitive Plays'
  }
  return 'Owned Content'
}

function groupRecommendationsByWorkstream(recommendations: ReportRecommendation[]): Record<RecommendationWorkstream, ReportRecommendation[]> {
  const groups: Record<RecommendationWorkstream, ReportRecommendation[]> = {
    'Owned Content': [],
    'Citation Targets': [],
    'Entity / Technical Fixes': [],
    'Competitive Plays': [],
  }

  recommendations.forEach(rec => {
    groups[getRecommendationWorkstream(rec)].push(rec)
  })

  return groups
}

function getWorkstreamDescription(workstream: RecommendationWorkstream): string {
  switch (workstream) {
    case 'Owned Content':
      return 'Pages, FAQs, answer blocks, and content updates the client can usually control directly.'
    case 'Citation Targets':
      return 'Third-party directories, list pages, PR, or partner placements that influence AI citations.'
    case 'Entity / Technical Fixes':
      return 'Structured data, crawlability, metadata, and entity-consistency changes that may require CMS or code access.'
    case 'Competitive Plays':
      return 'Prompt clusters where competitors are appearing more strongly and the client needs counter-positioning.'
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatShortDate(dateValue?: string | null): string {
  if (!dateValue) return '—'
  const date = new Date(dateValue)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatNarrative(input: string): string {
  const escaped = escapeHtml(input)
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const withItalics = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return withItalics.replace(/\n/g, '<br/>')
}
