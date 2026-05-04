/**
 * PropertyAudit Export API
 * Exports markdown and print-view artifacts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { buildCharts, buildRunReportData } from '@/utils/propertyaudit/reporting'
import type { ReportAnswer } from '@/utils/propertyaudit/reporting'

type RunReportData = Awaited<ReturnType<typeof buildRunReportData>>
type ReportRecommendation = NonNullable<RunReportData>['recommendations'][number]
type RecommendationWorkstream = 'Owned Content' | 'Citation Targets' | 'Entity / Technical Fixes' | 'Competitive Plays'

type ReportingClient = {
  from: (table: string) => unknown
  rpc: (fn: string, args: Record<string, unknown>) => unknown
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const runId = searchParams.get('runId')
    const requestedFormat = searchParams.get('format') || 'markdown'

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    if (requestedFormat !== 'markdown' && requestedFormat !== 'html' && requestedFormat !== 'pdf') {
      return NextResponse.json(
        { error: 'Invalid format. Allowed values: markdown, html, pdf' },
        { status: 400 }
      )
    }
    const resolvedFormat = requestedFormat === 'pdf' ? 'html' : requestedFormat

    const serviceClient = createServiceClient()
    const { data: run, error: runError } = await serviceClient
      .from('geo_runs')
      .select('property_id, status')
      .eq('id', runId)
      .single()

    if (runError || !run?.property_id) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, run.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (run.status !== 'completed') {
      return NextResponse.json(
        {
          error: 'Export requires a completed run',
          currentStatus: run.status,
        },
        { status: 409 }
      )
    }

    const reportData = await buildRunReportData(
      serviceClient as unknown as ReportingClient,
      runId
    )
    if (!reportData) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    if (resolvedFormat === 'markdown') {
      const markdown = generateMarkdown(reportData)
      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="geo_visibility_report_${runId}.md"`,
          'X-PropertyAudit-Artifact-Format': 'markdown',
        }
      })
    }

    const html = generateHTML(reportData)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="geo_visibility_report_${runId}.html"`,
        'X-PropertyAudit-Artifact-Format': requestedFormat === 'pdf' ? 'pdf_print_view' : 'html',
      }
    })
  } catch (error) {
    console.error('PropertyAudit Export Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function generateMarkdown(data: Awaited<ReturnType<typeof buildRunReportData>>): string {
  if (!data) return ''
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
    scores,
    answers,
    recommendations,
    recommendationSummary,
    queryTypeStats,
    citationSummary,
    glossary,
    insights,
    narrative,
    aiOverviewSummary
  } = data

  const run = runs[0]
  const score = scores[0]
  const bestSurface = [...surfaceSummaries]
    .filter(surface => typeof surface.overallScore === 'number')
    .sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0))[0]
  const weakestSurface = [...surfaceSummaries]
    .filter(surface => typeof surface.overallScore === 'number')
    .sort((a, b) => (a.overallScore || 0) - (b.overallScore || 0))[0]
  const weakestType = [...queryTypeStats].sort((a, b) => a.presencePct - b.presencePct)[0]
  const groupedRecommendations = groupRecommendationsByWorkstream(recommendations)
  const lines: string[] = []
  
  lines.push(`# GEO Visibility Report`)
  lines.push(``)
  lines.push(`**Property:** ${property?.name || 'Unknown'}`)
  lines.push(`**Surface:** ${run?.surface?.toUpperCase() || 'N/A'}`)
  lines.push(`**Model:** ${run?.model_name || 'N/A'}`)
  lines.push(`**Date:** ${run?.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}`)
  lines.push(``)
  if (surfaceSummaries.length > 0) {
    lines.push(`## Measurement Notes`)
    surfaceSummaries.forEach(summary => {
      lines.push(`- **${summary.label}:** ${summary.measurementNote}`)
    })
    lines.push(``)
  }
  
  if (score) {
    lines.push(`## Executive Snapshot`)
    lines.push(``)
    lines.push(`- **Overall AI visibility score:** ${score.overall_score.toFixed(1)}/100`)
    lines.push(`- **Visibility:** ${score.visibility_pct.toFixed(1)}%`)
    lines.push(`- **Avg LLM Rank:** ${score.avg_llm_rank?.toFixed(1) ?? 'N/A'}`)
    lines.push(`- **Avg Link Rank:** ${score.avg_link_rank?.toFixed(1) ?? 'N/A'}`)
    lines.push(`- **Avg SOV:** ${score.avg_sov ? (score.avg_sov * 100).toFixed(1) + '%' : 'N/A'}`)
    lines.push(`- **Best surface:** ${bestSurface ? `${bestSurface.label} (${bestSurface.overallScore?.toFixed(1)}/100)` : 'More run data needed'}`)
    lines.push(`- **Weakest surface:** ${weakestSurface ? `${weakestSurface.label} (${weakestSurface.overallScore?.toFixed(1)}/100)` : 'More run data needed'}`)
    lines.push(`- **Weakest prompt cluster:** ${weakestType ? `${weakestType.type} (${weakestType.presencePct}% presence)` : 'More query data needed'}`)
    lines.push(``)
    lines.push(`### Score Breakdown`)
    lines.push(``)
    if (score.breakdown) {
      lines.push(`- Position (45%): ${score.breakdown.position.toFixed(0)}`)
      lines.push(`- Link (25%): ${score.breakdown.link.toFixed(0)}`)
      lines.push(`- SOV (20%): ${score.breakdown.sov.toFixed(0)}`)
      lines.push(`- Accuracy (10%): ${score.breakdown.accuracy.toFixed(0)}`)
    }
    lines.push(``)
  }

  lines.push(`## Executive Narrative`)
  if (narrative) {
    lines.push(narrative)
  } else {
    lines.push(...insights.highlights.map(item => `- ${item}`))
  }
  lines.push(``)

  lines.push(`## Recommendations Summary`)
  lines.push(`- High priority: ${recommendationSummary.high}`)
  lines.push(`- Medium priority: ${recommendationSummary.medium}`)
  lines.push(`- Low priority: ${recommendationSummary.low}`)
  lines.push(``)

  lines.push(`## Methodology & Confidence`)
  lines.push(`PropertyAudit uses API-first grounded proxies, natural answer capture, structured extraction, and repeated-run aggregation. Results are directional AI visibility evidence, not exact browser-surface capture.`)
  lines.push(``)
  lines.push(`Sample size: ${answers.length} aggregated prompt results across ${runs.length} completed run${runs.length === 1 ? '' : 's'}.`)
  lines.push(``)

  lines.push(`## 30/60-Day Action Plan`)
  lines.push(`- **Next 30 days:** Complete high-priority URL-only, CMS/editor, and citation-target actions tied to missing visibility.`)
  lines.push(`- **Next 60 days:** Re-run monitored money prompts, compare surface drift, and refresh recommendations that remain open.`)
  lines.push(``)

  lines.push(`## AI Overviews Visibility`)
  lines.push(`- Visible in AI Overviews: ${aiOverviewSummary.visibleCount}/${aiOverviewSummary.totalTracked} (${aiOverviewSummary.visibilityPct}%)`)
  aiOverviewSummary.byType.forEach(entry => {
    lines.push(`- ${entry.type}: ${entry.visiblePct}%`)
  })
  lines.push(``)

  lines.push(`## Action Plan (${recommendationSummary.total})`)
  ;(Object.entries(groupedRecommendations) as Array<[RecommendationWorkstream, ReportRecommendation[]]>).forEach(([workstream, recs]) => {
    lines.push(`### ${workstream}`)
    lines.push(getWorkstreamDescription(workstream))
    lines.push(``)
    if (recs.length === 0) {
      lines.push(`No recommendations in this workstream for this report.`)
      lines.push(``)
      return
    }
    recs.forEach((rec, idx) => {
      lines.push(`#### ${idx + 1}. ${rec.title}`)
      lines.push(`- **Priority:** ${rec.priority}`)
      lines.push(`- **Impact:** ${rec.impact.score}/100`)
      lines.push(`- **Access Level:** ${rec.accessLevel || 'URLOnly'}`)
      lines.push(`- **Owner:** ${rec.owner || 'seo'}`)
      lines.push(`- **Status:** ${rec.status || 'todo'}`)
      lines.push(`- **Evidence Mode:** ${rec.evidenceMode || 'URLOnly'}`)
      if (rec.targetPageType) lines.push(`- **Target Page Type:** ${rec.targetPageType}`)
      if (rec.targetUrl) lines.push(`- **Target URL:** ${rec.targetUrl}`)
      lines.push(`- **Description:** ${rec.description}`)
      if (rec.evidence?.length) {
        lines.push(`- **Evidence:**`)
        rec.evidence.forEach(item => lines.push(`  - ${item}`))
      }
      if (rec.sourceQueryEvidence?.length) {
        lines.push(`- **GEO Query Evidence:**`)
        rec.sourceQueryEvidence.forEach(item => lines.push(`  - ${item}`))
      }
      if (rec.missingSignals?.length) {
        lines.push(`- **Missing Signals:** ${rec.missingSignals.join(', ')}`)
      }
      if (rec.implementationSteps?.length) {
        lines.push(`- **Implementation Steps:**`)
        rec.implementationSteps.forEach(item => lines.push(`  - ${item}`))
      }
      if (rec.acceptanceCriteria?.length) {
        lines.push(`- **Acceptance Criteria:**`)
        rec.acceptanceCriteria.forEach(item => lines.push(`  - ${item}`))
      }
      if (rec.actionItems?.length) {
        lines.push(`- **Action Items:**`)
        rec.actionItems.forEach(item => lines.push(`  - ${item}`))
      }
      lines.push(``)
    })
  })

  lines.push(`## Query Type Coverage`)
  queryTypeStats.forEach(stat => {
    const avgSovLabel = stat.avgSov === null ? 'N/A' : `${Math.round(stat.avgSov * 100)}%`
    lines.push(`- ${stat.type}: ${stat.presencePct}% presence, ${stat.total} queries, avg SOV ${avgSovLabel}`)
  })
  lines.push(``)

  lines.push(`## Query Results (${answers.length})`)
  lines.push(``)
  
  answers.forEach((answer, idx) => {
    const query = answer.geo_queries
    lines.push(`### ${idx + 1}. ${query?.text}`)
    lines.push(``)
    lines.push(`- **Type:** ${query?.type}`)
    const presenceRate = typeof answer.presence_rate === 'number' ? Math.round(answer.presence_rate * 100) : (answer.presence ? 100 : 0)
    lines.push(`- **Presence:** ${answer.presence ? '✓' : '✗'} (${presenceRate}%)`)
    lines.push(`- **LLM Rank:** ${answer.llm_rank ?? 'N/A'}`)
    lines.push(`- **Link Rank:** ${answer.link_rank ?? 'N/A'}`)
    lines.push(`- **SOV:** ${answer.sov === null ? 'N/A' : ((answer.sov || 0) * 100).toFixed(1) + '%'}`)
    if (answer.analysis_method) {
      lines.push(`- **Analysis Method:** ${answer.analysis_method}`)
    }
    lines.push(``)
    if (answer.natural_response) {
      lines.push(`**Natural Response (What Users See):**`)
      lines.push(``)
      lines.push(answer.natural_response)
      lines.push(``)
    }
    lines.push(`**Answer:** ${answer.answer_summary || '—'}`)
    lines.push(``)
    
    if (answer.ordered_entities && answer.ordered_entities.length > 0) {
      lines.push(`**Entities:**`)
      answer.ordered_entities.forEach((entity) => {
        lines.push(`- ${entity.position}. ${entity.name} (${entity.domain})`)
      })
      lines.push(``)
    }
    
    if (answer.geo_citations && answer.geo_citations.length > 0) {
      lines.push(`**Citations:**`)
      answer.geo_citations.forEach((citation, i: number) => {
        const brandTag = citation.is_brand_domain ? ' 🏷️' : ''
        lines.push(`${i + 1}. ${citation.domain}${brandTag}`)
        lines.push(`   ${citation.url}`)
      })
      lines.push(``)
    }
    
    lines.push(`---`)
    lines.push(``)
  })

  lines.push(`## Metrics Glossary`)
  glossary.forEach(entry => {
    lines.push(`- **${entry.term}:** ${entry.definition}${entry.formula ? ` (${entry.formula})` : ''}`)
  })
  lines.push(``)

  lines.push(`## Data Appendix`)
  lines.push(`- Total Citations: ${citationSummary.total}`)
  lines.push(`- Brand Citation Share: ${citationSummary.brandPct}%`)
  lines.push(`- Homepage Reachable: ${siteAudit.homepageReachable ? 'Yes' : 'No'}`)
  lines.push(`- robots.txt Reachable: ${siteAudit.robotsTxtReachable ? 'Yes' : 'No'}`)
  lines.push(`- sitemap.xml Reachable: ${siteAudit.sitemapReachable ? 'Yes' : 'No'}`)
  lines.push(`- llms.txt Reachable: ${siteAudit.llmsTxtReachable ? 'Yes' : 'No'}`)
  if (siteAudit.crawlSummary) {
    lines.push(`- Pages Audited: ${siteAudit.crawlSummary.pagesAudited}/${siteAudit.crawlSummary.pagesAttempted}`)
    lines.push(`- Discovery Sources: ${siteAudit.crawlSummary.discoverySources.join(', ')}`)
  }
  if (siteAudit.pages?.length) {
    lines.push(`- Page Inventory:`)
    siteAudit.pages
      .filter(page => page.reachable)
      .slice(0, 10)
      .forEach(page => {
        lines.push(`  - ${page.pageType}: ${page.url} (${page.wordCount} words, ${page.structuredDataTypes.length || 0} schema type(s), ${page.answerBlockSignals} answer signals)`)
      })
  }
  if (siteAudit.notes.length > 0) {
    lines.push(`- Technical Notes:`)
    siteAudit.notes.forEach(note => lines.push(`  - ${note}`))
  }
  lines.push(``)
  lines.push(`## URL-Only Readiness Note`)
  lines.push(`This section is based on public website signals. Code access is not required for diagnosis, but CMS/editor or engineering access may be needed to implement some fixes.`)

  return lines.join('\n')
}

function generateHTML(data: Awaited<ReturnType<typeof buildRunReportData>>): string {
  if (!data) return ''
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
    scores,
    answers,
    recommendations,
    recommendationSummary,
    queryTypeStats,
    citationSummary,
    glossary,
    insights,
    narrative,
    trends,
    competitors,
    aiOverviewSummary
  } = data

  const charts = buildCharts({
    trends,
    queryTypeStats,
    recommendationSummary,
    competitors
  })

  const run = runs[0]
  const score = scores[0]
  const groupedRecommendations = groupRecommendationsByWorkstream(recommendations)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GEO Visibility Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1f2937; }
    h1 { color: #1f2937; border-bottom: 3px solid #6366f1; padding-bottom: 10px; }
    h2 { color: #374151; margin-top: 30px; }
    h3 { color: #4b5563; margin-top: 20px; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; padding: 10px 15px; background: #f3f4f6; border-radius: 8px; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .metric-value { font-size: 24px; font-weight: bold; color: #1f2937; }
    .query-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin: 15px 0; }
    .entity { padding: 10px; background: white; border: 1px solid #e5e7eb; border-radius: 6px; margin: 8px 0; }
    .citation { padding: 8px; background: white; border-left: 3px solid #d1d5db; margin: 5px 0; font-size: 14px; }
    .brand-citation { border-left-color: #10b981; background: #f0fdf4; }
    .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 20px 0; }
    .chart-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
    .recommendation-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 12px 0; }
    svg { max-width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <h1>GEO Visibility Report</h1>
  <p><strong>Property:</strong> ${escapeHtml(property?.name || 'Unknown')}</p>
  <p><strong>Surface:</strong> ${escapeHtml(run?.surface?.toUpperCase() || 'N/A')}</p>
  <p><strong>Model:</strong> ${escapeHtml(run?.model_name || 'N/A')}</p>
  <p><strong>Date:</strong> ${run?.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}</p>
  ${surfaceSummaries.length > 0 ? `
    <h2>Measurement Notes</h2>
    <ul>
      ${surfaceSummaries.map(summary => `<li><strong>${escapeHtml(summary.label)}:</strong> ${escapeHtml(summary.measurementNote)}</li>`).join('')}
    </ul>
  ` : ''}
  
  ${score ? `
  <h2>Overall Score: ${score.overall_score.toFixed(1)}</h2>
  <div class="metric">
    <div class="metric-label">Visibility</div>
    <div class="metric-value">${score.visibility_pct.toFixed(1)}%</div>
  </div>
  <div class="metric">
    <div class="metric-label">Avg LLM Rank</div>
    <div class="metric-value">${score.avg_llm_rank?.toFixed(1) ?? 'N/A'}</div>
  </div>
  <div class="metric">
    <div class="metric-label">Avg SOV</div>
    <div class="metric-value">${score.avg_sov ? (score.avg_sov * 100).toFixed(1) + '%' : 'N/A'}</div>
  </div>
  ` : ''}

  <h2>Executive Narrative</h2>
  ${narrative ? `<p>${formatNarrative(narrative)}</p>` : `
    <ul>
      ${insights.highlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `}

  <h2>AI Overviews Visibility</h2>
  <p>Visible in AI Overviews for <strong>${aiOverviewSummary.visibleCount}</strong> of ${aiOverviewSummary.totalTracked} queries (${aiOverviewSummary.visibilityPct}%).</p>
  <ul>
    ${aiOverviewSummary.byType.map(entry => `<li>${escapeHtml(entry.type)}: ${entry.visiblePct}%</li>`).join('')}
  </ul>

  <h2>Score Trends</h2>
  <div class="chart-grid">
    <div class="chart-card">${charts.scoreTrend}</div>
    <div class="chart-card">${charts.visibilityTrend}</div>
  </div>

  <h2>Recommendations</h2>
  <p>${recommendationSummary.total} recommendations identified. High ${recommendationSummary.high}, Medium ${recommendationSummary.medium}, Low ${recommendationSummary.low}.</p>
  <h3>30/60-Day Action Plan</h3>
  <ul>
    <li><strong>Next 30 days:</strong> Complete high-priority URL-only, CMS/editor, and citation-target actions tied to missing visibility.</li>
    <li><strong>Next 60 days:</strong> Re-run monitored money prompts, compare surface drift, and refresh recommendations that remain open.</li>
  </ul>
  <div class="chart-grid">
    <div class="chart-card">${charts.recommendationBar}</div>
  </div>
  ${(Object.entries(groupedRecommendations) as Array<[RecommendationWorkstream, ReportRecommendation[]]>).map(([workstream, recs]) => `
    <h3>${escapeHtml(workstream)}</h3>
    <p>${escapeHtml(getWorkstreamDescription(workstream))}</p>
    ${recs.length === 0 ? '<p>No recommendations in this workstream for this report.</p>' : recs.map((rec, idx) => `
    <div class="recommendation-card">
      <h3>${idx + 1}. ${escapeHtml(rec.title)}</h3>
      <p><strong>Priority:</strong> ${escapeHtml(rec.priority)} | <strong>Impact:</strong> ${rec.impact.score}/100</p>
      <p><strong>Access Level:</strong> ${escapeHtml(rec.accessLevel || 'URLOnly')} | <strong>Owner:</strong> ${escapeHtml(rec.owner || 'seo')} | <strong>Status:</strong> ${escapeHtml(rec.status || 'todo')}</p>
      <p><strong>Evidence Mode:</strong> ${escapeHtml(rec.evidenceMode || 'URLOnly')}</p>
      ${rec.targetPageType ? `<p><strong>Target Page Type:</strong> ${escapeHtml(rec.targetPageType)}</p>` : ''}
      ${rec.targetUrl ? `<p><strong>Target URL:</strong> ${escapeHtml(rec.targetUrl)}</p>` : ''}
      <p>${escapeHtml(rec.description)}</p>
      ${rec.evidence?.length ? `
        <p><strong>Evidence:</strong></p>
        <ul>${rec.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      ` : ''}
      ${rec.sourceQueryEvidence?.length ? `
        <p><strong>GEO Query Evidence:</strong></p>
        <ul>${rec.sourceQueryEvidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      ` : ''}
      ${rec.missingSignals?.length ? `<p><strong>Missing Signals:</strong> ${escapeHtml(rec.missingSignals.join(', '))}</p>` : ''}
      ${rec.implementationSteps?.length ? `
        <p><strong>Implementation Steps:</strong></p>
        <ul>${rec.implementationSteps.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      ` : ''}
      ${rec.acceptanceCriteria?.length ? `
        <p><strong>Acceptance Criteria:</strong></p>
        <ul>${rec.acceptanceCriteria.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      ` : ''}
      ${rec.actionItems?.length ? `
        <ul>
          ${rec.actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
    `).join('')}
  `).join('')}

  <h2>Query Type Coverage</h2>
  <div class="chart-grid">
    <div class="chart-card">${charts.queryTypeBar}</div>
  </div>

  <h2>Query Results (${answers.length})</h2>
  ${answers.map((answer: ReportAnswer, idx: number) => {
    const query = answer.geo_queries
    return `
    <div class="query-card">
      <h3>${idx + 1}. ${escapeHtml(query?.text || '—')}</h3>
      <p><strong>Type:</strong> ${escapeHtml(query?.type || '—')} | <strong>Presence:</strong> ${answer.presence ? '✓' : '✗'} (${typeof answer.presence_rate === 'number' ? Math.round(answer.presence_rate * 100) : (answer.presence ? 100 : 0)}%) | <strong>LLM Rank:</strong> ${answer.llm_rank ?? 'N/A'}</p>
      ${answer.analysis_method ? `<p><strong>Analysis method:</strong> ${escapeHtml(answer.analysis_method)}</p>` : ''}
      ${answer.natural_response ? `
        <h4>Natural Response (What Users See):</h4>
        <div class="entity" style="white-space: pre-wrap;">${escapeHtml(answer.natural_response)}</div>
      ` : ''}
      <p>${escapeHtml(answer.answer_summary || '—')}</p>
      
      ${answer.ordered_entities && answer.ordered_entities.length > 0 ? `
        <h4>Entities:</h4>
        ${answer.ordered_entities.map((entity) => `
          <div class="entity">
            <strong>${entity.position}. ${escapeHtml(entity.name)}</strong> (${escapeHtml(entity.domain)})
            <p style="margin: 5px 0 0 0; font-size: 14px;">${escapeHtml(entity.rationale || '—')}</p>
          </div>
        `).join('')}
      ` : ''}
      
      ${answer.geo_citations && answer.geo_citations.length > 0 ? `
        <h4>Citations:</h4>
        ${answer.geo_citations.map((citation, i: number) => `
          <div class="citation ${citation.is_brand_domain ? 'brand-citation' : ''}">
            <strong>${i + 1}. ${escapeHtml(citation.domain)}</strong>${citation.is_brand_domain ? ' (Your Brand)' : ''}
            <br/><small>${escapeHtml(citation.url)}</small>
          </div>
        `).join('')}
      ` : ''}
    </div>
    `
  }).join('')}

  <h2>Metrics Glossary</h2>
  ${glossary.map(entry => `
    <div class="recommendation-card">
      <h3>${escapeHtml(entry.term)}</h3>
      <p>${escapeHtml(entry.definition)}</p>
      ${entry.formula ? `<p><strong>Formula:</strong> ${escapeHtml(entry.formula)}</p>` : ''}
      ${entry.interpretation ? `<p><strong>Interpretation:</strong> ${escapeHtml(entry.interpretation)}</p>` : ''}
    </div>
  `).join('')}

  <h2>Data Appendix</h2>
  <p>Total citations: ${citationSummary.total} | Brand share: ${citationSummary.brandPct}%</p>
  <p>Homepage reachable: ${siteAudit.homepageReachable ? 'Yes' : 'No'} | robots.txt: ${siteAudit.robotsTxtReachable ? 'Yes' : 'No'} | sitemap.xml: ${siteAudit.sitemapReachable ? 'Yes' : 'No'} | llms.txt: ${siteAudit.llmsTxtReachable ? 'Yes' : 'No'}</p>
  ${siteAudit.crawlSummary ? `<p>Pages audited: ${siteAudit.crawlSummary.pagesAudited}/${siteAudit.crawlSummary.pagesAttempted} | Discovery sources: ${siteAudit.crawlSummary.discoverySources.map(escapeHtml).join(', ')}</p>` : ''}
  ${siteAudit.pages?.length ? `
    <table class="query-table">
      <thead>
        <tr><th>Page Type</th><th>URL</th><th>Words</th><th>Schema</th><th>Answer Signals</th></tr>
      </thead>
      <tbody>
        ${siteAudit.pages.filter(page => page.reachable).slice(0, 10).map(page => `
          <tr>
            <td>${escapeHtml(page.pageType)}</td>
            <td>${escapeHtml(page.url)}</td>
            <td>${page.wordCount}</td>
            <td>${page.structuredDataTypes.length ? escapeHtml(page.structuredDataTypes.join(', ')) : 'None'}</td>
            <td>${page.answerBlockSignals}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}
  <p><strong>URL-only readiness note:</strong> This section is based on public website signals. Code access is not required for diagnosis, but CMS/editor or engineering access may be needed to implement some fixes.</p>
  ${siteAudit.notes.length > 0 ? `
    <ul>
      ${siteAudit.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
    </ul>
  ` : ''}
  <hr style="margin-top: 40px; border: none; border-top: 2px solid #e5e7eb;">
  <p style="text-align: center; color: #9ca3af; font-size: 12px;">Generated by P11 PropertyAudit</p>
</body>
</html>
  `.trim()
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

function formatNarrative(input: string): string {
  const escaped = escapeHtml(input)
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const withItalics = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return withItalics.replace(/\n/g, '<br/>')
}
