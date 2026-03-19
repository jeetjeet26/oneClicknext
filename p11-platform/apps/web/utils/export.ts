/**
 * Export utilities for generating CSV and PDF reports
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { getMarketingChannelLabel } from '@/utils/analytics/channel-identity'

// Types for export data
export type ExportMetric = {
  label: string
  value: string | number
  change?: number | null
}

export type ExportTimeSeriesRow = {
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

export type ExportChannelRow = {
  channel: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpa: number
}

export type ExportCampaignRow = {
  campaign_name: string
  channel: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
}

export type ExportData = {
  propertyName: string
  dateRange: {
    start: string
    end: string
  }
  metrics: ExportMetric[]
  timeSeries?: ExportTimeSeriesRow[]
  channels?: ExportChannelRow[]
  campaigns?: ExportCampaignRow[]
}

// Helper to format currency
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Helper to format numbers with commas
const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value)
}

// Helper to format percentage
const formatPercent = (value: number): string => {
  return `${value.toFixed(2)}%`
}

// Helper to format channel names nicely
const formatChannelName = (channel: string): string => getMarketingChannelLabel(channel)

/**
 * Generate CSV content from export data
 */
export function generateCSV(data: ExportData): string {
  const lines: string[] = []
  
  // Header info
  lines.push(`"P11 Platform - Marketing Performance Report"`)
  lines.push(`"Property:","${data.propertyName}"`)
  lines.push(`"Date Range:","${data.dateRange.start} to ${data.dateRange.end}"`)
  lines.push(`"Generated:","${format(new Date(), 'MMM d, yyyy h:mm a')}"`)
  lines.push('')
  
  // Summary Metrics
  lines.push('"SUMMARY METRICS"')
  lines.push('"Metric","Value","Change vs Previous Period"')
  data.metrics.forEach(metric => {
    const changeStr = metric.change !== null && metric.change !== undefined 
      ? `${metric.change >= 0 ? '+' : ''}${metric.change.toFixed(1)}%`
      : 'N/A'
    lines.push(`"${metric.label}","${metric.value}","${changeStr}"`)
  })
  lines.push('')
  
  // Channel Breakdown
  if (data.channels && data.channels.length > 0) {
    lines.push('"CHANNEL BREAKDOWN"')
    lines.push('"Channel","Impressions","Clicks","Spend","Conversions","CTR","CPA"')
    data.channels.forEach(channel => {
      lines.push(`"${formatChannelName(channel.channel)}","${formatNumber(channel.impressions)}","${formatNumber(channel.clicks)}","${formatCurrency(channel.spend)}","${formatNumber(channel.conversions)}","${formatPercent(channel.ctr)}","${formatCurrency(channel.cpa)}"`)
    })
    lines.push('')
  }
  
  // Campaign Breakdown
  if (data.campaigns && data.campaigns.length > 0) {
    lines.push('"CAMPAIGN BREAKDOWN"')
    lines.push('"Campaign","Channel","Impressions","Clicks","Spend","Conversions","CTR","CPC","CPA"')
    data.campaigns.forEach(campaign => {
      lines.push(`"${campaign.campaign_name}","${formatChannelName(campaign.channel)}","${formatNumber(campaign.impressions)}","${formatNumber(campaign.clicks)}","${formatCurrency(campaign.spend)}","${formatNumber(campaign.conversions)}","${formatPercent(campaign.ctr)}","${formatCurrency(campaign.cpc)}","${formatCurrency(campaign.cpa)}"`)
    })
    lines.push('')
  }
  
  // Daily Performance
  if (data.timeSeries && data.timeSeries.length > 0) {
    lines.push('"DAILY PERFORMANCE"')
    lines.push('"Date","Impressions","Clicks","Spend","Conversions"')
    data.timeSeries.forEach(row => {
      lines.push(`"${row.date}","${formatNumber(row.impressions)}","${formatNumber(row.clicks)}","${formatCurrency(row.spend)}","${formatNumber(row.conversions)}"`)
    })
  }
  
  return lines.join('\n')
}

/**
 * Download CSV file
 */
