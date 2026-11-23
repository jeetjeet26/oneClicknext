export const FAIR_HOUSING_PATTERNS: ReadonlyArray<{
  code: string
  pattern: RegExp
}> = [
  {
    code: 'audience_suitability',
    pattern: /\b(?:perfect|ideal) for (?:families|singles|young professionals|retirees|students)\b/i,
  },
  {
    code: 'neighborhood_safety',
    pattern: /\b(?:safe|crime[- ]free) neighborhood\b/i,
  },
  {
    code: 'protected_class_community',
    pattern: /\b(?:christian|jewish|muslim|hindu|white|black|asian|hispanic) (?:community|neighborhood)\b/i,
  },
  {
    code: 'discriminatory_exclusion',
    pattern: /\bno (?:children|kids|disabled|section 8)\b/i,
  },
  {
    code: 'adults_only',
    pattern: /\badults only\b/i,
  },
]

export function findFairHousingViolations(text: string): string[] {
  return FAIR_HOUSING_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ code }) => code)
}

const household = /\b(?:famil(?:y|ies)|parents?|children|kids|singles|young professionals|retirees|seniors|students|people like (?:us|me)|muslims?|christians?|jewish (?:people|residents)|black (?:people|residents)|asian (?:people|residents)|wheelchair users)\b/i
const suitability = /\b(?:good|ideal|best|right|great|perfect|suitable|welcoming|recommend(?:ed)?|fit in|fit for|belong|friendly|safe|feel at home|feel welcome)\b/i
const residentComposition = /\b(?:what (?:kind|type|sort)s? of (?:people|families)|who (?:else )?lives (?:here|there)|(?:mostly|mainly|predominantly) (?:families|singles|white|black|asian|hispanic)|(?:many|mostly) (?:kids|children|families) (?:live|living))\b/i

export const neutralHousingReply = 'I can help you compare specific features, such as floor plans, amenities, accessibility, or nearby destinations. Which features would you like to know about?'

export function isHousingSteeringQuestion(text: string): boolean {
  if (residentComposition.test(text)) return true
  const place = /\b(?:area|neighbou?rhood|community|building|apartments?|development|place|property|here|there|fit in|belong)\b/i
  if (!household.test(text)) return false
  if (place.test(text) && /\b(?:(?:family|kid|child)[- ]friendly|feel (?:at home|welcome))\b/i.test(text)) {
    if (/\b(?:family|kid|child)[- ]friendly\s+(?:amenities|events|activities|playgrounds?|facilities)\b/i.test(text)) return false
    return true
  }
  // "Good playgrounds for families" describes a feature. "A good area for
  // families" asks for a judgment about who belongs in the community.
  const placeJudgment = /\b(?:good|ideal|best|right|great|perfect|suitable|welcoming|safe)\s+(?:\w+\s+)?(?:area|neighbou?rhood|community|building|apartments?|place|fit|choice)\b/i
  const directJudgment = /\b(?:good|ideal|best|right|great|perfect|suitable|welcoming|safe|friendly|fit)\s+for\b|\b(?:fit in|belong|recommend)\b/i
  return suitability.test(text) && (placeJudgment.test(text) || directJudgment.test(text) && (place.test(text) || /\b(?:it|this|that)\b/i.test(text)))
}

export function isHousingSteeringAnswer(text: string): boolean {
  return findFairHousingViolations(text).length > 0 || residentComposition.test(text) ||
    /\b(?:good|great|best|perfect|ideal|welcoming|suitable)\s+(?:(?:area|neighbou?rhood|community|place|fit)\s+)?for (?:families|singles|young professionals|retirees|students)\b/i.test(text)
}
