export type SeedKeywordMetricName =
  | 'impressions'
  | 'interactions'
  | 'conversions'
  | 'cost'
  | 'avgCost'
  | 'searchVolume'
  | 'cpc'

export type SeedKeywordInput =
  | string
  | {
      keyword?: unknown
      text?: unknown
      phrase?: unknown
      score?: unknown
      metrics?: Partial<Record<SeedKeywordMetricName, unknown>>
      impressions?: unknown
      interactions?: unknown
      clicks?: unknown
      conversions?: unknown
      cost?: unknown
      avgCost?: unknown
      searchVolume?: unknown
      cpc?: unknown
    }

export type PropertyAuditSeedKeyword = {
  keyword: string
  score: number
  metrics: Partial<Record<SeedKeywordMetricName, number>>
}

export type ParseSeedKeywordCsvResult = {
  seeds: PropertyAuditSeedKeyword[]
  totalRows: number
  skippedRows: number
  duplicateRows: number
  detectedKeywordColumn: string | null
  warnings: string[]
}

const MAX_KEYWORD_LENGTH = 140
const DEFAULT_SEED_LIMIT = 50

const KEYWORD_HEADER_ALIASES = new Set([
  'keyword',
  'search keyword',
  'search term',
  'seed keyword',
  'phrase',
  'query',
])

const METRIC_HEADER_ALIASES: Record<SeedKeywordMetricName, string[]> = {
  impressions: ['impr.', 'impr', 'impressions'],
  interactions: ['interactions', 'clicks', 'click'],
  conversions: ['conversions', 'conv.'],
  cost: ['cost', 'spend'],
  avgCost: ['avg. cost', 'avg cost', 'average cost'],
  searchVolume: ['search volume', 'volume', 'searches'],
  cpc: ['cpc', 'avg. cpc', 'avg cpc'],
}

function cleanCell(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim()
}

function normalizeHeader(value: string): string {
  return cleanCell(value).toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeSeedKeyword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .trim()

  if (!normalized) return null
  if (normalized.length > MAX_KEYWORD_LENGTH) return null
  if (/^total:/i.test(normalized)) return null
  if (normalized === '--' || normalized === '-') return null
  return normalized
}

function parseNumberMetric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed || trimmed === '--' || trimmed === '-') return undefined

  const cleaned = trimmed
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')

  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

function scoreSeed(metrics: Partial<Record<SeedKeywordMetricName, number>>, explicitScore?: number): number {
  if (typeof explicitScore === 'number' && Number.isFinite(explicitScore)) {
    return explicitScore
  }

  const conversions = metrics.conversions ?? 0
  const interactions = metrics.interactions ?? 0
  const impressions = metrics.impressions ?? metrics.searchVolume ?? 0
  const paidSignal = Math.max(metrics.avgCost ?? 0, metrics.cpc ?? 0)
  const spend = metrics.cost ?? 0

  return conversions * 1000 + interactions * 10 + impressions * 0.05 + paidSignal * 5 + spend * 0.01
}

function parseDelimitedRows(content: string): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false
  const tabCount = (content.match(/\t/g) || []).length
  const commaCount = (content.match(/,/g) || []).length
  const delimiter = tabCount >= commaCount && tabCount > 0 ? '\t' : ','

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const nextChar = content[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(cleanCell(current))
      current = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(cleanCell(current))
      if (row.some(cell => cell.length > 0)) rows.push(row)
      row = []
      current = ''
      continue
    }

    current += char
  }

  row.push(cleanCell(current))
  if (row.some(cell => cell.length > 0)) rows.push(row)
  return rows
}

function findHeaderRow(rows: string[][]): { headerRowIndex: number; keywordColumnIndex: number } | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const keywordColumnIndex = rows[rowIndex].findIndex(header =>
      KEYWORD_HEADER_ALIASES.has(normalizeHeader(header))
    )
    if (keywordColumnIndex >= 0) {
      return { headerRowIndex: rowIndex, keywordColumnIndex }
    }
  }

  return null
}

function buildMetricColumnMap(headers: string[]): Partial<Record<SeedKeywordMetricName, number>> {
  const normalizedHeaders = headers.map(normalizeHeader)
  const map: Partial<Record<SeedKeywordMetricName, number>> = {}

  for (const [metricName, aliases] of Object.entries(METRIC_HEADER_ALIASES) as Array<[SeedKeywordMetricName, string[]]>) {
    const columnIndex = normalizedHeaders.findIndex(header => aliases.includes(header))
    if (columnIndex >= 0) map[metricName] = columnIndex
  }

  return map
}

function mergeSeed(
  seedMap: Map<string, PropertyAuditSeedKeyword>,
  seed: PropertyAuditSeedKeyword
): 'inserted' | 'duplicate' {
  const key = seed.keyword.toLowerCase()
  const existing = seedMap.get(key)
  if (!existing) {
    seedMap.set(key, seed)
    return 'inserted'
  }

  if (seed.score > existing.score) {
    seedMap.set(key, seed)
  }

  return 'duplicate'
}

