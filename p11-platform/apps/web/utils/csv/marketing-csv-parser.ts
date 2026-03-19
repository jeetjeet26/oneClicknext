/**
 * Marketing CSV Parser
 * 
 * Parses CSV exports from Google Ads and Meta Ads into a normalized format
 * compatible with the fact_marketing_performance table.
 */

import { normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

export type MarketingPlatform = 'google_ads' | 'meta_ads' | 'meta'

export type ParsedMarketingRow = {
  date: string // YYYY-MM-DD format
  channel_id: MarketingPlatform
  campaign_name: string
  campaign_id: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

export type CSVParseResult = {
  success: boolean
  platform: MarketingPlatform
  reportType: string
  rows: ParsedMarketingRow[]
  dateRange: {
    start: string
    end: string
  } | null
  errors: string[]
  warnings: string[]
}

export type ExtendedMetricsRow = {
  report_type: string
  dimension_key: string
  dimension_value: string
  date_range_start: string
  date_range_end: string
  metrics: Record<string, number | string>
}

export type ExtendedParseResult = {
  success: boolean
  platform: MarketingPlatform
  reportType: string
  rows: ExtendedMetricsRow[]
  dateRange: {
    start: string
    end: string
  } | null
  errors: string[]
  warnings: string[]
}

/**
 * Parse a CSV string into rows
 */
function parseCSVString(csvString: string): string[][] {
  const lines = csvString.trim().split('\n')
  const result: string[][] = []
  
  for (const line of lines) {
    const row: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    row.push(current.trim())
    result.push(row)
  }
  
  return result
}

/**
 * Parse Google Ads date format: "Sat, Nov 1, 2025" -> "2025-11-01"
 */
function parseGoogleAdsDate(dateStr: string): string | null {
  // Remove day of week if present
  const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '')
  
  // Try to parse "Nov 1, 2025" format
  const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/)
  if (match) {
    const months: Record<string, string> = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    }
    const month = months[match[1]]
    if (month) {
      const day = match[2].padStart(2, '0')
      return `${match[3]}-${month}-${day}`
    }
  }
  
  // Try ISO format
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }
  
  return null
}

/**
 * Parse currency string: "$174.59" -> 174.59
 */
