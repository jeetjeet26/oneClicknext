export type GeoQueryType =
  | 'branded'
  | 'category'
  | 'comparison'
  | 'local'
  | 'faq'
  | 'voice_search'

const COMPARISON_CUE_REGEX = /\b(vs\.?|versus|compare|compared|comparison|better|between)\b/i

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function includesBrandName(queryText: string, propertyName: string): boolean {
  return normalizeForMatch(queryText).includes(normalizeForMatch(propertyName))
}

export function buildComparisonQueryText(args: {
  propertyName: string
  competitorName: string
  cityState?: string
  pluralDisplayNoun?: string
}): string {
  const propertyName = args.propertyName.trim()
  const competitorName = args.competitorName.trim()
  const pluralDisplayNoun = args.pluralDisplayNoun?.trim() || 'properties'
  const location = args.cityState?.trim()

  return [
    `Compare ${propertyName} with ${competitorName} for ${pluralDisplayNoun}`,
    location ? `in ${location}` : '',
  ].filter(Boolean).join(' ')
}

export function enrichComparisonQueryText(args: {
  queryText: string
  queryType: GeoQueryType
  propertyName: string
  cityState?: string
  pluralDisplayNoun?: string
}): string {
  const queryText = args.queryText.trim()

  if (args.queryType !== 'comparison' || !queryText || !args.propertyName.trim()) {
    return queryText
  }

  const hasComparisonCue = COMPARISON_CUE_REGEX.test(queryText)
  const hasBrandContext = includesBrandName(queryText, args.propertyName)

  if (hasComparisonCue && hasBrandContext) {
    return queryText
  }

  return buildComparisonQueryText({
    propertyName: args.propertyName,
    competitorName: queryText,
    cityState: args.cityState,
    pluralDisplayNoun: args.pluralDisplayNoun,
  })
}
