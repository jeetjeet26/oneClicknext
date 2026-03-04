/**
 * PropertyAudit Export API
 * Generate PDF/Markdown reports
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildCharts, buildRunReportData } from '@/utils/propertyaudit/reporting'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const runId = searchParams.get('runId')
    const format = searchParams.get('format') || 'markdown'

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    const reportData = await buildRunReportData(supabase, runId)
    if (!reportData) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    if (format === 'markdown') {
      const markdown = generateMarkdown(reportData)
      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="geo_report_${runId}.md"`
        }
      })
    }

    const html = generateHTML(reportData)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="geo_report_${runId}.html"`
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
  const lines: string[] = []
  
  lines.push(`# GEO Audit Report`)
  lines.push(``)
  lines.push(`**Property:** ${property?.name || 'Unknown'}`)
  lines.push(`**Surface:** ${run?.surface?.toUpperCase() || 'N/A'}`)
  lines.push(`**Model:** ${run?.model_name || 'N/A'}`)
  lines.push(`**Date:** ${run?.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}`)
  lines.push(``)
  
  if (score) {
    lines.push(`## Overall Score: ${score.overall_score.toFixed(1)}`)
    lines.push(``)
    lines.push(`- **Visibility:** ${score.visibility_pct.toFixed(1)}%`)
    lines.push(`- **Avg LLM Rank:** ${score.avg_llm_rank?.toFixed(1) ?? 'N/A'}`)
    lines.push(`- **Avg Link Rank:** ${score.avg_link_rank?.toFixed(1) ?? 'N/A'}`)
    lines.push(`- **Avg SOV:** ${score.avg_sov ? (score.avg_sov * 100).toFixed(1) + '%' : 'N/A'}`)
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

  lines.push(`## AI Overviews Visibility`)
  lines.push(`- Visible in AI Overviews: ${aiOverviewSummary.visibleCount}/${aiOverviewSummary.totalTracked} (${aiOverviewSummary.visibilityPct}%)`)
  aiOverviewSummary.byType.forEach(entry => {
    lines.push(`- ${entry.type}: ${entry.visiblePct}%`)
  })
  lines.push(``)

  lines.push(`## Recommendations (${recommendationSummary.total})`)
  recommendations.forEach((rec, idx) => {
    lines.push(`### ${idx + 1}. ${rec.title}`)
    lines.push(`- **Priority:** ${rec.priority}`)
    lines.push(`- **Impact:** ${rec.impact.score}/100`)
    lines.push(`- **Description:** ${rec.description}`)
    if (rec.actionItems?.length) {
      lines.push(`- **Action Items:**`)
      rec.actionItems.forEach(item => lines.push(`  - ${item}`))
    }
    lines.push(``)
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
      answer.ordered_entities.forEach((entity: any) => {
        lines.push(`- ${entity.position}. ${entity.name} (${entity.domain})`)
      })
      lines.push(``)
    }
    
    if (answer.geo_citations && answer.geo_citations.length > 0) {
      lines.push(`**Citations:**`)
      answer.geo_citations.forEach((citation: any, i: number) => {
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

  return lines.join('\n')
}

function generateHTML(data: Awaited<ReturnType<typeof buildRunReportData>>): string {
  if (!data) return ''
  const {
    property,
    runs,
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
    competitors
  } = data

  const charts = buildCharts({
    trends,
    queryTypeStats,
    recommendationSummary,
    competitors
  })

  const run = runs[0]
  const score = scores[0]

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GEO Audit Report</title>
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
  <h1>GEO Audit Report</h1>
  <p><strong>Property:</strong> ${escapeHtml(property?.name || 'Unknown')}</p>
  <p><strong>Surface:</strong> ${escapeHtml(run?.surface?.toUpperCase() || 'N/A')}</p>
  <p><strong>Model:</strong> ${escapeHtml(run?.model_name || 'N/A')}</p>
  <p><strong>Date:</strong> ${run?.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}</p>
  
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
  <div class="chart-grid">
    <div class="chart-card">${charts.recommendationBar}</div>
  </div>
  ${recommendations.map((rec, idx) => `
    <div class="recommendation-card">
      <h3>${idx + 1}. ${escapeHtml(rec.title)}</h3>
      <p><strong>Priority:</strong> ${escapeHtml(rec.priority)} | <strong>Impact:</strong> ${rec.impact.score}/100</p>
      <p>${escapeHtml(rec.description)}</p>
      ${rec.actionItems?.length ? `
        <ul>
          ${rec.actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `).join('')}

  <h2>Query Type Coverage</h2>
  <div class="chart-grid">
    <div class="chart-card">${charts.queryTypeBar}</div>
  </div>

  <h2>Query Results (${answers.length})</h2>
  ${answers.map((answer: any, idx: number) => {
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
        ${answer.ordered_entities.map((entity: any) => `
          <div class="entity">
            <strong>${entity.position}. ${escapeHtml(entity.name)}</strong> (${escapeHtml(entity.domain)})
            <p style="margin: 5px 0 0 0; font-size: 14px;">${escapeHtml(entity.rationale || '—')}</p>
          </div>
        `).join('')}
      ` : ''}
      
      ${answer.geo_citations && answer.geo_citations.length > 0 ? `
        <h4>Citations:</h4>
        ${answer.geo_citations.map((citation: any, i: number) => `
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
  <hr style="margin-top: 40px; border: none; border-top: 2px solid #e5e7eb;">
  <p style="text-align: center; color: #9ca3af; font-size: 12px;">Generated by P11 PropertyAudit</p>
</body>
</html>
  `.trim()
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