function parseCurrency(value: string): number {
  if (!value || value === '-' || value === 'No data') return 0
  const cleaned = value.replace(/[$,]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Parse number string: "1,234" -> 1234
 */
function parseNumber(value: string): number {
  if (!value || value === '-' || value === 'No data') return 0
  const cleaned = value.replace(/[,"]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num)
}

/**
 * Extract date range from filename
 * e.g., "Time_series(2025.11.01-2025.11.30).csv" -> { start: "2025-11-01", end: "2025-11-30" }
 */
export function extractDateRangeFromFilename(filename: string): { start: string; end: string } | null {
  // Match patterns like "2025.11.01-2025.11.30" or "2025-11-01-2025-11-30"
  const match = filename.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})[_\-](\d{4})[.\-](\d{2})[.\-](\d{2})/)
  if (match) {
    return {
      start: `${match[1]}-${match[2]}-${match[3]}`,
      end: `${match[4]}-${match[5]}-${match[6]}`
    }
  }
  return null
}

/**
 * Detect the report type from headers
 */
function detectReportType(headers: string[]): string {
  const headerSet = new Set(headers.map(h => h.toLowerCase()))
  
  if (headerSet.has('date') && (headerSet.has('clicks') || headerSet.has('cost'))) {
    return 'time_series'
  }
  if (headerSet.has('search keyword') || headerSet.has('keyword')) {
    return 'keywords'
  }
  if (headerSet.has('search') && headerSet.has('impressions')) {
    return 'search_terms'
  }
  if (headerSet.has('gender') || headerSet.has('age range')) {
    return 'demographics'
  }
  if (headerSet.has('device')) {
    return 'devices'
  }
  if (headerSet.has('location name') || headerSet.has('country')) {
    return 'locations'
  }
  if (headerSet.has('day') && !headerSet.has('date')) {
    return 'day_hour'
  }
  if (headerSet.has('advertiser name') || headerSet.has('impression share')) {
    return 'auction_insights'
  }
  if (headerSet.has('network')) {
    return 'networks'
  }
  
  return 'unknown'
}

/**
 * Detect platform from headers and data patterns
 */
function detectPlatform(headers: string[], rows: string[][]): MarketingPlatform {
  const headerStr = headers.join(' ').toLowerCase()
  
  // Meta-specific columns
  if (headerStr.includes('ad set') || headerStr.includes('actions') || headerStr.includes('date_start')) {
    return 'meta_ads'
  }
  
  // Google Ads specific patterns
  if (headerStr.includes('cost / conv') || headerStr.includes('criterion status') || 
      headerStr.includes('match type') || headerStr.includes('advertiser name')) {
    return 'google_ads'
  }
  
  // Check date format in data
  if (rows.length > 0) {
    const firstDataRow = rows[0]
    for (const cell of firstDataRow) {
      // Google Ads uses "Sat, Nov 1, 2025" format
      if (/^[A-Za-z]+,\s*[A-Za-z]+\s+\d/.test(cell)) {
        return 'google_ads'
      }
      // Meta uses ISO dates
      if (/^\d{4}-\d{2}-\d{2}$/.test(cell)) {
        return 'meta_ads'
      }
    }
  }
  
  return 'google_ads' // Default to Google Ads
}

/**
 * Generate a campaign ID from campaign name and date range
 */
function generateCampaignId(campaignName: string, dateRange: { start: string; end: string } | null): string {
  const base = campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const suffix = dateRange ? `_${dateRange.start.replace(/-/g, '')}` : ''
  return `csv_${base}${suffix}`.substring(0, 64)
}

/**
 * Parse Google Ads Time Series CSV
 */
function parseGoogleAdsTimeSeries(
  headers: string[],
  rows: string[][],
  campaignName: string,
  dateRange: { start: string; end: string } | null
): CSVParseResult {
  const result: CSVParseResult = {
    success: true,
    platform: 'google_ads',
    reportType: 'time_series',
    rows: [],
    dateRange,
    errors: [],
    warnings: []
  }
  
  // Find column indices
  const colIndex: Record<string, number> = {}
  headers.forEach((h, i) => {
    colIndex[h.toLowerCase()] = i
  })
  
  const dateIdx = colIndex['date']
  const clicksIdx = colIndex['clicks']
  const conversionsIdx = colIndex['conversions']
  const costIdx = colIndex['cost']
  const impressionsIdx = colIndex['impressions']
  
  if (dateIdx === undefined) {
    result.success = false
    result.errors.push('Missing required column: Date')
    return result
  }
  
  const campaignId = generateCampaignId(campaignName, dateRange)
  let minDate: string | null = null
  let maxDate: string | null = null
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.length === 0 || row.every(cell => !cell.trim())) continue
    
    const rawDate = row[dateIdx]
    const parsedDate = parseGoogleAdsDate(rawDate)
    
    if (!parsedDate) {
      result.warnings.push(`Row ${i + 2}: Could not parse date "${rawDate}"`)
      continue
    }
    
    // Track date range from actual data
    if (!minDate || parsedDate < minDate) minDate = parsedDate
    if (!maxDate || parsedDate > maxDate) maxDate = parsedDate
    
    const parsed: ParsedMarketingRow = {
      date: parsedDate,
      channel_id: 'google_ads',
      campaign_name: campaignName,
      campaign_id: campaignId,
      impressions: impressionsIdx !== undefined ? parseNumber(row[impressionsIdx]) : 0,
      clicks: clicksIdx !== undefined ? parseNumber(row[clicksIdx]) : 0,
      spend: costIdx !== undefined ? parseCurrency(row[costIdx]) : 0,
      conversions: conversionsIdx !== undefined ? parseNumber(row[conversionsIdx]) : 0
    }
    
    result.rows.push(parsed)
  }
  
  // Update date range from actual data if not provided
  if (!result.dateRange && minDate && maxDate) {
    result.dateRange = { start: minDate, end: maxDate }
  }
  
  if (result.rows.length === 0) {
    result.success = false
    result.errors.push('No valid data rows found')
  }
  
  return result
}

/**
 * Parse Meta Ads CSV export
 */
