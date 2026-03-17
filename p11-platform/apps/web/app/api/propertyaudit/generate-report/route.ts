/**
 * PropertyAudit Report Generation API
 * Generates professional PDF reports with visualizations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { buildCharts, buildPropertyReportData, buildRunReportData } from '@/utils/propertyaudit/reporting'

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
    const { propertyId, runId, template, includeSections } = body

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

    if (runId) {
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
        'Content-Disposition': `inline; filename="GEO-Report-${propertyId}.html"`,
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
    queries,
    competitors,
    scores,
    recommendations,
    recommendationSummary,
    queryTypeStats,
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
  const sectionSet = new Set([...sections, 'recommendations', 'appendix'])
  const hasSection = (id: string) => sectionSet.has(id)

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
  <h2>Executive Summary</h2>
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
      <div class="metric-value">${latestScore?.avg_llm_rank?.toFixed(1) || 'N/A'}</div>
      <div class="metric-label">Avg Rank</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${queries?.length || 0}</div>
      <div class="metric-label">Queries Tracked</div>
    </div>
  </div>

  <h3>Key Findings</h3>
  <ul style="line-height: 1.8;">
    <li>Overall GEO score of <strong>${latestScore ? Math.round(latestScore.overall_score) : 'N/A'}/100</strong> ${getScoreBucket(latestScore?.overall_score)}</li>
    <li>Visibility at <strong>${latestScore ? Math.round(latestScore.visibility_pct) : 0}%</strong> across all tracked queries</li>
    <li>Average ranking position: <strong>#${latestScore?.avg_llm_rank?.toFixed(1) || 'N/A'}</strong></li>
    <li>${competitors.length > 0 ? `Primary competitor: <strong>${escapeHtml(competitors[0].name)}</strong> (${competitors[0].mentionCount} mentions)` : 'Competitive analysis in progress'}</li>
  </ul>

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
  <table class="query-table">
    <thead>
      <tr>
        <th>Run Date</th>
        <th>Surface</th>
        <th>Score</th>
        <th>Visibility</th>
        <th>Avg Rank</th>
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
  <h2>Model Comparison</h2>
  <table class="query-table">
    <thead>
      <tr>
        <th>Surface</th>
        <th>Latest Score</th>
        <th>Visibility</th>
        <th>Avg Rank</th>
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
      • <strong>Note:</strong> SOV only applies to category, comparison, and local queries. Branded and FAQ queries show "N/A" for SOV.
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
          <td>${stat.avgRank?.toFixed(1) || '—'}</td>
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
  <h2>Actionable Recommendations</h2>
  <p style="color: #6b7280; margin-bottom: 1.5rem;">
    ${recommendationSummary.total} recommendations identified. Priorities: ${recommendationSummary.high} high, ${recommendationSummary.medium} medium, ${recommendationSummary.low} low.
  </p>
  <div class="chart-grid">
    <div class="chart-card">${charts.recommendationBar}</div>
  </div>
  ${recommendations.map((rec, index) => `
    <div class="recommendation-card">
      <h3 style="margin-top: 0;">${index + 1}. ${escapeHtml(rec.title)}</h3>
      <p><strong>Priority:</strong> ${escapeHtml(rec.priority)} | <strong>Impact:</strong> ${rec.impact.score}/100</p>
      <p>${escapeHtml(rec.description)}</p>
      ${rec.modelBreakdown ? `
        <p><strong>Model Impact:</strong>
          ${rec.modelBreakdown.affectedModels?.length ? rec.modelBreakdown.affectedModels.map(m => m.toUpperCase()).join(', ') : '—'}
        </p>
      ` : ''}
      ${rec.competitorContext ? `
        <p><strong>Competitor Context:</strong> ${escapeHtml(rec.competitorContext.competitorName)} (${escapeHtml(rec.competitorContext.competitorDomain)})</p>
      ` : ''}
      ${rec.actionItems?.length ? `
        <ul>
          ${rec.actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${rec.relatedQueries?.length ? `
        <p><strong>Related Queries:</strong> ${rec.relatedQueries.map(q => escapeHtml(q.text)).join(', ')}</p>
      ` : ''}
    </div>
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

  ${hasSection('appendix') ? `
  <h2>Metrics Glossary & Methodology</h2>
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