export function normalizeSeedKeywords(
  input: unknown,
  options: { limit?: number } = {}
): PropertyAuditSeedKeyword[] {
  if (!Array.isArray(input)) return []

  const seedMap = new Map<string, PropertyAuditSeedKeyword>()
  for (const entry of input) {
    const keyword = typeof entry === 'string'
      ? normalizeSeedKeyword(entry)
      : normalizeSeedKeyword(
          (entry as SeedKeywordInput & { keyword?: unknown; text?: unknown; phrase?: unknown })?.keyword ??
          (entry as SeedKeywordInput & { keyword?: unknown; text?: unknown; phrase?: unknown })?.text ??
          (entry as SeedKeywordInput & { keyword?: unknown; text?: unknown; phrase?: unknown })?.phrase
        )

    if (!keyword) continue

    const entryObject = typeof entry === 'object' && entry !== null
      ? entry as Exclude<SeedKeywordInput, string>
      : null
    const metrics: Partial<Record<SeedKeywordMetricName, number>> = {}
    if (entryObject) {
      const candidateMetrics = {
        impressions: entryObject.metrics?.impressions ?? entryObject.impressions,
        interactions: entryObject.metrics?.interactions ?? entryObject.interactions ?? entryObject.clicks,
        conversions: entryObject.metrics?.conversions ?? entryObject.conversions,
        cost: entryObject.metrics?.cost ?? entryObject.cost,
        avgCost: entryObject.metrics?.avgCost ?? entryObject.avgCost,
        searchVolume: entryObject.metrics?.searchVolume ?? entryObject.searchVolume,
        cpc: entryObject.metrics?.cpc ?? entryObject.cpc,
      }

      for (const [metricName, metricValue] of Object.entries(candidateMetrics) as Array<[SeedKeywordMetricName, unknown]>) {
        const parsed = parseNumberMetric(metricValue)
        if (parsed !== undefined) metrics[metricName] = parsed
      }
    }

    const explicitScore = parseNumberMetric(entryObject?.score)
    mergeSeed(seedMap, {
      keyword,
      score: scoreSeed(metrics, explicitScore),
      metrics,
    })
  }

  return Array.from(seedMap.values())
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, options.limit ?? DEFAULT_SEED_LIMIT)
}

export function parseSeedKeywordCsv(
  content: string,
  options: { limit?: number } = {}
): ParseSeedKeywordCsvResult {
  const rows = parseDelimitedRows(content)
  const warnings: string[] = []
  const headerMatch = findHeaderRow(rows)

  if (!headerMatch) {
    return {
      seeds: [],
      totalRows: 0,
      skippedRows: rows.length,
      duplicateRows: 0,
      detectedKeywordColumn: null,
      warnings: ['No keyword column found. Expected a column like Keyword, Search keyword, Search term, or Phrase.'],
    }
  }

  const headers = rows[headerMatch.headerRowIndex]
  const dataRows = rows.slice(headerMatch.headerRowIndex + 1)
  const metricColumnMap = buildMetricColumnMap(headers)
  const seedMap = new Map<string, PropertyAuditSeedKeyword>()
  let skippedRows = headerMatch.headerRowIndex
  let duplicateRows = 0

  for (const row of dataRows) {
    const keyword = normalizeSeedKeyword(row[headerMatch.keywordColumnIndex])
    if (!keyword) {
      skippedRows += 1
      continue
    }

    const metrics: Partial<Record<SeedKeywordMetricName, number>> = {}
    for (const [metricName, columnIndex] of Object.entries(metricColumnMap) as Array<[SeedKeywordMetricName, number]>) {
      const parsed = parseNumberMetric(row[columnIndex])
      if (parsed !== undefined) metrics[metricName] = parsed
    }

    const status = row[headers.findIndex(header => normalizeHeader(header) === 'status')]
    const statusReason = row[headers.findIndex(header => normalizeHeader(header) === 'status reasons')]
    if (typeof status === 'string' && /^removed$/i.test(status)) {
      skippedRows += 1
      continue
    }

    const mergeResult = mergeSeed(seedMap, {
      keyword,
      score: scoreSeed(metrics),
      metrics,
    })

    if (mergeResult === 'duplicate') duplicateRows += 1
    if (typeof statusReason === 'string' && /rarely served/i.test(statusReason)) {
      warnings.push(`Kept low-volume seed "${keyword}" marked rarely served.`)
    }
  }

  const seeds = Array.from(seedMap.values())
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, options.limit ?? DEFAULT_SEED_LIMIT)

  return {
    seeds,
    totalRows: dataRows.length,
    skippedRows,
    duplicateRows,
    detectedKeywordColumn: headers[headerMatch.keywordColumnIndex] || null,
    warnings: Array.from(new Set(warnings)).slice(0, 10),
  }
}