export function downloadCSV(data: ExportData, filename?: string): void {
  const csv = generateCSV(data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename || `${data.propertyName.replace(/\s+/g, '_')}_Report_${format(new Date(), 'yyyy-MM-dd')}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Generate PDF report
 */
export function generatePDF(data: ExportData): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.width
  let yPos = 20
  
  // Brand colors
  const primaryColor: [number, number, number] = [99, 102, 241] // indigo-500
  const textColor: [number, number, number] = [30, 41, 59] // slate-800
  const mutedColor: [number, number, number] = [100, 116, 139] // slate-500
  
  // Header with brand styling
  doc.setFillColor(...primaryColor)
  doc.rect(0, 0, pageWidth, 35, 'F')
  
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('Marketing Performance Report', 14, 16)
  
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${data.propertyName}`, 14, 25)
  doc.text(`${data.dateRange.start} — ${data.dateRange.end}`, 14, 31)
  
  // Generated timestamp (right aligned)
  doc.setFontSize(9)
  doc.text(`Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}`, pageWidth - 14, 31, { align: 'right' })
  
  yPos = 45
  
  // Summary Metrics Section
  doc.setTextColor(...textColor)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary Metrics', 14, yPos)
  yPos += 8
  
  // Metrics in a 2x2 grid style
  const metricsPerRow = 2
  const metricBoxWidth = (pageWidth - 28) / metricsPerRow
  const metricBoxHeight = 25
  
  data.metrics.forEach((metric, index) => {
    const row = Math.floor(index / metricsPerRow)
    const col = index % metricsPerRow
    const x = 14 + (col * metricBoxWidth)
    const y = yPos + (row * metricBoxHeight)
    
    // Metric box background
    doc.setFillColor(248, 250, 252) // slate-50
    doc.roundedRect(x, y, metricBoxWidth - 4, metricBoxHeight - 4, 2, 2, 'F')
    
    // Metric label
    doc.setTextColor(...mutedColor)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(metric.label, x + 4, y + 7)
    
    // Metric value
    doc.setTextColor(...textColor)
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(String(metric.value), x + 4, y + 17)
    
    // Change indicator
    if (metric.change !== null && metric.change !== undefined) {
      const changeText = `${metric.change >= 0 ? '↑' : '↓'} ${Math.abs(metric.change).toFixed(1)}%`
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(metric.change >= 0 ? 16 : 220, metric.change >= 0 ? 185 : 38, metric.change >= 0 ? 129 : 38)
      doc.text(changeText, x + metricBoxWidth - 24, y + 17)
    }
  })
  
  yPos += Math.ceil(data.metrics.length / metricsPerRow) * metricBoxHeight + 10
  
  // Channel Breakdown Table
  if (data.channels && data.channels.length > 0) {
    doc.setTextColor(...textColor)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Channel Breakdown', 14, yPos)
    yPos += 4
    
    autoTable(doc, {
      startY: yPos,
      head: [['Channel', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'CTR', 'CPA']],
      body: data.channels.map(channel => [
        formatChannelName(channel.channel),
        formatNumber(channel.impressions),
        formatNumber(channel.clicks),
        formatCurrency(channel.spend),
        formatNumber(channel.conversions),
        formatPercent(channel.ctr),
        formatCurrency(channel.cpa),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 9,
        textColor: textColor,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      margin: { left: 14, right: 14 },
    })
    
    yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15
  }
  
  // Campaign Breakdown Table (if present and fits)
  if (data.campaigns && data.campaigns.length > 0) {
    // Check if we need a new page
    if (yPos > 200) {
      doc.addPage()
      yPos = 20
    }
    
    doc.setTextColor(...textColor)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Campaign Breakdown', 14, yPos)
    yPos += 4
    
    autoTable(doc, {
      startY: yPos,
      head: [['Campaign', 'Channel', 'Spend', 'Clicks', 'Conv.', 'CTR', 'CPA']],
      body: data.campaigns.slice(0, 15).map(campaign => [ // Limit to 15 campaigns for space
        campaign.campaign_name.length > 30 
          ? campaign.campaign_name.substring(0, 30) + '...' 
          : campaign.campaign_name,
        formatChannelName(campaign.channel),
        formatCurrency(campaign.spend),
        formatNumber(campaign.clicks),
        formatNumber(campaign.conversions),
        formatPercent(campaign.ctr),
        formatCurrency(campaign.cpa),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: textColor,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 55 },
      },
      margin: { left: 14, right: 14 },
    })
    
    if (data.campaigns.length > 15) {
      yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
      doc.setFontSize(8)
      doc.setTextColor(...mutedColor)
      doc.text(`Showing 15 of ${data.campaigns.length} campaigns. Export to CSV for complete data.`, 14, yPos)
    }
  }
  
  // Footer on each page
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(...mutedColor)
    doc.text(`P11 Platform • Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.height - 10, { align: 'center' })
  }
  
  return doc
}

/**
 * Download PDF report
 */
export function downloadPDF(data: ExportData, filename?: string): void {
  const doc = generatePDF(data)
  doc.save(filename || `${data.propertyName.replace(/\s+/g, '_')}_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}

