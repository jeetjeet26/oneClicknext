export type CompetitorSeedClaims = {
  builder?: string
  priceText?: string
  sqftText?: string
  bedroomText?: string
  positioningText?: string
  promotionText?: string
  schoolText?: string
  seoAngle?: string
}

export type ParsedCompetitorSeed = {
  seedName: string
  seedLocation: string | null
  seedUrl: string | null
  seedSnippet: string
  seedClaims: CompetitorSeedClaims
}

const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/i
const HEADER_PATTERN =
  /^\s*([^(.]+?)(?:\s+by\s+([^(.]+?))?\s*(?:\(([^)]+)\))?[.:–-]\s*([\s\S]*)$/i

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '')
}

function matchFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[0]) return cleanText(match[0])
  }
  return undefined
}

function extractSeoAngle(text: string): string | undefined {
  const match = text.match(/SEO angle:\s*([\s\S]+)$/i)
  return match?.[1] ? cleanText(match[1]) : undefined
}

function extractClaims(text: string, builder?: string): CompetitorSeedClaims {
  return {
    ...(builder ? { builder: cleanText(builder) } : {}),
    priceText: matchFirst(text, [
      /(?:from|starting at|starts? at)\s+(?:the\s+)?(?:low\s+)?\$[\d,]+(?:s|k|K)?/i,
      /\$[\d,]+(?:\s*to\s*\$[\d,]+)?/i,
    ]),
    sqftText: matchFirst(text, [
      /[\d,]{3,5}\s*(?:to|-)\s*[\d,]{3,5}\s*sq\s*ft/i,
      /[\d,]{3,5}\s*sq\s*ft/i,
    ]),
    bedroomText: matchFirst(text, [
      /\d+\s*(?:to|-)\s*\d+\s*bed(?:room)?s?/i,
      /\d+\s*bed(?:room)?s?/i,
    ]),
    positioningText: matchFirst(text, [
      /positioned as\s+"[^"]+"/i,
      /leans? into\s+[^.]+/i,
      /family-focused messaging[^.]+/i,
      /highest price point[^.]+/i,
      /lowest entry price[^.]+/i,
    ]),
    promotionText: matchFirst(text, [
      /(?:currently running|running)\s+"[^"]+"/i,
      /(?:promo|incentive|special)[^.]+/i,
      /(?:final opportunities|nearly sold out)[^."]*/i,
    ]),
    schoolText: matchFirst(text, [
      /school callouts? to\s+[^.]+/i,
      /top-rated high school/i,
      /school-district queries/i,
    ]),
    seoAngle: extractSeoAngle(text),
  }
}

export function parseCompetitorIntakeText(rawText: string): ParsedCompetitorSeed[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  return normalized
    .split(/\n\s*\n+/)
    .map(block => cleanText(block))
    .filter(block => block.length > 0)
    .map(block => {
      const headerMatch = block.match(HEADER_PATTERN)
      const name = headerMatch?.[1]
        ? cleanText(headerMatch[1])
        : cleanText(block.split(/[.(]/)[0] || '')
      const builder = headerMatch?.[2]
      const location = headerMatch?.[3]
        ? cleanText(headerMatch[3])
        : null
      const url = block.match(URL_PATTERN)?.[0] ?? null

      if (!name) return null

      return {
        seedName: name,
        seedLocation: location,
        seedUrl: url,
        seedSnippet: block,
        seedClaims: extractClaims(block, builder),
      }
    })
    .filter((candidate): candidate is ParsedCompetitorSeed => Boolean(candidate))
}