function parseMetaAdsTimeSeries(
  headers: string[],
  rows: string[][],
  campaignName: string,
  dateRange: { start: string; end: string } | null
): CSVParseResult {
  const result: CSVParseResult = {
    success: true,
    platform: 'meta_ads',
    reportType: 'time_series',
    rows: [],
    dateRange,
    errors: [],
    warnings: []
  }
  
  // Find column indices
  const colIndex: Record<string, number> = {}
  headers.forEach((h, i) => {
    colIndex[h.toLowerCase()] = i
  })
  
  // Meta uses date_start or reporting_starts
  const dateIdx = colIndex['date_start'] ?? colIndex['date'] ?? colIndex['reporting_starts']
  const campaignNameIdx = colIndex['campaign_name'] ?? colIndex['campaign name']
  const campaignIdIdx = colIndex['campaign_id'] ?? colIndex['campaign id']
  const impressionsIdx = colIndex['impressions']
  const clicksIdx = colIndex['clicks'] ?? colIndex['link_clicks'] ?? colIndex['link clicks']
  const spendIdx = colIndex['spend'] ?? colIndex['amount_spent'] ?? colIndex['amount spent']
  const conversionsIdx = colIndex['conversions'] ?? colIndex['results']
  
  if (dateIdx === undefined) {
    result.success = false
    result.errors.push('Missing required column: date_start or date')
    return result
  }
  
  let minDate: string | null = null
  let maxDate: string | null = null
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.length === 0 || row.every(cell => !cell.trim())) continue
    
    const rawDate = row[dateIdx]
    // Meta typically uses YYYY-MM-DD format
    const parsedDate = rawDate.match(/^\d{4}-\d{2}-\d{2}/) ? rawDate.substring(0, 10) : parseGoogleAdsDate(rawDate)
    
    if (!parsedDate) {
      result.warnings.push(`Row ${i + 2}: Could not parse date "${rawDate}"`)
      continue
    }
    
    if (!minDate || parsedDate < minDate) minDate = parsedDate
    if (!maxDate || parsedDate > maxDate) maxDate = parsedDate
    
    const rowCampaignName = campaignNameIdx !== undefined ? row[campaignNameIdx] : campaignName
    const rowCampaignId = campaignIdIdx !== undefined ? row[campaignIdIdx] : generateCampaignId(rowCampaignName, dateRange)
    
    const parsed: ParsedMarketingRow = {
      date: parsedDate,
      channel_id: 'meta_ads',
      campaign_name: rowCampaignName || campaignName,
      campaign_id: rowCampaignId,
      impressions: impressionsIdx !== undefined ? parseNumber(row[impressionsIdx]) : 0,
      clicks: clicksIdx !== undefined ? parseNumber(row[clicksIdx]) : 0,
      spend: spendIdx !== undefined ? parseCurrency(row[spendIdx]) : 0,
      conversions: conversionsIdx !== undefined ? parseNumber(row[conversionsIdx]) : 0
    }
    
    result.rows.push(parsed)
  }
  
  if (!result.dateRange && minDate && maxDate) {
    result.dateRange = { start: minDate, end: maxDate }
  }
  
  if (result.rows.length === 0) {
    result.success = false
    result.errors.push('No valid data rows found')
  }
  
  return result
}

/**
 * Parse extended reports (keywords, demographics, devices, etc.)
 * These don't have daily dates, so we store them with period metadata
 */
export function parseExtendedReport(
  csvString: string,
  filename: string,
  platform: MarketingPlatform
): ExtendedParseResult {
  const allRows = parseCSVString(csvString)
  if (allRows.length < 2) {
    return {
      success: false,
      platform,
      reportType: 'unknown',
      rows: [],
      dateRange: null,
      errors: ['CSV file is empty or has no data rows'],
      warnings: []
    }
  }
  
  const headers = allRows[0]
  const dataRows = allRows.slice(1).filter(row => row.length > 0 && row.some(cell => cell.trim()))
  const reportType = detectReportType(headers)
  const dateRange = extractDateRangeFromFilename(filename)
  
  const result: ExtendedParseResult = {
    success: true,
    platform,
    reportType,
    rows: [],
    dateRange,
    errors: [],
    warnings: []
  }
  
  if (!dateRange) {
    result.warnings.push('Could not extract date range from filename. Using current date.')
  }
  
  // Build column index
  const colIndex: Record<string, number> = {}
  headers.forEach((h, i) => {
    colIndex[h.toLowerCase()] = i
  })
  
  // Determine dimension key based on report type
  let dimensionKey: string
  let dimensionIdx: number
  
  switch (reportType) {
    case 'keywords':
      dimensionKey = 'keyword'
      dimensionIdx = colIndex['search keyword'] ?? colIndex['keyword'] ?? 0
      break
    case 'search_terms':
      dimensionKey = 'search_term'
      dimensionIdx = colIndex['search'] ?? 0
      break
    case 'demographics':
      dimensionKey = 'demographic'
      dimensionIdx = -1 // Will combine gender + age
      break
    case 'devices':
      dimensionKey = 'device'
      dimensionIdx = colIndex['device'] ?? 0
      break
    case 'locations':
      dimensionKey = 'location'
      dimensionIdx = colIndex['location name'] ?? colIndex['country'] ?? 0
      break
    default:
      dimensionKey = 'value'
      dimensionIdx = 0
  }
  
  for (const row of dataRows) {
    let dimensionValue: string
    
    if (reportType === 'demographics') {
      const gender = row[colIndex['gender']] ?? ''
      const age = row[colIndex['age range']] ?? ''
      dimensionValue = `${gender} ${age}`.trim()
    } else {
      dimensionValue = row[dimensionIdx] ?? ''
    }
    
    if (!dimensionValue) continue
    
    // Collect all metrics from the row
    const metrics: Record<string, number | string> = {}
    headers.forEach((header, idx) => {
      const lowerHeader = header.toLowerCase()
      if (idx !== dimensionIdx && row[idx]) {
        // Try to parse as number
        const numVal = parseCurrency(row[idx]) || parseNumber(row[idx])
        if (!isNaN(numVal) && numVal !== 0) {
          metrics[lowerHeader] = numVal
        } else if (row[idx] && row[idx] !== '-') {
          metrics[lowerHeader] = row[idx]
        }
      }
    })
    
    result.rows.push({
      report_type: reportType,
      dimension_key: dimensionKey,
      dimension_value: dimensionValue,
      date_range_start: dateRange?.start ?? new Date().toISOString().substring(0, 10),
      date_range_end: dateRange?.end ?? new Date().toISOString().substring(0, 10),
      metrics
    })
  }
  
  if (result.rows.length === 0) {
    result.success = false
    result.errors.push('No valid data rows found')
  }
  
  return result
}

