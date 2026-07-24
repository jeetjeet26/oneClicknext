/**
 * Timezone normalization for calendar integrations.
 *
 * Microsoft Graph mailboxSettings returns Windows timezone names (e.g.
 * "Pacific Standard Time") while the rest of the platform (Intl, slot
 * generation) requires IANA identifiers (e.g. "America/Los_Angeles").
 */

// Common Windows -> IANA mappings from the CLDR windowsZones table.
const WINDOWS_TO_IANA: Record<string, string> = {
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'SA Pacific Standard Time': 'America/Bogota',
  'Venezuela Standard Time': 'America/Caracas',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'UTC': 'UTC',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kyiv',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh',
  'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'W. Australia Standard Time': 'Australia/Perth',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'New Zealand Standard Time': 'Pacific/Auckland',
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * Normalizes a timezone value from a calendar provider to an IANA identifier.
 * Accepts IANA identifiers as-is and maps Windows timezone names. Returns
 * null when the value cannot be resolved to a usable zone.
 */
export function normalizeTimezoneToIana(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const mapped = WINDOWS_TO_IANA[trimmed]
  if (mapped) return mapped

  return isValidIanaTimezone(trimmed) ? trimmed : null
}
