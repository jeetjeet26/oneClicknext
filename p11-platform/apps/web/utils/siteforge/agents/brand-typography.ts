import type { BrandTypography } from './brand-agent'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeFontFamily(
  value: unknown,
  fallback: string
): string {
  if (typeof value === 'string') return stringValue(value) || fallback
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback

  const record = value as Record<string, unknown>
  return (
    stringValue(record.name) ||
    stringValue(record.font) ||
    stringValue(record.fontFamily) ||
    stringValue(record.family) ||
    fallback
  )
}

function fontUsage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return stringValue((value as Record<string, unknown>).usage)
}

export function normalizeBrandTypographySection(
  value: unknown
): BrandTypography | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const section = value as Record<string, unknown>
  const primarySource =
    section.primaryFont || section.primary || section.headingFont
  const secondarySource =
    section.secondaryFont || section.secondary || section.bodyFont
  const primaryFont = normalizeFontFamily(primarySource, '')
  const secondaryFont = normalizeFontFamily(secondarySource, '')

  if (!primaryFont && !secondaryFont) return undefined

  return {
    primaryFont: primaryFont || 'Inter',
    primaryUsage:
      stringValue(section.primaryUsage) ||
      fontUsage(primarySource) ||
      'Headlines, logo, signage',
    secondaryFont: secondaryFont || 'Inter',
    secondaryUsage:
      stringValue(section.secondaryUsage) ||
      fontUsage(secondarySource) ||
      'Body copy, digital applications',
  }
}