/**
 * Skip metadata rows in Google Ads exports (title row, date range row)
 * Returns the index of the actual header row
 */
function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i]
    // Look for common header columns
    const rowLower = row.map(c => c.toLowerCase())
    if (rowLower.includes('clicks') || rowLower.includes('cost') || 
        rowLower.includes('impressions') || rowLower.includes('impr.') ||
        rowLower.includes('campaign') || rowLower.includes('ad group')) {
      return i
    }
  }
  return 0 // Default to first row
}

/**
 * Extract date range from Google Ads metadata row
 * e.g., "November 13, 2024 - December 10, 2025"
 */
function extractDateRangeFromMetadata(rows: string[][]): { start: string; end: string } | null {
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const rowText = rows[i].join(' ')
    // Match "Month DD, YYYY - Month DD, YYYY"
    const match = rowText.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/)
    if (match) {
      const months: Record<string, string> = {
        'January': '01', 'February': '02', 'March': '03', 'April': '04',
        'May': '05', 'June': '06', 'July': '07', 'August': '08',
        'September': '09', 'October': '10', 'November': '11', 'December': '12'
      }
      const startMonth = months[match[1]] || '01'
      const endMonth = months[match[4]] || '12'
      return {
        start: `${match[3]}-${startMonth}-${match[2].padStart(2, '0')}`,
        end: `${match[6]}-${endMonth}-${match[5].padStart(2, '0')}`
      }
    }
  }
  return null
}

/**
 * Normalize Google Ads column headers
 */
function normalizeHeaders(headers: string[]): string[] {
  const mapping: Record<string, string> = {
    'impr.': 'impressions',
    'conv.': 'conversions',
    'conv. rate': 'conversion_rate',
    'cost / conv.': 'cost_per_conversion',
    'avg. cpc': 'avg_cpc',
    'ctr': 'ctr',
  }
  
  return headers.map(h => {
    const lower = h.toLowerCase()
    return mapping[lower] || lower
  })
}

/**
 * Parse Google Ads Campaign Summary (no date column, campaign-level aggregates)
 */
