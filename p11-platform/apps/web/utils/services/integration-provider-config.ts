export type IntegrationProvider = 'google' | 'microsoft'
export type IntegrationCapability = 'calendar' | 'email'
export type IntegrationAuthSource = 'dashboard' | 'external_invite'

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = ['google', 'microsoft']
export const INTEGRATION_CAPABILITIES: IntegrationCapability[] = ['calendar', 'email']

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0'

const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
]

const GOOGLE_IDENTITY_SCOPES = [
  'openid',
  'email',
  'profile',
]

const GOOGLE_EMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
]

const MICROSOFT_BASE_SCOPES = ['openid', 'email', 'profile', 'offline_access', 'User.Read']
const MICROSOFT_CALENDAR_SCOPES = ['Calendars.ReadWrite']
const MICROSOFT_EMAIL_SCOPES = ['Mail.Send', 'Mail.Read']

export function normalizeProvider(value: string | null | undefined): IntegrationProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null
}

export function normalizeCapabilities(values: unknown): IntegrationCapability[] {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : []

  const normalized = rawValues
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is IntegrationCapability =>
      value === 'calendar' || value === 'email'
    )

  return [...new Set(normalized)]
}

export function getProviderScopes(
  provider: IntegrationProvider,
  capabilities: IntegrationCapability[]
): string[] {
  const scopedCapabilities = new Set(capabilities)

  if (provider === 'google') {
    return [...new Set([
      ...GOOGLE_IDENTITY_SCOPES,
      ...(scopedCapabilities.has('calendar') ? GOOGLE_CALENDAR_SCOPES : []),
      ...(scopedCapabilities.has('email') ? GOOGLE_EMAIL_SCOPES : []),
    ])]
  }

  return [
    ...MICROSOFT_BASE_SCOPES,
    ...(scopedCapabilities.has('calendar') ? MICROSOFT_CALENDAR_SCOPES : []),
    ...(scopedCapabilities.has('email') ? MICROSOFT_EMAIL_SCOPES : []),
  ]
}

export function getMicrosoftTenantId(): string | undefined {
  return process.env.MICROSOFT_TENANT_ID?.trim() || undefined
}

export function getMicrosoftAuthUrl(): string {
  const tenantId = getMicrosoftTenantId()
  if (!tenantId) {
    throw new Error('Missing MICROSOFT_TENANT_ID for single-tenant Microsoft OAuth app')
  }
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
}

export function getMicrosoftTokenUrl(): string {
  const tenantId = getMicrosoftTenantId()
  if (!tenantId) {
    throw new Error('Missing MICROSOFT_TENANT_ID for single-tenant Microsoft OAuth app')
  }
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
}

export function getProviderClientId(provider: IntegrationProvider): string | undefined {
  return provider === 'google'
    ? process.env.GOOGLE_CLIENT_ID
    : process.env.MICROSOFT_CLIENT_ID
}

export function getProviderClientSecret(provider: IntegrationProvider): string | undefined {
  return provider === 'google'
    ? process.env.GOOGLE_CLIENT_SECRET
    : process.env.MICROSOFT_CLIENT_SECRET
}
