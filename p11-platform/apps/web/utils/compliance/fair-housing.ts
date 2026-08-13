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