function parseGoogleAdsCampaignSummary(
  headers: string[],
  rows: string[][],
  dateRange: { start: string; end: string } | null
): CSVParseResult {
  const result: CSVParseResult = {
    success: true,
    platform: 'google_ads',
    reportType: 'campaign_summary',
    rows: [],
    dateRange,
    errors: [],
    warnings: []
  }
  
  // Normalize headers for matching
  const normalizedHeaders = normalizeHeaders(headers)
  const colIndex: Record<string, number> = {}
  normalizedHeaders.forEach((h, i) => {
    colIndex[h] = i
  })
  
  // Find relevant columns
  const campaignIdx = colIndex['campaign'] ?? colIndex['campaign name'] ?? -1
  const clicksIdx = colIndex['clicks'] ?? -1
  const impressionsIdx = colIndex['impressions'] ?? -1
  const costIdx = colIndex['cost'] ?? colIndex['cost (converted currency)'] ?? -1
  const conversionsIdx = colIndex['conversions'] ?? -1
  
  if (campaignIdx === -1) {
    result.success = false
    result.errors.push('Missing required column: Campaign')
    return result
  }
  
  // Use end date of range or today for the record date
  const recordDate = dateRange?.end || new Date().toISOString().substring(0, 10)
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.length === 0 || row.every(cell => !cell.trim())) continue
    
    const campaignName = row[campaignIdx]
    if (!campaignName || campaignName.toLowerCase() === 'total') continue
    
    const campaignId = generateCampaignId(campaignName, dateRange)
    
    const parsed: ParsedMarketingRow = {
      date: recordDate,
      channel_id: 'google_ads',
      campaign_name: campaignName,
      campaign_id: campaignId,
      impressions: impressionsIdx !== -1 ? parseNumber(row[impressionsIdx]) : 0,
      clicks: clicksIdx !== -1 ? parseNumber(row[clicksIdx]) : 0,
      spend: costIdx !== -1 ? parseCurrency(row[costIdx]) : 0,
      conversions: conversionsIdx !== -1 ? parseNumber(row[conversionsIdx]) : 0
    }
    
    result.rows.push(parsed)
  }
  
  if (result.rows.length === 0) {
    result.success = false
    result.errors.push('No valid campaign data rows found')
  }
  
  return result
}

/**
 * Main parsing function for time series data
 */
export function parseMarketingCSV(
  csvString: string,
  filename: string,
  campaignName: string,
  platformHint?: MarketingPlatform
): CSVParseResult {
  const allRows = parseCSVString(csvString)
  
  if (allRows.length < 2) {
    return {
      success: false,
      platform: platformHint || 'google_ads',
      reportType: 'unknown',
      rows: [],
      dateRange: null,
      errors: ['CSV file is empty or has no data rows'],
      warnings: []
    }
  }
  
  // Handle Google Ads exports with metadata rows (title, date range)
  const headerRowIndex = findHeaderRowIndex(allRows)
  const headers = allRows[headerRowIndex]
  const dataRows = allRows.slice(headerRowIndex + 1).filter(row => row.length > 0 && row.some(cell => cell.trim()))
  
  // Try to extract date range from metadata rows or filename
  let dateRange = extractDateRangeFromFilename(filename) || extractDateRangeFromMetadata(allRows.slice(0, headerRowIndex))
  
  const reportType = detectReportType(headers)
  const normalizedHint = platformHint
    ? (normalizeMarketingChannelId(platformHint) as MarketingPlatform)
    : undefined
  const platform = normalizedHint || detectPlatform(headers, dataRows)
  
  // Check if this is a campaign summary (no date column but has campaign column)
  const normalizedHeaders = normalizeHeaders(headers)
  const hasDateColumn = normalizedHeaders.includes('date')
  const hasCampaignColumn = normalizedHeaders.includes('campaign') || normalizedHeaders.includes('campaign name')
  
  if (!hasDateColumn && hasCampaignColumn) {
    // This is a campaign summary report
    return parseGoogleAdsCampaignSummary(headers, dataRows, dateRange)
  }
  
  // Only handle time_series in the main parser
  if (reportType !== 'time_series') {
    return {
      success: false,
      platform,
      reportType,
      rows: [],
      dateRange,
      errors: [`This appears to be a ${reportType} report, not a time series. Use parseExtendedReport() for this type.`],
      warnings: []
    }
  }
  
  if (platform === 'meta_ads') {
    return parseMetaAdsTimeSeries(headers, dataRows, campaignName, dateRange)
  } else {
    return parseGoogleAdsTimeSeries(headers, dataRows, campaignName, dateRange)
  }
}

/**
 * Validate a parsed result before database insertion
 */
export function validateParseResult(result: CSVParseResult): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  
  if (!result.success) {
    issues.push(...result.errors)
  }
  
  if (result.rows.length === 0) {
    issues.push('No data rows to import')
  }
  
  // Check for required fields
  for (let i = 0; i < Math.min(result.rows.length, 5); i++) {
    const row = result.rows[i]
    if (!row.date) {
      issues.push(`Row ${i + 1}: Missing date`)
    }
    if (!row.campaign_name) {
      issues.push(`Row ${i + 1}: Missing campaign name`)
    }
  }
  
  // Check for suspicious data
  const totalSpend = result.rows.reduce((sum, r) => sum + r.spend, 0)
  if (totalSpend === 0 && result.rows.length > 0) {
    issues.push('Warning: Total spend is $0.00')
  }
  
  return {
    valid: issues.filter(i => !i.startsWith('Warning')).length === 0,
    issues
  }
}
