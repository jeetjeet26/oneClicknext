import { formatConversions } from '@/utils/analytics/marketing-fact'
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
  spend: number | null
  conversions: number
}

export type ExportChannelRow = {
  channel: string
  impressions: number
  clicks: number
  spend: number | null
  conversions: number
  ctr: number | null
  cpa: number | null
}

export type ExportCampaignRow = {
  source_account_id?: string | null
  campaign_id?: string
  campaign_name: string
  channel: string
  impressions: number
  clicks: number
  spend: number | null
  conversions: number
  ctr: number | null
  cpc: number | null
  cpa: number | null
}

export type ExportData = {
  reportId?: string
  sourceHash?: string
  generatedAt?: string
  notes?: string[]
  sourceCoverage?: Array<{channel:string;account:string;records:number;days:number;firstDate:string;lastDate:string;currency:string}>
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
const formatCurrency = (value: number | null): string => {
  if(value===null)return "Not available"
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
const formatPercent = (value: number | null): string => {
  if(value===null)return "Not available"
  return `${value.toFixed(2)}%`
}

// Helper to format channel names nicely
const formatChannelName = (channel: string): string => getMarketingChannelLabel(channel)

/**
 * Generate CSV content from export data
 */
export function csvCell(value:unknown):string{
 let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text
 return '"'+text.replaceAll('"','""')+'"'
}
export function generateCSV(data:ExportData):string{
 const rows:unknown[][]=[['P11 Platform - Marketing Performance Report'],['Property',data.propertyName],['Date range',data.dateRange.start+' to '+data.dateRange.end],[data.generatedAt?'Saved at':'Generated at',data.generatedAt||new Date().toISOString()]]
 if(data.reportId)rows.push(['Saved report ID',data.reportId]);if(data.sourceHash)rows.push(['Source identity',data.sourceHash]);for(const note of data.notes||[])rows.push(['Report note',note])
 rows.push([],['SUMMARY METRICS'],['Metric','Value','Change vs previous period'])
 for(const m of data.metrics)rows.push([m.label,m.value,m.change===null||m.change===undefined?'Not available':m.change.toFixed(2)+'%'])
 if(data.sourceCoverage?.length){rows.push([],['SOURCE COVERAGE'],['Channel','Account','Stored records','Observed days','First date','Last date','Currency']);for(const x of data.sourceCoverage)rows.push([x.channel,x.account,x.records,x.days,x.firstDate,x.lastDate,x.currency])}
 if(data.channels?.length){rows.push([],['CHANNEL BREAKDOWN'],['Channel','Impressions','Clicks','Spend','Conversions','CTR','CPA']);for(const c of data.channels)rows.push([formatChannelName(c.channel),c.impressions,c.clicks,formatCurrency(c.spend),formatConversions(c.conversions),formatPercent(c.ctr),formatCurrency(c.cpa)])}
 if(data.campaigns?.length){rows.push([],['CAMPAIGN BREAKDOWN'],['Campaign','Account','Channel','Campaign ID','Impressions','Clicks','Spend','Conversions','CTR','CPC','CPA']);for(const c of data.campaigns)rows.push([c.campaign_name,c.source_account_id??'Account needs review',formatChannelName(c.channel),c.campaign_id,c.impressions,c.clicks,formatCurrency(c.spend),formatConversions(c.conversions),formatPercent(c.ctr),formatCurrency(c.cpc),formatCurrency(c.cpa)])}
 if(data.timeSeries?.length){rows.push([],['DAILY TOTALS'],['Date','Impressions','Clicks','Spend','Conversions']);for(const r of data.timeSeries)rows.push([r.date,r.impressions,r.clicks,formatCurrency(r.spend),formatConversions(r.conversions)])}
 return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')
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
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
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

  // Wrap the property name independently from the dates.
  doc.setFontSize(11)
  doc.setFont('helvetica','normal')
  const propertyLines=doc.splitTextToSize(data.propertyName,pageWidth-28)as string[]
  const headerHeight=34+propertyLines.length*5
  doc.setFillColor(...primaryColor)
  doc.rect(0,0,pageWidth,headerHeight,'F')
  doc.setTextColor(255,255,255)
  doc.setFontSize(22)
  doc.setFont('helvetica','bold')
  doc.text('Marketing Performance Report',14,16)
  doc.setFontSize(11)
  doc.setFont('helvetica','normal')
  doc.text(propertyLines,14,25)
  doc.setFontSize(9)
  doc.text(data.dateRange.start+' to '+data.dateRange.end,14,headerHeight-5)
  doc.text((data.generatedAt?'Saved: ':'Generated: ')+format(new Date(data.generatedAt||Date.now()),'MMM d, yyyy'),pageWidth-14,headerHeight-5,{align:'right'})
  yPos=headerHeight+10

  // Summary Metrics Section
  doc.setTextColor(...textColor)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary Metrics', 14, yPos)
  yPos += 8

  // Metrics in a 2x2 grid style
  const metricsPerRow = 2
  const metricBoxWidth = (pageWidth - 28) / metricsPerRow
  const metricBoxHeight = 31

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
    doc.text(doc.splitTextToSize(metric.label,metricBoxWidth-12), x + 4, y + 7)

    // Metric value
    doc.setTextColor(...textColor)
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    const value=String(metric.value)
    while(doc.getTextWidth(value)>metricBoxWidth-12&&doc.getFontSize()>8)doc.setFontSize(doc.getFontSize()-1)
    doc.text(value, x + 4, y + 18)

    // Change indicator
    if (metric.change !== null && metric.change !== undefined) {
      const changeText = `${metric.change >= 0 ? '+' : '-'}${Math.abs(metric.change).toFixed(1)}%`
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(metric.change >= 0 ? 16 : 220, metric.change >= 0 ? 185 : 38, metric.change >= 0 ? 129 : 38)
      doc.text(changeText+' vs previous period', x + 4, y + 24)
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
      rowPageBreak: 'avoid',
      startY: yPos,
      head: [['Channel', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'CTR', 'CPA']],
      body: data.channels.map(channel => [
        formatChannelName(channel.channel),
        formatNumber(channel.impressions),
        formatNumber(channel.clicks),
        formatCurrency(channel.spend),
        formatConversions(channel.conversions),
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
      rowPageBreak: 'avoid',
      startY: yPos,
      head: [['Campaign', 'Channel', 'Spend', 'Clicks', 'Conv.', 'CTR', 'CPA']],
      body: data.campaigns.map(campaign => [
        `${campaign.campaign_name}\nCampaign ${campaign.campaign_id||'not recorded'}\n${campaign.source_account_id ? `Account ${campaign.source_account_id}` : 'Account needs review'}`,
        formatChannelName(campaign.channel),
        formatCurrency(campaign.spend),
        formatNumber(campaign.clicks),
        formatConversions(campaign.conversions),
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

    yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  }

  if(data.sourceCoverage?.length){
    if(yPos>240){doc.addPage();yPos=20}
    doc.setFontSize(14);doc.setTextColor(...textColor);doc.text('Source coverage',14,yPos);yPos+=5
    autoTable(doc,{startY:yPos,head:[['Channel / account','Records / days','Dates','Currency']],body:data.sourceCoverage.map(x=>[x.channel+'\n'+x.account,x.records+' / '+x.days,x.firstDate+' to '+x.lastDate,x.currency]),theme:'striped',headStyles:{fillColor:primaryColor,fontSize:8},bodyStyles:{fontSize:8},margin:{left:14,right:14}})
    yPos=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+10
  }
  if(data.timeSeries?.length){
    if(yPos>240){doc.addPage();yPos=20}
    doc.setFontSize(14);doc.setTextColor(...textColor);doc.text('Daily totals',14,yPos);yPos+=5
    autoTable(doc,{startY:yPos,head:[['Date','Impressions','Clicks','Spend','Conversions']],body:data.timeSeries.map(x=>[x.date,formatNumber(x.impressions),formatNumber(x.clicks),formatCurrency(x.spend),formatConversions(x.conversions)]),theme:'striped',headStyles:{fillColor:primaryColor,fontSize:8},bodyStyles:{fontSize:8},margin:{left:14,right:14}})
    yPos=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+10
  }
  const notes=[...(data.reportId?['Saved report: '+data.reportId]:[]),...(data.sourceHash?['Source identity: '+data.sourceHash]:[]),...(data.notes||[])]
  for(const note of notes){doc.setFontSize(8);const lines=doc.splitTextToSize(note,pageWidth-28)as string[];if(yPos+lines.length*4>275){doc.addPage();yPos=20}doc.setFontSize(8);doc.setTextColor(...mutedColor);doc.text(lines,14,yPos);yPos+=lines.length*4+3}
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

